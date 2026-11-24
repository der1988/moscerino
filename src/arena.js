export const WIDTH = 800
export const HEIGHT = 600
export const RADIUS = 3
export const ORIGIN = { x: WIDTH / 2, y: HEIGHT / 2 }

const WALL_DEPTH = 8
const ROLES = ['aggressive', 'flanker', 'guard', 'sentinel']

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

export function gateCenter(seed, col, row, vertical) {
  return (vertical ? ORIGIN.y : ORIGIN.x) + hash(seed ^ (vertical ? 113 : 71), col, row) % 201 - 100
}

// A swept segment tested against each rectangle expanded by the moving body's radius.
export function crossesBarrier(start, end, barrier, radius = RADIUS) {
  return barrier.segments.some(([x, y, width, height]) => {
    let first = 0
    let last = 1
    const bounds = [[barrier.x + x, width], [barrier.y + y, height]]
    for (const [index, axis] of ['x', 'y'].entries()) {
      const [edge, size] = bounds[index]
      const lower = edge - radius - start[axis]
      const upper = edge + size + radius - start[axis]
      const delta = end[axis] - start[axis]
      if (delta === 0) {
        if (lower > 0 || upper < 0) return false
      } else {
        first = Math.max(first, Math.min(lower / delta, upper / delta))
        last = Math.min(last, Math.max(lower / delta, upper / delta))
        if (first > last) return false
      }
    }
    return true
  })
}

export function hitsObstacle(point, barrier, radius = RADIUS) {
  return crossesBarrier(point, point, barrier, radius)
}

export function distanceFromOrigin(point) {
  return Math.hypot(point.x - ORIGIN.x, point.y - ORIGIN.y)
}

function pressureAt(point) {
  return Math.min(5, Math.floor(2 * Math.log2(1 + distanceFromOrigin(point) / Math.hypot(WIDTH, HEIGHT))))
}

function passage(seed, col, row, vertical) {
  const center = gateCenter(seed, col, row, vertical)
  const x = col * WIDTH + (vertical ? -WALL_DEPTH / 2 : 0)
  const y = row * HEIGHT + (vertical ? 0 : -WALL_DEPTH / 2)
  const id = `${vertical ? 'v' : 'h'}:${col},${row}`
  const symbol = vertical ? '●' : row % 2 === 0 ? '◆' : '▲'
  const free = vertical && col % 2 !== 0
  const point = vertical ? { x: col * WIDTH, y: y + center } : { x: x + center, y: row * HEIGHT }
  const width = 136 - 12 * pressureAt(point)
  const from = center - width / 2
  const to = center + width / 2
  const orient = segments => vertical ? segments.map(([a, b, w, h]) => [b, a, h, w]) : segments
  const wall = { id, x, y, segments: orient([[0, 0, from, WALL_DEPTH], [to, 0, (vertical ? HEIGHT : WIDTH) - to, WALL_DEPTH]]) }
  const door = { id, symbol, ...point, vertical, width, barrier: { x, y, segments: orient([[from, 0, width, WALL_DEPTH]]) } }
  return { wall, door: free ? null : door, point }
}

export function circuitActive(circuit, frame) {
  return (frame + circuit.phase) % 180 >= 95
}

export function createSector(seed, col, row) {
  const key = sectorKey(col, row)
  const x = col * WIDTH
  const y = row * HEIGHT
  const center = { x: x + ORIGIN.x, y: y + ORIGIN.y }
  const pressure = pressureAt(center)
  const variant = hash(seed, col, row)
  const north = passage(seed, col, row, false)
  const west = passage(seed, col, row, true)
  const edges = [north, passage(seed, col + 1, row, true), passage(seed, col, row + 1, false), west]
  const doors = edges.flatMap(edge => edge.door ? [edge.door] : [])
  const traces = edges.flatMap(({ point }, index) => {
    const bend = index % 2 === 0 ? { x: point.x, y: center.y } : { x: center.x, y: point.y }
    return [[center, bend], [bend, point]].map(([a, b]) => ({
      left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
      width: Math.max(2, Math.abs(a.x - b.x)), height: Math.max(2, Math.abs(a.y - b.y))
    }))
  })
  const lights = doors.map((door, index) => ({
    id: door.id, symbol: door.symbol, x: center.x + (index - 1) * 58, y: center.y - 62
  }))
  const obstacles = [north.wall, west.wall]
  const pockets = [[128, 105], [565, 115], [144, 437], [560, 418]]
  const circuits = []
  for (let i = 0; i < Math.min(4, pressure); i++) {
    const [left, top] = pockets[(i + variant % pockets.length) % pockets.length]
    const id = `${key}:${i}`
    const block = { id, x: x + left, y: y + top, segments: [[0, 0, 82 + pressure * 5, 12], [0, 0, 12, 55]] }
    if (pressure >= 2 && i % 2 === 0) circuits.push({ ...block, phase: (variant + i * 43) % 180 })
    else obstacles.push(block)
  }
  // Every fourth pattern has no energy at all. Pickups stay on clear travel lanes.
  const supplies = col === 0 && row === 0 ? [[470, 344], [175, 300]]
    : variant % 4 === 0 ? [] : [[variant % 2 ? 250 : 550, 300], ...(variant % 3 === 0 ? [[400, 430]] : [])]
  const orbs = supplies.map(([left, top], index) => ({ x: x + left, y: y + top, bit: 1 << index }))
  const roles = Array.from({ length: Math.min(4, pressure + 1) }, (_, index) =>
    ROLES[(variant + index) % ROLES.length])
  return { key, col, row, x, y, pressure, roles, traces, obstacles, circuits, doors, lights, orbs }
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
