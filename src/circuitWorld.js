export const TILE = 64
export const SIDE = 9
export const SECTOR = TILE * SIDE
export const ORIGIN = SECTOR / 2

const ZONES = {
  Memoria: ['stanza', 'stanza', 'chip', 'condensatore', 'corridoio'],
  Processore: ['chip', 'chip', 'stanza', 'condensatore', 'corridoio'],
  Alimentazione: ['condensatore', 'condensatore', 'stanza', 'chip', 'corridoio'],
  Corruzione: ['corridoio', 'corridoio', 'stanza', 'chip', 'condensatore'],
}
const ZONE_NAMES = Object.keys(ZONES)

function hash(seed, x, y) {
  let value = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  return (value ^ (value >>> 15)) >>> 0
}

export function seedFromText(text) {
  return Array.from(text).reduce((seed, letter) => Math.imul(seed ^ letter.codePointAt(0), 16777619), 2166136261)
}

export function sectorKey(x, y) {
  return `${x},${y}`
}

export function difficultyAt(distance) {
  return Math.min(10, Math.log2(1 + distance / SECTOR))
}

export function createSector(seed, x, y) {
  let state = hash(seed, x, y)
  const pick = count => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor(state / 4294967296 * count)
  }
  const level = difficultyAt(Math.hypot(x, y) * SECTOR)
  const zone = level === 0 ? 'Memoria' : ZONE_NAMES[pick(ZONE_NAMES.length)]
  const tiles = Array.from({length: SIDE}, () => Array(SIDE).fill(null))
  const middle = Math.floor(SIDE / 2)
  const last = SIDE - 1
  const edge = (salt, sx, sy) => 2 + hash(seed ^ salt, sx, sy) % 5

  // Each shared edge uses the same coordinates in both adjacent sectors.
  const north = edge(71, x, y)
  const south = edge(71, x, y + 1)
  const west = edge(113, x, y)
  const east = edge(113, x + 1, y)
  const place = (col, row, kind = 'pista') => { tiles[row][col] = kind }

  // All four entrances connect to the central junction through protected tracks.
  for (let row = 0; row <= middle; row++) place(north, row)
  for (let row = middle; row <= last; row++) place(south, row)
  for (let col = 0; col <= middle; col++) place(col, west)
  for (let col = middle; col <= last; col++) place(col, east)
  for (let i = 2; i <= 6; i++) {
    place(i, middle)
    place(middle, i)
  }
  place(middle, middle, 'incrocio')

  const pockets = [[2, 2], [5, 2], [2, 5], [5, 5]]
  const rooms = []
  for (const [left, top] of pockets) {
    if (pick(5) === 0) continue
    const kind = ZONES[zone][pick(ZONES[zone].length)]
    for (let row = top; row <= top + 1; row++) {
      for (let col = left; col <= left + 1; col++) {
        if (!tiles[row][col]) {
          place(col, row, kind)
          if (row === (top < middle ? top + 1 : top)) place(middle, row)
          if (col === (left < middle ? left + 1 : left)) place(col, middle)
        }
      }
    }
    const col = left < middle ? left + 1 : left
    const row = top < middle ? top + 1 : top
    rooms.push({col, row, protected: tiles[row][col] === 'pista'})
  }

  const center = (col, row) => ({x: x * SECTOR + (col + 0.5) * TILE, y: y * SECTOR + (row + 0.5) * TILE})
  const rewards = [{...center(middle, middle), amount: 10 + Math.floor(level * 5), upgrade: false}]
  const hazards = []
  const hazardChance = Math.min(9, 2 + level * 2 + (zone === 'Alimentazione' ? 2 : 0))
  const roles = ['sentinella', 'inseguitore']
  if (level >= 1.5) roles.push('intercettore')
  if (level >= 2 && zone === 'Corruzione') roles.push('intercettore')
  const enemies = []
  for (const room of rooms) {
    const {col, row, protected: safeTrack} = room
    const position = center(col, row)
    if (level >= 1 && !safeTrack && pick(10) < hazardChance) {
      hazards.push({...position, phase: pick(360) / 60})
    }
    if (level > 0 && pick(10) < Math.min(10, 3 + level * 2)) {
      const role = roles[pick(roles.length)]
      enemies.push({...position, homeX: position.x, homeY: position.y, role})
    }
    if (level > 0 && pick(4) !== 0 && !hazards.some(hazard => hazard.x === position.x && hazard.y === position.y)) {
      rewards.push({...position, amount: Math.round(4 + 8 * level), upgrade: level >= 1.5 && pick(5) === 0})
    }
  }
  return {x, y, zone, level, tiles, hazards, enemies, rewards}
}
