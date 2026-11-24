import { useEffect, useRef, useState } from 'react'
import { createSector, difficultyAt, ORIGIN, SECTOR, SIDE, TILE, sectorKey, seedFromText } from './circuitWorld.js'
import './circuitExplorer.css'

const PALETTES = {
  Memoria: ['#162e2b', '#305e50', '#77e2ad'],
  Processore: ['#1c2940', '#3e5885', '#8cbaff'],
  Alimentazione: ['#342819', '#715332', '#ffcc73'],
  Corruzione: ['#301f37', '#624273', '#e3a4ff'],
}

const MOVEMENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'])
const PLAYER_RADIUS = 9

function updateSectors(sectors, seed, x, y) {
  for (const [key, sector] of sectors) {
    if (Math.abs(sector.x - x) > 1 || Math.abs(sector.y - y) > 1) sectors.delete(key)
  }
  for (let row = y - 1; row <= y + 1; row++) {
    for (let col = x - 1; col <= x + 1; col++) {
      const key = sectorKey(col, row)
      if (!sectors.has(key)) sectors.set(key, createSector(seed, col, row))
    }
  }
}

function canEnter(sectors, x, y, radius) {
  for (const dy of [-radius, radius]) {
    for (const dx of [-radius, radius]) {
      const tileX = Math.floor((x + dx) / TILE)
      const tileY = Math.floor((y + dy) / TILE)
      const sx = Math.floor(tileX / SIDE)
      const sy = Math.floor(tileY / SIDE)
      const sector = sectors.get(sectorKey(sx, sy))
      if (!sector?.tiles[tileY - sy * SIDE][tileX - sx * SIDE]) return false
    }
  }
  return true
}

function move(sectors, entity, dx, dy, radius) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / radius))
  for (let step = 0; step < steps; step++) {
    if (canEnter(sectors, entity.x + dx / steps, entity.y, radius)) entity.x += dx / steps
    if (canEnter(sectors, entity.x, entity.y + dy / steps, radius)) entity.y += dy / steps
  }
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function drawSector(ctx, sector, time) {
  const [floor, trace, light] = PALETTES[sector.zone]
  ctx.save()
  ctx.translate(sector.x * SECTOR, sector.y * SECTOR)
  ctx.strokeStyle = '#263c35'
  ctx.strokeRect(0, 0, SECTOR, SECTOR)
  for (let row = 0; row < SIDE; row++) {
    for (let col = 0; col < SIDE; col++) {
      const x = col * TILE
      const y = row * TILE
      const tile = sector.tiles[row][col]
      if (!tile) {
        ctx.fillStyle = '#25372f'
        ctx.fillRect(x + 30, y + 30, 3, 3)
        continue
      }
      ctx.fillStyle = floor
      ctx.fillRect(x, y, TILE, TILE)
      ctx.fillStyle = trace
      if (sector.tiles[row][col - 1] || col === 0) ctx.fillRect(x, y + 31, 32, 2)
      if (sector.tiles[row][col + 1] || col === SIDE - 1) ctx.fillRect(x + 32, y + 31, 32, 2)
      if (sector.tiles[row - 1]?.[col] || row === 0) ctx.fillRect(x + 31, y, 2, 32)
      if (sector.tiles[row + 1]?.[col] || row === SIDE - 1) ctx.fillRect(x + 31, y + 32, 2, 32)
      ctx.strokeStyle = light
      ctx.lineWidth = 1
      if (tile === 'chip') {
        ctx.strokeRect(x + 20, y + 19, 24, 26)
        for (let pin = 24; pin <= 40; pin += 8) {
          ctx.fillRect(x + pin, y + 15, 2, 4)
          ctx.fillRect(x + pin, y + 45, 2, 4)
        }
      } else if (tile === 'condensatore') {
        ctx.beginPath()
        ctx.arc(x + 32, y + 32, 10, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillRect(x + 27, y + 31, 10, 2)
      } else if (tile === 'stanza' || tile === 'corridoio') {
        ctx.strokeStyle = trace
        const vertical = tile === 'corridoio' && (sector.x + sector.y + row + col) % 2 !== 0
        const wide = tile === 'stanza' || !vertical
        const tall = tile === 'stanza' || vertical
        ctx.strokeRect(x + (wide ? 8 : 24), y + (tall ? 8 : 24), wide ? 48 : 16, tall ? 48 : 16)
      } else {
        ctx.fillRect(x + 30, y + 30, 4, 4)
      }
    }
  }
  ctx.restore()

  for (const hazard of sector.hazards) {
    const live = hazardActive(hazard, time)
    ctx.fillStyle = live ? '#ff5d643c' : '#ff5d6416'
    ctx.strokeStyle = live ? '#ff7a83' : '#9d5159'
    ctx.fillRect(hazard.x - 24, hazard.y - 24, 48, 48)
    ctx.strokeRect(hazard.x - 24, hazard.y - 24, 48, 48)
  }
  for (const reward of sector.rewards) {
    if (reward.collected) continue
    ctx.fillStyle = reward.upgrade ? '#f7bd72' : light
    ctx.save()
    ctx.translate(reward.x, reward.y)
    ctx.rotate(Math.PI / 4)
    const size = reward.upgrade ? 12 : 8
    ctx.fillRect(-size / 2, -size / 2, size, size)
    ctx.restore()
  }
  for (const enemy of sector.enemies) {
    ctx.fillStyle = enemy.role === 'intercettore' ? '#ffa877' : '#ef727e'
    ctx.beginPath()
    ctx.arc(enemy.x, enemy.y, enemy.role === 'sentinella' ? 6 : 8, 0, Math.PI * 2)
    ctx.fill()
  }
}

function hazardActive(hazard, time) {
  return (time + hazard.phase) % 3.2 < 1.5
}

function readInput(keys) {
  const pad = Array.from(navigator.getGamepads?.() ?? []).find(candidate => candidate?.connected)
  const axisX = pad?.axes[0] ?? 0
  const axisY = pad?.axes[1] ?? 0
  const stick = Math.hypot(axisX, axisY)
  const tilt = Math.min(1, Math.max(0, (stick - 0.16) / 0.84))
  const right = keys.has('ArrowRight') || keys.has('KeyD')
  const left = keys.has('ArrowLeft') || keys.has('KeyA')
  const down = keys.has('ArrowDown') || keys.has('KeyS')
  const up = keys.has('ArrowUp') || keys.has('KeyW')
  const x = Number(right) - Number(left) + (tilt ? axisX / stick * tilt : 0)
  const y = Number(down) - Number(up) + (tilt ? axisY / stick * tilt : 0)
  const scale = Math.max(1, Math.hypot(x, y))
  return {x: x / scale, y: y / scale, boost: keys.has('Space') || Boolean(pad?.buttons[5]?.pressed), pad: Boolean(pad)}
}

function initialHud() {
  return {zone: 'Memoria', x: 0, y: 0, distance: 0, tier: 0, charge: 100, score: 0, upgrades: 0, cooldown: 0, pad: false}
}

export default function CircuitExplorer({onArcade}) {
  const canvasRef = useRef(null)
  const [seedText, setSeedText] = useState(() => new URLSearchParams(window.location.search).get('seme') || 'moscerino')
  const [seedDraft, setSeedDraft] = useState(seedText)
  const [hud, setHud] = useState(initialHud)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const seed = seedFromText(seedText)
    const sectors = new Map()
    const keys = new Set()
    const player = {x: ORIGIN, y: ORIGIN, charge: 100, score: 0, upgrades: 0, cooldown: 0, boost: 0, immunity: 0}
    let previous = 0
    let time = 0
    let hudTime = -1
    let frame
    let boostHeld = false
    let sx = 0
    let sy = 0
    updateSectors(sectors, seed, sx, sy)

    const clear = () => keys.clear()
    const keydown = event => {
      if (!MOVEMENT.has(event.code) || event.target.closest?.('input, button, [contenteditable]')) return
      event.preventDefault()
      keys.add(event.code)
    }
    const keyup = event => keys.delete(event.code)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clear)

    function tick(timestamp) {
      const dt = previous ? Math.min((timestamp - previous) / 1000, 0.05) : 0
      previous = timestamp
      time += dt
      const input = readInput(keys)
      player.cooldown = Math.max(0, player.cooldown - dt)
      player.boost = Math.max(0, player.boost - dt)
      player.immunity = Math.max(0, player.immunity - dt)
      if (input.boost && !boostHeld && player.cooldown === 0) {
        player.boost = 0.24
        player.cooldown = Math.max(1.3, 3 - player.upgrades * 0.25)
      }
      boostHeld = input.boost
      const speed = player.boost ? 380 : 175
      move(sectors, player, input.x * speed * dt, input.y * speed * dt, PLAYER_RADIUS)

      const nextX = Math.floor(player.x / SECTOR)
      const nextY = Math.floor(player.y / SECTOR)
      if (nextX !== sx || nextY !== sy) {
        sx = nextX
        sy = nextY
        updateSectors(sectors, seed, sx, sy)
      }
      const sector = sectors.get(sectorKey(sx, sy))
      for (const reward of sector.rewards) {
        if (reward.collected || distanceBetween(player, reward) > 19) continue
        reward.collected = true
        player.charge = Math.min(100, player.charge + reward.amount)
        player.score += reward.amount
        if (reward.upgrade) player.upgrades = Math.min(7, player.upgrades + 1)
      }
      let hit = sector.hazards.some(hazard => hazardActive(hazard, time) && distanceBetween(player, hazard) < 29)
      for (const enemy of sector.enemies) {
        const close = distanceBetween(player, enemy)
        const radius = enemy.role === 'sentinella' ? 76 : 145
        const chasing = close < radius && Math.hypot(enemy.x - enemy.homeX, enemy.y - enemy.homeY) < 150
        const lead = enemy.role === 'intercettore' ? 35 : 0
        const targetX = chasing ? player.x + input.x * lead : enemy.homeX
        const targetY = chasing ? player.y + input.y * lead : enemy.homeY
        const dx = targetX - enemy.x
        const dy = targetY - enemy.y
        const length = Math.hypot(dx, dy)
        const step = Math.min(length, (chasing ? 95 : 55) * dt)
        if (length > 1) move(sectors, enemy, dx / length * step, dy / length * step, 7)
        hit ||= distanceBetween(player, enemy) < 17
      }
      if (hit && !player.immunity && !player.boost) {
        player.charge -= 20
        player.immunity = 1
      }
      if (player.charge <= 0) {
        Object.assign(player, {x: ORIGIN, y: ORIGIN, charge: 100, cooldown: 0, boost: 0, immunity: 1})
        sx = 0
        sy = 0
        updateSectors(sectors, seed, sx, sy)
      }

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const pixelWidth = Math.round(width * pixelRatio)
      const pixelHeight = Math.round(height * pixelRatio)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      ctx.fillStyle = '#0b1512'
      ctx.fillRect(0, 0, width, height)
      ctx.save()
      ctx.translate(width / 2 - player.x, height / 2 - player.y)
      for (const visible of sectors.values()) drawSector(ctx, visible, time)
      ctx.restore()

      ctx.strokeStyle = player.immunity ? '#ff8590' : '#89f5b6'
      ctx.lineWidth = player.boost ? 3 : 1
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, player.boost ? 16 : 12, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#e4fff0'
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, 5, 0, Math.PI * 2)
      ctx.fill()

      if (time - hudTime >= 0.08) {
        const distance = Math.hypot(player.x - ORIGIN, player.y - ORIGIN)
        setHud({
          zone: sectors.get(sectorKey(sx, sy)).zone,
          x: sx, y: sy, distance: Math.round(distance), tier: Math.floor(difficultyAt(distance)),
          charge: player.charge, score: player.score, upgrades: player.upgrades,
          cooldown: player.cooldown, pad: input.pad,
        })
        hudTime = time
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clear)
    }
  }, [seedText])

  function changeSeed(event) {
    event.preventDefault()
    const next = seedDraft.trim() || 'moscerino'
    const url = new URL(window.location.href)
    url.searchParams.set('seme', next)
    window.history.replaceState(null, '', url)
    setSeedDraft(next)
    setSeedText(next)
    document.activeElement?.blur()
  }

  return (
    <main className="circuit">
      <header className="circuit-header">
        <div>
          <p className="circuit-brand">MOSCERINO</p>
          <h1>Esplorazione circuiti</h1>
        </div>
        <button type="button" onClick={onArcade}>Modalità classica</button>
      </header>
      <section className="circuit-stage" aria-label="Area di esplorazione">
        <canvas ref={canvasRef} aria-label="Mappa del circuito centrata sul giocatore" />
        <div className="circuit-sector">
          <strong>{hud.zone}</strong>
          <span>Settore {hud.x}, {hud.y} · Distanza {hud.distance}</span>
        </div>
        <div className="circuit-tier">Pericolo {hud.tier}/10</div>
      </section>
      <dl className="circuit-readouts">
        <div><dt>Carica</dt><dd>{hud.charge}%</dd></div>
        <div><dt>Energia raccolta</dt><dd>{hud.score}</dd></div>
        <div><dt>Potenziamenti</dt><dd>{hud.upgrades}</dd></div>
        <div><dt>Scatto</dt><dd>{hud.cooldown ? `${hud.cooldown.toFixed(1)} s` : 'Pronto'}</dd></div>
      </dl>
      <footer className="circuit-footer">
        <p>{hud.pad ? 'Controller connesso' : 'Controlli'} · Analogico sinistro / Frecce / WASD · R1 / Spazio</p>
        <form onSubmit={changeSeed}>
          <label htmlFor="circuit-seed">Seme</label>
          <input id="circuit-seed" value={seedDraft} maxLength={64} onChange={event => setSeedDraft(event.target.value)} />
          <button type="submit">Genera</button>
        </form>
      </footer>
    </main>
  )
}
