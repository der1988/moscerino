export const MAX_ENERGY = 100
export const DASH_COST = 20
export const TRANSFER_COST = 30
export const ORB_ENERGY = 35
const SLOW_COST_PER_FRAME = 24 / 60

export function slowMotion(energy, pressure, exhausted) {
  if (!pressure) return { energy, speed: 1, exhausted: false }
  if (exhausted) return { energy, speed: 1, exhausted: true }
  const remaining = Math.max(0, energy - pressure * SLOW_COST_PER_FRAME)
  return { energy: remaining, speed: remaining > 0 ? 1 - pressure : 1, exhausted: remaining === 0 }
}

export function moveSoul(soul, stick) {
  if (!stick.x && !stick.y) return soul
  const x = (soul?.x ?? 0) + stick.x * 5
  const y = (soul?.y ?? 0) + stick.y * 5
  const scale = Math.max(1, Math.hypot(x, y) / 220)
  return { x: x / scale, y: y / scale }
}

// Separate engage and release thresholds keep small stick jitter from creating another gesture.
export function soulStick(x, y, engaged) {
  const length = Math.hypot(x, y)
  if (length <= (engaged ? 0.14 : 0.23)) return null
  const strength = Math.min(1, (length - 0.14) / 0.86)
  return { x: x / length * strength, y: y / length * strength }
}
