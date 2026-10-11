import { test, expect, mock } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100 },
} as const

test('a spawned haiku agent appears above the prompt and opens its transcript', async ($, on) => {
  mock.clock(on)
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.agent.spawn({ prompt: 'look around', description: 'Scan repo', subagentType: 'Explore' } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'critters', surface, ...BAND } as never)
    // Collapsed: sprites only, no titles.
    expect(await ui.find({ key: 'open-a1' })).toBeUndefined()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.press({ key: 'toggle' })
    // Expanded: a task row with title and model.
    expect(await ui.find({ key: 'open-a1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Haiku 5\.5/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }
})

test('the strip stays empty with no agents', async ($, on) => {
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  const ui = await $.ui.mount({ plugin: 'critters', surface: 'desktop', ...BAND } as never)
  expect(await ui.find({ key: 'open-a1' })).toBeUndefined()
  await ui.unmount()
})

test('Hide moves the critters to the footer and the footer button brings them back', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'b1' }))
  await $.agent.spawn({ prompt: 'x', description: 'Plan auth' } as never)

  const FOOTER = { component: 'SessionMode', props: { modes: [] } }
  const band = await $.ui.mount({ plugin: 'critters', surface: 'desktop', ...BAND } as never)
  await band.press({ key: 'dock' })
  expect(await band.find({ key: 'toggle' })).toBeUndefined()

  const footer = await $.ui.mount({ plugin: 'critters', surface: 'desktop', ...FOOTER } as never)
  expect((await footer.find({ key: 'undock' }))?.text).toMatch(/1 agent/)
  await footer.press({ key: 'undock' })
  expect(await footer.find({ key: 'undock' })).toBeUndefined()
  expect(await band.find({ key: 'toggle' })).toBeDefined()
  await footer.unmount()
  await band.unmount()
})
