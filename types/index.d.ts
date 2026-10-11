export type Family = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'

// What the strip draws: changes only when an agent starts, ends or is pruned.
export type Critter = {
  id: string
  family: Family
  model: string
  type: string
  description: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
}

// Per-tool-call churn, kept apart so the collapsed strip never redraws for it.
export type Activity = { tools: number; lastTool?: string }

declare module 'claude-code' {
  interface PluginState {
    critters: {
      agents: Record<string, Critter>
      activity: Record<string, Activity>
      isExpanded: boolean
      isDocked: boolean
      selected: string | null
    }
  }
}
