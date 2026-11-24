export const WIDTH = 800
export const HEIGHT = 600
export const RADIUS = 3
export const ORIGIN = { x: WIDTH / 2, y: HEIGHT / 2 }

const GATE_WIDTH = 142
const WALL_DEPTH = 8

const ZONES = [
  { name: 'Memoria', color: '#27b780', pieces: ['angle', 'steps', 'chip', 'track'], roles: ['sentinel', 'guard'] },
  { name: 'Processore', color: '#35a8db', pieces: ['chip', 'cross', 'angle', 'track'], roles: ['flanker', 'aggressive'] },
  { name: 'Alimentazione', color: '#dca344', pieces: ['capacitor', 'track', 'cross', 'capacitor'], roles: ['guard', 'sentinel'] },
  { name: 'Corruzione', color: '#ce60d9', pieces: ['maze', 'steps', 'cross', 'angle'], roles: ['aggressive', 'flanker', 'guard'] },
]

export function seedFromText(text) {
  let seed = 2166136261
  for (const char of text) seed = Math.imul(seed ^ char.codePointAt(0), 16777619)
  return seed
}

function hash(seed, col, row) {
  let value = Math.imul(col, 0x9e3779b1) ^ Math.imul(row, 0x85ebca77) ^ seed
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return (value ^ (value >>> 16)) >>> 0
}

export function sectorAt(point) {
  return { col: Math.floor(point.x / WIDTH), row: Math.floor(point.y / HEIGHT) }
}

export function sectorKey(col, row) {
  return `${col},${row}`
}

// Both sectors address a shared edge by the coordinates on its east or south side.
export function gateCenter(seed, col, row, vertical) {
  return (vertical ? ORIGIN.y : ORIGIN.x) + hash(seed ^ (vertical ? 113 : 71), col, row) % 201 - 100
}

function pieceSegments(type) {
  switch (type) {
    case 'angle': return [[0, 0, 6, 78], [0, 72, 85, 6]]
    case 'cross': return [[37, 0, 6, 80], [0, 37, 80, 6]]
    case 'maze': return [[0, 0, 6, 90], [0, 0, 90, 6], [84, 0, 6, 58], [31, 42, 59, 6], [31, 42, 6, 48]]
    case 'steps': return [[0, 0, 34, 6], [28, 0, 6, 45], [28, 39, 34, 6], [56, 39, 6, 45], [56, 78, 34, 6]]
    case 'chip': return [[14, 10, 62, 68], [0, 20, 90, 5], [0, 41, 90, 5], [0, 62, 90, 5]]
    case 'capacitor': return [[12, 9, 16, 72], [51, 9, 16, 72], [0, 42, 12, 6], [67, 42, 13, 6]]
    default: return [[0, 14, 54, 6], [48, 14, 6, 48], [48, 56, 42, 6]]
  }
}

function obstacle(id, type, x, y, segments, color, phase = null) {
  return { id, type, x, y, segments, color, phase }
}

export function obstacleActive(piece, frame) {
  return piece.phase === null || (frame + piece.phase) % 180 < 90
}

export function hitsObstacle(point, piece, radius = RADIUS) {
  return piece.segments.some(([x, y, width, height]) =>
    point.x >= piece.x + x - radius && point.x <= piece.x + x + width + radius &&
    point.y >= piece.y + y - radius && point.y <= piece.y + y + height + radius)
}

export function createSector(seed, col, row) {
  const key = sectorKey(col, row)
  const x = col * WIDTH
  const y = row * HEIGHT
  const distance = Math.hypot(col, row)
  const pressure = Math.min(5, Math.floor(Math.log2(1 + distance) * 2))
  const zone = distance ? ZONES[hash(seed, col, row) % ZONES.length] : ZONES[0]
  let random = hash(seed ^ 0x86da3, col, row)
  const pick = max => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    return Math.floor(random / 4294967296 * max)
  }

  const north = gateCenter(seed, col, row, false)
  const west = gateCenter(seed, col, row, true)
  const split = (center, span) => [[0, center - GATE_WIDTH / 2], [center + GATE_WIDTH / 2, span]]
  const obstacles = [
    obstacle(key + ':north', 'wall', x, y - WALL_DEPTH / 2,
      split(north, WIDTH).map(([from, to]) => [from, 0, to - from, WALL_DEPTH]), zone.color),
    obstacle(key + ':west', 'wall', x - WALL_DEPTH / 2, y,
      split(west, HEIGHT).map(([from, to]) => [0, from, WALL_DEPTH, to - from]), zone.color),
  ]

  // Quadrant pieces leave both central bands free, including the approach to every gate.
  const pockets = [[42, 20], [WIDTH - 174, 20], [42, HEIGHT - 136], [WIDTH - 174, HEIGHT - 136]]
  const count = Math.min(pockets.length, 1 + pressure)
  for (let i = 0; i < count; i++) {
    const [left, top] = pockets.splice(pick(pockets.length), 1)[0]
    const type = zone.pieces[pick(zone.pieces.length)]
    const turn = pick(2)
    const segments = pieceSegments(type).map(([sx, sy, w, h]) => turn ? [90 - sy - h, sx, h, w] : [sx, sy, w, h])
    const intermittent = pressure >= 2 && pick(5) < (zone.name === 'Alimentazione' ? 4 : 2)
    obstacles.push(obstacle(key + ':' + i, type, x + left + pick(22), y + top + pick(12),
      segments, zone.color, intermittent ? pick(180) : null))
  }

  return { key, col, row, x, y, zone, pressure, obstacles }
}

export function loadNearby(sectors, seed, col, row) {
  for (const [key, sector] of sectors) {
    if (Math.abs(sector.col - col) > 1 || Math.abs(sector.row - row) > 1) sectors.delete(key)
  }
  for (let y = row - 1; y <= row + 1; y++) {
    for (let x = col - 1; x <= col + 1; x++) {
      const key = sectorKey(x, y)
      if (!sectors.has(key)) sectors.set(key, createSector(seed, x, y))
    }
  }
}

export function createBonus(sector, size, first = false, random = Math.random) {
  const cross = first ? { x: ORIGIN.x + 105, y: ORIGIN.y } : random() < 0.5
    ? { x: 85 + random() * (WIDTH - 170), y: ORIGIN.y }
    : { x: ORIGIN.x, y: 85 + random() * (HEIGHT - 170) }
  const points = !first && sector.pressure >= 2 && random() < 0.35 ? 2 : 1
  return { x: sector.x + cross.x, y: sector.y + cross.y, size: points > 1 ? 14 : size, points }
}

export function bonusWaypoint(seed, position, bonus) {
  const current = sectorAt(position)
  const target = sectorAt(bonus)
  if (current.col !== target.col) {
    const east = target.col > current.col
    const edge = current.col + Number(east)
    return { x: edge * WIDTH + (east ? 20 : -20), y: current.row * HEIGHT + gateCenter(seed, edge, current.row, true) }
  }
  if (current.row !== target.row) {
    const south = target.row > current.row
    const edge = current.row + Number(south)
    return { x: current.col * WIDTH + gateCenter(seed, current.col, edge, false), y: edge * HEIGHT + (south ? 20 : -20) }
  }
  return bonus
}
