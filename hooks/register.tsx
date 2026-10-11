import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Critter } from '../types'
import { familyOf, spriteSvg } from './sprites'

const PANE = 'critter-transcript'
const KEEP_DONE_MS = 2 * 60 * 1000
const SPRITE_CELLS = 4
const DOCKED_KEY = 'critters:docked'
const TOGGLE_CELLS = 16

const agents = atom({ plugin: 'critters', key: 'agents' } as const, {})
const activity = atom({ plugin: 'critters', key: 'activity' } as const, {})
const isExpanded = atom({ plugin: 'critters', key: 'isExpanded' } as const, false)
const isDocked = atom({ plugin: 'critters', key: 'isDocked' } as const, false)
const selected = atom({ plugin: 'critters', key: 'selected' } as const, null)

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const elapsed = (c: Critter, now: number) => {
  const s = Math.max(0, Math.round(((c.endedAt ?? now) - c.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// claude-haiku-5-5 → Haiku 5.5
const modelName = (c: Critter) => {
  if (c.family === 'other') return 'Unknown model'
  const version = c.model.match(new RegExp(`${c.family}-(\\d+(?:-\\d+)?)`))?.[1]?.replace('-', '.')
  return `${c.family[0]?.toUpperCase()}${c.family.slice(1)}${version ? ` ${version}` : ''}`
}

const statusWord = (c: Critter) => (c.status === 'running' ? 'Running' : c.status === 'done' ? 'Done' : 'Failed')

const toolLine = (t: SessionMessage['toolUses'][number]) => {
  const arg = Object.values(t.input).find(v => typeof v === 'string') as string | undefined
  return `- \`${t.tool}\`${arg ? ` ${clip(arg.replace(/\s+/g, ' '), 90)}` : ''}${t.isError ? ' ⚠︎' : ''}`
}

const transcriptMarkdown = (msgs: SessionMessage[]) => {
  const parts: string[] = []
  msgs.forEach((m, i) => {
    if (m.role === 'user') {
      if (i === 0 && m.text.trim()) parts.push(`**Prompt**\n\n${clip(m.text.trim(), 1500)}`)
      return
    }
    if (m.text.trim()) parts.push(m.text.trim())
    if (m.toolUses.length) parts.push(m.toolUses.map(toolLine).join('\n'))
  })
  let md = parts.join('\n\n')
  if (md.length > 60_000) md = `…\n\n${md.slice(-60_000)}`
  return md || '_Nothing yet._'
}

const sortCritters = (all: Critter[]) =>
  all.sort((a, b) => (a.status === b.status ? a.startedAt - b.startedAt : a.status === 'running' ? -1 : 1))

const setDocked = async ($: EngineInterface, value: boolean) => {
  await update($, isDocked, () => value)
  await $.store.set(DOCKED_KEY, value)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Hidden-in-footer is a preference: remembered across sessions.
    if ((await $.store.get(DOCKED_KEY)) === true) await update($, isDocked, () => true)
    await $.command.register({ name: 'critters', description: 'Show or hide the agent critters above the prompt' })
    // Prune finished critters; catch kills the events missed and agents spawned before load.
    $.clock.every(10_000, async () => {
      const now = await $.clock.now()
      const list = await $.agent.list()
      const before = (await read($, agents)) ?? {}
      const out: Record<string, Critter> = {}
      let isChanged = false
      for (const c of Object.values(before)) {
        const live = list.find(a => a.id === c.id)
        let fresh = c
        if (c.status === 'running' && live && ['completed', 'failed', 'killed'].includes(live.status)) {
          fresh = { ...c, status: (live.status === 'completed' ? 'done' : 'failed') as Critter['status'], endedAt: now }
          isChanged = true
        }
        if (fresh.status !== 'running' && now - (fresh.endedAt ?? now) > KEEP_DONE_MS) {
          isChanged = true
          continue
        }
        out[c.id] = fresh
      }
      for (const a of list) {
        if (out[a.id] || !['running', 'waiting', 'pending'].includes(a.status)) continue
        out[a.id] = {
          id: a.id, family: 'other', model: 'unknown', type: a.type,
          description: a.description, status: 'running' as const, startedAt: now,
        }
        isChanged = true
      }
      // Only write when something moved, so the strip doesn't redraw every tick.
      if (isChanged) await update($, agents, () => out)
    })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if ('agentId' in started && started.agentId) {
      const id = started.agentId
      const now = await $.clock.now()
      await update($, agents, all => ({
        ...all,
        [id]: {
          id,
          family: familyOf(started.model),
          model: started.model,
          type: e.subagentType || 'agent',
          description: e.description || '',
          status: 'running' as const,
          startedAt: now,
        },
      }))
    }
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      await update($, activity, all => {
        const a = all?.[id] ?? { tools: 0 }
        return { ...all, [id]: { tools: a.tools + 1, lastTool: e.tool } }
      })
      const c = (await read($, agents))?.[id]
      // A resumed agent wakes back up.
      if (c && c.status !== 'running') {
        await update($, agents, all => ({ ...all, [id]: { ...c, status: 'running' as const, endedAt: undefined } }))
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const now = await $.clock.now()
      await update($, agents, all => {
        const c = all?.[id]
        if (!c) return all
        return { ...all, [id]: { ...c, status: (e.isAborted ? 'failed' : 'done') as Critter['status'], endedAt: now } }
      })
    }
    return next(e)
  })

  // Hidden: a quiet entry in the footer beside the model selector; press it to bring the strip back.
  // Composes with whatever sits beneath (the engine's modes, other mods) instead of replacing it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const beneath = await next(e)
    if (!(await read($, isDocked))) return beneath
    const all = Object.values((await read($, agents)) ?? {})
    if (all.length === 0) return beneath

    const { Box, Button } = $.ui.resolve(e)
    const running = all.filter(c => c.status === 'running').length
    const label = running > 0 ? `${running} ${running === 1 ? 'agent' : 'agents'}` : `${all.length} done`
    return (
      <Box flexDirection="row" alignItems="center" columnGap={2}>
        {beneath}
        <Button key="undock" label={label} plain onPress={() => setDocked($, false)} />
      </Box>
    )
  })

  on('command.run', { command: 'critters' }, async $ => {
    const docked = !(await read($, isDocked))
    await setDocked($, docked)
    return { text: docked ? 'Critters hidden — they sit in the footer now.' : 'Critters back above the prompt.' }
  })

  // The strip: sprites side by side just above the prompt; › expands a task list.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = sortCritters(Object.values((await read($, agents)) ?? {}))
    if (e.props.hasSurvey || all.length === 0 || (await read($, isDocked))) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const expanded = await read($, isExpanded)
    // Big in the strip (fills the button's height, so the row doesn't grow); small in list rows.
    const sprite = (c: Critter, size: 'big' | 'small' = 'small') =>
      'Svg' in ui && ui.Svg ? (
        <ui.Svg
          source={spriteSvg(c)}
          alt={`${modelName(c)}: ${c.description || c.type}`}
          width={size === 'big' ? 32 : 20}
          height={size === 'big' ? 28 : 18}
        />
      ) : (
        <Text dimColor={c.status !== 'running'}>{c.family.charAt(0).toUpperCase()}</Text>
      )

    const fits = Math.max(1, Math.floor(((e.props.bodyColumns ?? 80) - TOGGLE_CELLS) / SPRITE_CELLS))
    const running = all.filter(c => c.status === 'running').length
    const summary = running > 0 ? `${running} running` : `${all.length} done`
    const strip = (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" alignItems="center" flexShrink={1}>
          {all.slice(0, fits).map(c => (
            <Box key={`critter-${c.id}`}>{sprite(c, 'big')}</Box>
          ))}
          {all.length > fits && <Text dimColor> +{all.length - fits}</Text>}
        </Box>
        {/* Same spot in both states, so the hand never has to hunt for it. */}
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Button
            key="toggle"
            label={expanded ? 'Less ▴' : `${summary} ▾`}
            variant="secondary"
            onPress={() => update($, isExpanded, v => !v)}
          />
          <Button key="dock" label="Hide" plain dimColor onPress={() => setDocked($, true)} />
        </Box>
      </Box>
    )
    if (!expanded) return strip

    const acts = (await read($, activity)) ?? {}
    const now = await $.clock.now()
    const titleMax = Math.max(12, (e.props.bodyColumns ?? 80) - 44)
    return (
      <Box flexDirection="column">
        {strip}
        {all.map(c => {
          const tools = acts[c.id]?.tools ?? 0
          return (
            <Box key={`row-${c.id}`} flexDirection="row" alignItems="center" columnGap={1}>
              {sprite(c)}
              <Button
                key={`open-${c.id}`}
                label={clip(c.description || c.type, titleMax)}
                plain
                dimColor={c.status !== 'running'}
                onPress={async () => {
                  await update($, selected, () => c.id)
                  await $.ui.open({ id: PANE, title: clip(c.description || c.type, 60), closeOnEscape: true })
                }}
              />
              <Text dimColor>
                {modelName(c)} · {statusWord(c)} · {elapsed(c, now)} · {tools} {tools === 1 ? 'tool' : 'tools'}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })

  // The sheet: the clicked agent's transcript.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Button } = $.ui.resolve(e)
    const id = await read($, selected)
    const c = id ? (await read($, agents))?.[id] : undefined
    if (!id || !c) return <Text dimColor>That agent has gone.</Text>

    const a = (await read($, activity))?.[id]
    const now = await $.clock.now()
    const msgs = await $.session.messages({ agentId: id })
    const body = Array.isArray(msgs) ? transcriptMarkdown(msgs) : `_Transcript unavailable: ${msgs.deny}_`

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            {modelName(c)} · {statusWord(c)} · {elapsed(c, now)} · {a?.tools ?? 0} tools
            {a?.lastTool && c.status === 'running' ? ` · ${a.lastTool}` : ''}
          </Text>
          <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Markdown key="transcript" text={body} />
      </Box>
    )
  })
}
