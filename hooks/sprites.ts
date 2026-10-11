import type { Critter, Family } from '../types'

// Pixel grids, 16 wide, bottom-aligned into a 16x14 canvas.
// B body, E eye, K crown, L leaf, H hat, S star.
const CLAWD = [
  '...BBBBBBBBBB...',
  '...BBBBBBBBBB...',
  '...BBEBBBBEBB...',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  '...BBBBBBBBBB...',
  '...B.B....B.B...',
  '...B.B....B.B...',
]

const GRIDS: Record<Family, string[]> = {
  sonnet: CLAWD,
  other: CLAWD,
  opus: [
    '.....K.KK.K.....',
    '.....KKKKKK.....',
    '................',
    ...CLAWD,
  ],
  haiku: [
    '........LL......',
    '.......LL.......',
    '....BBBBBBBB....',
    '....BEBBBBEB....',
    '...BBBBBBBBBB...',
    '....BBBBBBBB....',
    '....B.B..B.B....',
  ],
  fable: [
    '.......HH.......',
    '......HHSH......',
    '.....HHHHHH.....',
    '...HHHHHHHHHH...',
    ...CLAWD,
  ],
}

const PALETTE: Record<Family, Record<string, string>> = {
  sonnet: { B: '#D97757' },
  opus: { B: '#8A5CC2', K: '#F2C14E' },
  haiku: { B: '#8DBF7A', L: '#3F8A4A' },
  fable: { B: '#5B7FE0', H: '#2F2A6E', S: '#F2C14E' },
  other: { B: '#9A948C' },
}

const EYE = '#2A1E19'
const W = 16
const H = 14

export const familyOf = (model: string | undefined): Family => {
  const m = (model ?? '').toLowerCase()
  for (const f of ['fable', 'opus', 'sonnet', 'haiku'] as const) {
    if (m.includes(f)) return f
  }
  return 'other'
}

// Run-length rects so a sprite is a handful of elements, not 200.
const rects = (grid: string[], char: string, fill: string, top: number) => {
  let out = ''
  grid.forEach((row, y) => {
    let x = 0
    while (x < W) {
      if (row[x] !== char) {
        x++
        continue
      }
      let end = x
      while (row[end] === char) end++
      out += `<rect x="${x}" y="${y + top}" width="${end - x}" height="1" fill="${fill}"/>`
      x = end
    }
  })
  return out
}

// Stable per agent: re-renders don't change the source, so the animation never restarts.
export const spriteSvg = (c: Pick<Critter, 'id' | 'family' | 'status'>) => {
  const grid = GRIDS[c.family]
  const top = H - grid.length
  const colors = PALETTE[c.family]
  const isRunning = c.status === 'running'
  const delay = (([...c.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 7) * 100)

  let body = ''
  for (const [char, fill] of Object.entries(colors)) body += rects(grid, char, fill, top)
  body += rects(grid, 'E', colors.B ?? EYE, top) // skin under the eyes, so a blink shows body, not a hole
  const eyes = isRunning
    ? rects(grid, 'E', EYE, top)
    : // closed eyes: a flat line where the eyes were
      grid
        .map((row, y) => [...row].map((ch, x) => (ch === 'E' ? `<rect x="${x - 0.25}" y="${y + top + 0.6}" width="1.5" height="0.4" fill="${EYE}"/>` : '')).join(''))
        .join('')
  const flag = c.status === 'failed' ? `<rect x="14" y="0" width="2" height="2" fill="#E5484D"/>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><style>
.b{animation:bob .72s steps(1,end) ${delay}ms infinite}
.e{transform-box:fill-box;transform-origin:center;animation:blink 4.2s steps(1,end) ${delay * 3}ms infinite}
@keyframes bob{0%{transform:translateY(0)}50%{transform:translateY(-1px)}}
@keyframes blink{0%{transform:scaleY(1)}96%{transform:scaleY(.15)}98%{transform:scaleY(1)}}
.z{opacity:.45}
@media (prefers-reduced-motion:reduce){.b,.e{animation:none}}
</style><g class="${isRunning ? 'b' : 'z'}">${body}<g class="${isRunning ? 'e' : ''}">${eyes}</g></g>${flag}</svg>`
}
