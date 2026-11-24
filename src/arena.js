export const WIDTH = 800
export const HEIGHT = 600
export const RADIUS = 3
export const ORIGIN = { x: WIDTH / 2, y: HEIGHT / 2 }

const GATE_WIDTH = 142
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

export function createSector(seed, col, row) {
  const key = sectorKey(col, row)
  const x = col * WIDTH
  const y = row * HEIGHT
  const distance = Math.hypot(col, row)
  const pressure = Math.min(5, Math.floor(Math.log2(1 + distance) * 2))
  const variant = hash(seed, col, row)
  const north = gateCenter(seed, col, row, false)
  const west = gateCenter(seed, col, row, true)
  const split = (center, size, thickness) => [
    [0, 0, center - GATE_WIDTH / 2, thickness],
    [center + GATE_WIDTH / 2, 0, size - center - GATE_WIDTH / 2, thickness]
  ]
  const obstacles = [
    { id: key + ':north', x, y: y - WALL_DEPTH / 2, segments: split(north, WIDTH, WALL_DEPTH) },
    { id: key + ':west', x: x - WALL_DEPTH / 2, y, segments: split(west, HEIGHT, WALL_DEPTH).map(([a, b, w, h]) => [b, a, h, w]) }
  ]
  const doors = []
  const lights = []
  const orbs = [{ x: x + 470, y: y + 335, bit: 1 }]
  const bays = [[105, 65], [545, 65], [105, 437], [545, 437]]
  bays.splice(variant % bays.length, 1)
  bays.forEach(([left, top], index) => {
    const bottom = top > HEIGHT / 2
    const id = key + ':' + index
    const doorY = top + (bottom ? 0 : 92)
    const symbol = ['◆', '●', '▲'][index]
    const lightBit = 1 << index
    const orbBit = 1 << (index + 1)
    obstacles.push({
      id: id + ':bay', x: x + left, y: y + top,
      segments: [[0, 0, 7, 100], [143, 0, 7, 100], [0, bottom ? 92 : 0, 150, 8],
        [0, bottom ? 0 : 92, 47, 8], [103, bottom ? 0 : 92, 47, 8]]
    })
    doors.push({ id, x: x + left + 47, y: y + doorY, segments: [[0, 0, 56, 8]], symbol, bit: lightBit })
    lights.push({ x: x + [347, 400, 453][index], y: y + 250, bit: lightBit, symbol })
    orbs.push({ x: x + left + 75, y: y + top + 50, bit: orbBit })
  })
  const roles = [ROLES[variant % ROLES.length], ROLES[(variant + 1) % ROLES.length]]
  return { key, col, row, x, y, pressure, roles, obstacles, doors, lights, orbs }
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
