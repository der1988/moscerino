import { RADIUS, crossesBarrier, sectorAt, sectorKey } from './arena.js'

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clear = (a, b, walls) => !walls.some(wall => crossesBarrier(a, b, wall))

// A visibility graph lets enemies route around corners and through open doorways.
export function pursuitPath(start, target, walls, sectors) {
  const margin = RADIUS + 9
  const nodes = [start, target]
  for (const wall of walls) {
    for (const [left, top, width, height] of wall.segments) {
      for (const x of [wall.x + left - margin, wall.x + left + width + margin]) {
        for (const y of [wall.y + top - margin, wall.y + top + height + margin]) {
          const { col, row } = sectorAt({ x, y })
          const point = { x, y }
          if (sectors.has(sectorKey(col, row)) && clear(point, point, walls)) nodes.push(point)
        }
      }
    }
  }

  const costs = nodes.map(() => Infinity)
  const previous = nodes.map(() => -1)
  const pending = new Set([0])
  costs[0] = 0
  while (pending.size) {
    let current = -1
    let best = Infinity
    for (const index of pending) {
      const estimate = costs[index] + distance(nodes[index], target)
      if (estimate < best) {
        current = index
        best = estimate
      }
    }
    if (current === 1) {
      const path = []
      for (let index = 1; index !== 0; index = previous[index]) path.push(nodes[index])
      return path.reverse()
    }
    pending.delete(current)
    for (let next = 1; next < nodes.length; next++) {
      const cost = costs[current] + distance(nodes[current], nodes[next])
      if (cost >= costs[next] || !clear(nodes[current], nodes[next], walls)) continue
      costs[next] = cost
      previous[next] = current
      pending.add(next)
    }
  }
  return []
}

export function advanceEnemy(enemy, target, walls, sectors, frame, speed) {
  let path = enemy.path ?? []
  let retry = enemy.retry ?? 0
  let waypoint = target
  if (!clear(enemy, target, walls)) {
    if (path.length && distance(enemy, path[0]) < 5) path = path.slice(1)
    if (frame >= retry || (path.length && !clear(enemy, path[0], walls))) {
      path = pursuitPath(enemy, target, walls, sectors)
      retry = frame + 24
    }
    waypoint = path[0]
  } else {
    path = []
    retry = frame
  }

  const length = waypoint ? distance(enemy, waypoint) : 0
  const unitX = length ? (waypoint.x - enemy.x) / length : 0
  const unitY = length ? (waypoint.y - enemy.y) / length : 0
  const velocity = {
    x: enemy.vx * .76 + unitX * speed * .24,
    y: enemy.vy * .76 + unitY * speed * .24
  }
  const position = { x: enemy.x, y: enemy.y }
  for (const axis of ['x', 'y']) {
    const next = { ...position, [axis]: position[axis] + velocity[axis] }
    const { col, row } = sectorAt(next)
    if (sectors.has(sectorKey(col, row)) && clear(position, next, walls)) position[axis] = next[axis]
    else velocity[axis] = 0
  }
  return { ...enemy, ...position, vx: velocity.x, vy: velocity.y, path, retry }
}
