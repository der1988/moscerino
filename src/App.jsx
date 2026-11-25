import React, { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import {
  WIDTH as GAME_WIDTH, HEIGHT as GAME_HEIGHT, RADIUS as PLAYER_RADIUS, ORIGIN,
  bonusWaypoint, circuitActive, createBonus, createSector, crossesBarrier, distanceFromOrigin, loadNearby, sectorAt, sectorKey, seedFromText
} from './arena.js'
import { DASH_COST, MAX_ENERGY, ORB_ENERGY, TRANSFER_COST, moveSoul, slowMotion, soulStick } from './powers.js'
import { soundtrackUrl, startSoundtrack } from './soundtrack.js'

import { advanceEnemy } from './pursuit.js'

const SPEED_MULTIPLIERS = [0.7, 0.85, 0.92]
const BONUS_SIZES = [8, 10, 12] // Dimensioni possibili per i bonus (piccolo, medio, grande)
const PLAYER_FRICTION = 0.93// Frizione del giocatore (ridotta inerzia)
const AUTO_ATTRACTION_RADIUS = 2 // Raggio entro cui il bonus viene attratto automaticamente
const AUTO_ATTRACTION_SPEED = 1 // Velocità di attrazione automatica

const readScores = () => {
  try {
    const scores = JSON.parse(localStorage.getItem('moscerino-leaderboard-v1') || '[]');
    return Array.isArray(scores) ? scores.filter(entry => typeof entry.name === 'string' && Number.isFinite(entry.score)).slice(0, 10) : [];
  } catch { return []; }
};

// Matrix Mode
const BOOST_DURATION_FRAMES = 20; // Durata boost: circa 0.3 secondi a 60fps
const ENEMY_SLOW_FACTOR = 0.75; // Rallenta i nemici al 75% della velocità
const PLAYER_BOOST_FACTOR = 1.8; // Accelera il giocatore al 180% della velocità
const BONUS_ATTRACTION_RADIUS = 50; // Raggio entro cui il bonus viene attratto al giocatore
const BONUS_ATTRACTION_SPEED = 0.8; // Velocità di attrazione del bonus

const INTELLIGENCE_LEVELS = { low: 'low', medium: 'medium', high: 'high' }

// Funzione helper per la distanza - ottimizzata
const distance = (p1, p2) => {
  if (!p1 || !p2) return Infinity // Gestisce il caso bonus non ancora caricato o nullo
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.sqrt(dx * dx + dy * dy)
}

function enemyContact(player, nextPlayer, enemy, nextEnemy) {
  const x = player.x - enemy.x
  const y = player.y - enemy.y
  if (!nextEnemy) return Math.hypot(x, y) < PLAYER_RADIUS * 2

  // Check the closest approach during the frame, including when the two sprites cross.
  const dx = nextPlayer.x - nextEnemy.x - x
  const dy = nextPlayer.y - nextEnemy.y - y
  const lengthSquared = dx * dx + dy * dy
  const closest = lengthSquared ? Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared)) : 0
  return Math.hypot(x + closest * dx, y + closest * dy) < PLAYER_RADIUS * 2
}

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]]
const ORGAN_ROOMS = ['1,0', '-1,0', '0,1', '0,-2']
const FRAME_TIME = 1000 / 60
let nextEnemyId = 0

function createEnemy(sector, player, enemies) {
  // Spawn on a central lane, with room for the player to react.
  const slots = [[100, 300], [225, 300], [575, 300], [700, 300], [400, 90], [400, 510]]
    .map(([x, y]) => ({ x: sector.x + x, y: sector.y + y }))
    .filter(point => distance(point, player) >= 185 &&
      enemies.every(enemy => distance(enemy, point) > 45))
  if (!slots.length) return null
  const point = slots[Math.floor(Math.random() * slots.length)]
  const roles = sector.roles
  return {
    ...point,
    id: nextEnemyId++,
    home: sector.key,
    post: point,
    patrolIndex: nextEnemyId % 4,
    role: roles[Math.floor(Math.random() * roles.length)],
    vx: 0, vy: 0,
    speedMultiplier: SPEED_MULTIPLIERS[Math.floor(Math.random() * (sector.pressure >= 2 ? 3 : 1))],
    intelligence: sector.pressure >= 4 ? INTELLIGENCE_LEVELS.high
      : sector.pressure >= 2 ? INTELLIGENCE_LEVELS.medium : INTELLIGENCE_LEVELS.low
  }
}

function spawnEnemies(sector, player, enemies, count) {
  const result = [...enemies]
  for (let i = 0; i < count; i++) {
    const enemy = createEnemy(sector, player, result)
    if (enemy) result.push(enemy)
  }
  return result
}

function newRun(seed) {
  const sectors = new Map()
  loadNearby(sectors, seed, 0, 0)
  const sector = sectors.get('0,0')
  const run = {
    position: ORIGIN, velocity: { x: 0, y: 0 }, sectors, sector,
    enemies: [], remaining: new Map(),
    bonus: createBonus(sectors.get('1,0'), BONUS_SIZES[1]),
    score: 0, trail: [], boost: 0, frame: 0,
    energy: MAX_ENERGY, worldStep: 0, speed: 1, exhausted: false, soul: null,
    healthy: new Set(), inactiveEnemies: new Map(), cleanseFrame: -100,
    opened: new Set(), collected: new Map(), soulGesture: false, soulLanding: null
  }
  populateNearby(run)
  return run
}

function populateNearby(run) {
  const remaining = new Map(run.remaining)
  for (const room of run.sectors.values()) {
    if (remaining.has(room.key)) continue
    const enemies = spawnEnemies(room, run.position, [], room.pressure + 1)
    run.enemies.push(...enemies)
    remaining.set(room.key, enemies.length)
  }
  run.remaining = remaining
}

function readStick(pad, axis = 0) {
  const x = pad?.axes[axis] ?? 0
  const y = pad?.axes[axis + 1] ?? 0
  const length = Math.hypot(x, y)
  const strength = Math.min(1, Math.max(0, (length - 0.15) / 0.85))
  return strength ? { x: x * strength / length, y: y * strength / length } : { x: 0, y: 0 }
}

// Componente ottimizzato per i nemici (memo per evitare re-render inutili)
const Enemy = React.memo(({ enemy }) => {
  return (
    <div
      className={`enemy enemy-${enemy.intelligence}`}
      style={{
        position: 'absolute',
        left: enemy.x - PLAYER_RADIUS,
        top: enemy.y - PLAYER_RADIUS,
        width: PLAYER_RADIUS * 2,
        height: PLAYER_RADIUS * 2,
        willChange: 'transform' // Per ottimizzare le animazioni
      }}
    />
  );
}, (prevProps, nextProps) => {
  // Funzione di comparazione personalizzata per evitare ri-rendering non necessari
  // Re-renderizza solo se la posizione è cambiata significativamente (più di 1px)
  return (
    Math.abs(prevProps.enemy.x - nextProps.enemy.x) < 1 &&
    Math.abs(prevProps.enemy.y - nextProps.enemy.y) < 1 &&
    prevProps.enemy.intelligence === nextProps.enemy.intelligence
  );
});

function solidBarriers(run) {
  const walls = [...run.sectors.values()].flatMap(room => room.obstacles)
  const locked = new Map()
  for (const room of run.sectors.values()) {
    for (const door of room.doors) {
      if (!run.opened.has(door.id)) locked.set(door.id, door.barrier)
    }
  }
  return [...walls, ...locked.values()]
}

function liveCircuits(run) {
  return [...run.sectors.values()].flatMap(room => run.healthy.has(room.key) ? [] : room.circuits)
    .filter(circuit => circuitActive(circuit, run.frame))
}

const Obstacle = React.memo(function Obstacle({ obstacle, className = 'matrix-wall' }) {
  return obstacle.segments.map(([x, y, width, height], index) => (
    <div key={index} className={className}
      style={{ left: obstacle.x + x, top: obstacle.y + y, width, height }} />
  ))
})

const Room = React.memo(function Room({ room, opened, collected, liveMask, healthy }) {
  return (
    <div className="matrix-room" data-room={room.key} data-tissue={room.tissue} data-health={healthy ? 'sana' : 'infetta'} data-pressure={room.pressure}>
      <div className="sector-floor" data-band={room.pressure}
        style={{ left: room.x, top: room.y, width: GAME_WIDTH, height: GAME_HEIGHT }}>
        <span className="room-coordinate" aria-hidden="true">{room.tissue}</span>
      </div>
      {room.traces.map((trace, index) => <div key={index} className="matrix-trace" style={trace} aria-hidden="true" />)}
      {room.obstacles.map(obstacle => <Obstacle key={obstacle.id} obstacle={obstacle} />)}
      {room.circuits.map((circuit, index) => <Obstacle key={circuit.id} obstacle={circuit}
        className={!healthy && liveMask & (1 << index) ? 'matrix-circuit is-live' : 'matrix-circuit'} />)}
      {room.doors.map(door => (
        <div key={door.id} className={`matrix-door${opened.has(door.id) ? ' is-open' : ''}`}
          data-symbol={door.symbol} data-door={door.id} aria-label={`Porta ${door.symbol}${opened.has(door.id) ? ' aperta' : ' chiusa'}`}
          style={{ left: door.x, top: door.y, width: door.vertical ? 8 : door.width, height: door.vertical ? door.width : 8 }}>
          <span>{door.symbol}</span>
        </div>
      ))}
      {room.lights.filter(light => !opened.has(light.id)).map(light => (
        <div key={light.id} className="matrix-light" data-symbol={light.symbol}
          style={{ left: light.x, top: light.y }} aria-label={`Luce ${light.symbol}`}>{light.symbol}</div>
      ))}
      {room.orbs.filter(orb => !(collected & orb.bit)).map(orb => (
        <div key={orb.bit} className="matrix-orb" style={{ left: orb.x, top: orb.y }} aria-label="Energia" />
      ))}
    </div>
  )
})

function collectInRoom(run, playSound) {
  const { sector, position } = run
  const opened = sector.lights.find(light => !run.opened.has(light.id) && distance(position, light) < 12)
  const orb = sector.orbs.find(item => !(run.collected.get(sector.key) & item.bit) && distance(position, item) < 12)
  if (opened) {
    run.opened = new Set(run.opened).add(opened.id)
    playSound('door')
  }
  if (orb && run.energy < MAX_ENERGY) {
    run.collected = new Map(run.collected).set(sector.key, (run.collected.get(sector.key) ?? 0) | orb.bit)
    run.energy = Math.min(MAX_ENERGY, run.energy + ORB_ENERGY)
    playSound('bonus')
  }
}

function enterRoom(run, seed) {
  const { col, row } = sectorAt(run.position)
  const key = sectorKey(col, row)
  if (key === run.sector.key) return
  const sectors = new Map(run.sectors)
  loadNearby(sectors, seed, col, row)
  run.sectors = sectors
  run.sector = sectors.get(key)

  const inactive = new Map(run.inactiveEnemies)
  run.enemies = run.enemies.filter(enemy => {
    const room = sectorAt(enemy)
    const roomKey = sectorKey(room.col, room.row)
    if (sectors.has(roomKey)) return true
    inactive.set(roomKey, [...(inactive.get(roomKey) ?? []), enemy])
    return false
  })
  for (const roomKey of sectors.keys()) {
    run.enemies.push(...(inactive.get(roomKey) ?? []))
    inactive.delete(roomKey)
  }
  run.inactiveEnemies = inactive
  populateNearby(run)
}

const PATROL_POINTS = [[285, 210], [515, 210], [515, 390], [285, 390]]
const PURSUIT_MEMORY = 80
const EXIT_LOOKAHEAD = 24

function updatePatrol(enemy, run, obstacles) {
  const seesPlayer = enemy.home === run.sector.key
  const speed = 4.1 * enemy.speedMultiplier * (run.boost ? ENEMY_SLOW_FACTOR : 1)
  if (seesPlayer) {
    const lead = enemy.role === 'flanker' ? 11 : enemy.role === 'aggressive' ? 6 : 0
    const intercept = { x: run.position.x + run.velocity.x * lead, y: run.position.y + run.velocity.y * lead }
    const target = obstacles.some(piece => crossesBarrier(run.position, intercept, piece)) ? run.position : intercept
    const lastSeen = { x: run.position.x, y: run.position.y }
    const memory = { x: lastSeen.x + run.velocity.x * EXIT_LOOKAHEAD, y: lastSeen.y + run.velocity.y * EXIT_LOOKAHEAD }
    return advanceEnemy({ ...enemy, memory, lastSeen, chaseUntil: run.frame + PURSUIT_MEMORY },
      target, obstacles, run.sectors, run.frame, speed)
  }

  if (run.frame < enemy.chaseUntil && distance(enemy, enemy.memory) > 10) {
    const goal = obstacles.some(piece => crossesBarrier(enemy.lastSeen, enemy.memory, piece)) ? enemy.lastSeen : enemy.memory
    if (distance(enemy, goal) > 10) return advanceEnemy(enemy, goal, obstacles, run.sectors, run.frame, speed)
  }

  const home = sectorAt(enemy.post)
  const patrolIndex = enemy.patrolIndex
  const patrolPoint = ([x, y]) => ({ x: home.col * GAME_WIDTH + x, y: home.row * GAME_HEIGHT + y })
  const nextIndex = distance(enemy, patrolPoint(PATROL_POINTS[patrolIndex])) < 12 ? (patrolIndex + 1) % PATROL_POINTS.length : patrolIndex
  const patrol = { ...enemy, patrolIndex: nextIndex, chaseUntil: 0 }
  if (enemy.chaseUntil) {
    patrol.path = []
    patrol.retry = 0
  }
  return advanceEnemy(patrol, patrolPoint(PATROL_POINTS[nextIndex]), obstacles, run.sectors, run.frame, speed * .48)
}

function soulTarget(position, soul) {
  return { x: position.x + soul.x, y: position.y + soul.y }
}

function App() {
  const [seed] = useState(() => seedFromText(new URLSearchParams(location.search).get('seme') || 'moscerino'))
  const [game, setGame] = useState(() => newRun(seed))
  const [leaderboard, setLeaderboard] = useState(readScores)
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('moscerino-player-name') || '')
  const nameRef = useRef(playerName)
  const leaderboardRef = useRef(leaderboard)
  const audioRef = useRef(null)
  const musicRef = useRef(null)

  const startMusic = useCallback(() => {
    try {
      const context = audioRef.current ||= new (window.AudioContext || window.webkitAudioContext)()
      if (context.state === 'suspended') void context.resume().catch(() => {})
      if (!musicRef.current) {
        musicRef.current = startSoundtrack(context, soundtrackUrl).catch(() => { musicRef.current = null })
      }
    } catch { /* Audio non disponibile nel browser */ }
  }, [])

  useEffect(() => () => {
    if (audioRef.current) void audioRef.current.close().catch(() => {})
    audioRef.current = null
    musicRef.current = null
  }, [])

  const playSound = useCallback((kind) => {
    try {
      const context = audioRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioRef.current = context;
      if (context.state === 'suspended') context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const tones = { cleanse: [392, 784, 0.45, 'sine'], boost: [220, 880, 0.24, 'sawtooth'], bonus: [520, 980, 0.13, 'sine'], hit: [240, 65, 0.32, 'triangle'], door: [320, 660, 0.18, 'sine'], transfer: [880, 260, 0.2, 'sine'] };
      const [start, end, duration, shape] = tones[kind];
      oscillator.type = shape;
      oscillator.frequency.setValueAtTime(start, now);
      oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch { /* Audio non disponibile nel browser */ }
  }, [])

  const runRef = useRef(game)
  const keysRef = useRef(new Set())
  const boostRequested = useRef(false)
  const cancelSoul = useRef(false)

  const saveScore = useCallback(score => {
    if (score <= 0) return
    const name = nameRef.current.trim().slice(0, 18) || 'Anonimo'
    const scores = [...leaderboardRef.current, { name, score, date: Date.now() }]
      .sort((a, b) => b.score - a.score || a.date - b.date).slice(0, 10)
    leaderboardRef.current = scores
    setLeaderboard(scores)
    try { localStorage.setItem('moscerino-leaderboard-v1', JSON.stringify(scores)) } catch { /* Spazio non disponibile */ }
  }, [])

  useEffect(() => {
    const keys = keysRef.current
    const movementKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']
    const keyDown = event => {
      if (event.target.closest?.('input, button, [contenteditable]')) return
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) boostRequested.current = true
        startMusic()
      } else if (movementKeys.includes(event.code || event.key)) {
        event.preventDefault()
        keys.add(event.code || event.key)
        startMusic()
      }
    }
    const keyUp = event => keys.delete(event.code || event.key)
    const clear = () => {
      keys.clear()
      boostRequested.current = false
      cancelSoul.current = true
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [startMusic])

  useEffect(() => {
    let animationFrame
    let previous = null
    let elapsed = 0
    let r1Held = false
    let padEngaged = false

    function tick(pad, requestBoost) {
      const run = { ...runRef.current }
      const keys = keysRef.current
      const stick = readStick(pad)
      const keyboardSoulX = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
      const keyboardSoulY = Number(keys.has('KeyS')) - Number(keys.has('KeyW'))
      const canceled = cancelSoul.current || (run.soulPad && !pad)
      cancelSoul.current = false
      if (canceled) {
        run.soulGesture = false
        run.soulPad = false
        run.soul = null
        run.soulLanding = null
      }
      const right = canceled ? null : soulStick(
        (pad?.axes[2] ?? 0) + keyboardSoulX,
        (pad?.axes[3] ?? 0) + keyboardSoulY,
        run.soulGesture
      )
      const ax = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')) + stick.x
      const ay = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp')) + stick.y
      const inputLength = Math.max(1, Math.hypot(ax, ay))
      const pressure = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1
        : Math.min(1, Math.max(0, pad?.buttons[7]?.value ?? 0))
      const slow = slowMotion(run.energy, pressure, run.exhausted)
      Object.assign(run, slow)
      run.worldStep += run.speed

      if (requestBoost && run.energy >= DASH_COST && run.boost === 0) {
        run.energy -= DASH_COST
        run.boost = BOOST_DURATION_FRAMES + 1
        playSound('boost')
      }

      let obstacles = solidBarriers(run)
      const hazardous = liveCircuits(run)
      const blockedPath = target => [...obstacles, ...hazardous]
        .some(piece => crossesBarrier(run.position, target, piece))
      if (right) {
        run.soulGesture = true
        run.soulPad = Boolean(pad && !keyboardSoulX && !keyboardSoulY)
        run.soul = moveSoul(run.soul, right)
        const target = soulTarget(run.position, run.soul)
        if (distance(run.position, target) > PLAYER_RADIUS && !blockedPath(target)) run.soulLanding = target
      } else if (run.soulGesture) {
        const target = run.soulLanding
        run.soulGesture = false
        run.soulPad = false
        run.soul = null
        run.soulLanding = null
        if (target && run.energy >= TRANSFER_COST && distance(run.position, target) > PLAYER_RADIUS && !blockedPath(target)) {
          run.energy -= TRANSFER_COST
          run.position = target
          run.trail = []
          enterRoom(run, seed)
          collectInRoom(run, playSound)
          obstacles = solidBarriers(run)
          playSound('transfer')
        }
      }

      // Input and energy use the fixed real-time clock. Movement and enemies use world time.
      if (run.worldStep < 1 - 1e-9) return run
      run.worldStep = Math.max(0, run.worldStep - 1)
      run.frame += 1
      run.boost = Math.max(0, run.boost - 1)
      const previousPosition = run.position
      const scale = run.boost ? PLAYER_BOOST_FACTOR : 1
      const velocity = {
        x: (run.velocity.x + ax / inputLength * 0.3) * PLAYER_FRICTION,
        y: (run.velocity.y + ay / inputLength * 0.3) * PLAYER_FRICTION
      }
      const position = { ...run.position }
      for (const axis of ['x', 'y']) {
        if (Math.abs(velocity[axis]) < 0.01) velocity[axis] = 0
        const next = { ...position, [axis]: position[axis] + velocity[axis] * scale }
        if (obstacles.some(piece => crossesBarrier(position, next, piece))) velocity[axis] = 0
        else position[axis] = next[axis]
      }

      run.velocity = velocity
      run.position = position
      enterRoom(run, seed)
      collectInRoom(run, playSound)
      obstacles = solidBarriers(run)
      const activeEnemies = run.enemies
      const live = liveCircuits(run)
      if (live.some(piece => crossesBarrier(previousPosition, position, piece))) {
        playSound('hit')
        saveScore(run.score)
        return newRun(seed)
      }
      const updated = activeEnemies.map(enemy => updatePatrol(enemy, run, obstacles))
      const nextEnemies = new Map(updated.map(enemy => [enemy.id, enemy]))
      const contacts = activeEnemies.filter(enemy => enemyContact(previousPosition, position, enemy, nextEnemies.get(enemy.id)))
      if (contacts.length && !run.boost) {
        playSound('hit')
        saveScore(run.score)
        return newRun(seed)
      }
      const killed = new Set(contacts.map(enemy => enemy.id))
      run.enemies = updated.filter(enemy => !killed.has(enemy.id))
      if (killed.size) {
        run.score += killed.size
        run.remaining = new Map(run.remaining)
        for (const enemy of contacts) {
          const remaining = run.remaining.get(enemy.home) - 1
          run.remaining.set(enemy.home, remaining)
          if (remaining === 0) {
            run.healthy = new Set(run.healthy).add(enemy.home)
            run.cleanseFrame = run.frame
            playSound('cleanse')
          }
        }
      }

      const bonus = run.bonus
      const bonusDistance = distance(position, bonus)
      if (bonusDistance < PLAYER_RADIUS + bonus.size / 2) {
        playSound('bonus')
        run.score += bonus.points
        const [dx, dy] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]
        let col = run.sector.col + dx * 2
        let row = run.sector.row + dy * 2
        if (col === 0 && row === 0) {
          col = run.sector.col - dx * 2
          row = run.sector.row - dy * 2
        }
        const next = createSector(seed, col, row)
        run.bonus = createBonus(next, BONUS_SIZES[Math.floor(Math.random() * BONUS_SIZES.length)])
      } else if (bonusDistance < BONUS_ATTRACTION_RADIUS) {
        const speed = bonusDistance < AUTO_ATTRACTION_RADIUS ? AUTO_ATTRACTION_SPEED
          : BONUS_ATTRACTION_SPEED * (1 - bonusDistance / BONUS_ATTRACTION_RADIUS) * (run.boost ? 1.5 : 1)
        const next = {
          ...bonus,
          x: bonus.x + (position.x - bonus.x) / bonusDistance * speed,
          y: bonus.y + (position.y - bonus.y) / bonusDistance * speed
        }
        if (!obstacles.some(piece => crossesBarrier(bonus, next, piece, bonus.size / 2))) run.bonus = next
      }

      run.trail = run.boost ? [...run.trail.slice(-13), { ...previousPosition, id: run.frame }] : run.trail.slice(2)
      return run
    }

    function gameLoop(timestamp) {
      elapsed += previous === null ? 0 : Math.min(timestamp - previous, 100)
      previous = timestamp
      if (elapsed >= FRAME_TIME) {
        const pad = Array.from(navigator.getGamepads?.() ?? []).find(gamepad => gamepad?.connected)
        const r1 = Boolean(pad?.buttons[5]?.pressed)
        const active = Boolean(r1 || pad?.buttons[7]?.value > 0 || pad?.axes.some(axis => Math.abs(axis) > 0.23))
        if (active && !padEngaged) startMusic()
        padEngaged = active
        let dash = boostRequested.current || (r1 && !r1Held)
        boostRequested.current = false
        r1Held = r1
        while (elapsed >= FRAME_TIME) {
          runRef.current = tick(pad, dash)
          dash = false
          elapsed -= FRAME_TIME
        }
        setGame(runRef.current)
      }
      animationFrame = requestAnimationFrame(gameLoop)
    }
    animationFrame = requestAnimationFrame(gameLoop)
    return () => cancelAnimationFrame(animationFrame)
  }, [playSound, saveScore, seed, startMusic])

  const { position, enemies, sectors, sector, bonus: bonusPosition, score, trail, energy, speed, soul } = game
  const isBoostActive = game.boost > 0
  const target = soul && soulTarget(position, soul)
  const barriers = target ? [...solidBarriers(game), ...liveCircuits(game)] : []
  const canTransfer = point => energy >= TRANSFER_COST && distance(position, point) > PLAYER_RADIUS &&
    !barriers.some(piece => crossesBarrier(position, point, piece))
  const blocked = target && !canTransfer(target)
  const landing = game.soulLanding
  const showLanding = blocked && landing && canTransfer(landing)
  const level = Math.floor(score / 5) + 1
  const freedOrgans = ORGAN_ROOMS.filter(key => game.healthy.has(key)).length
  const highScore = leaderboard[0]?.score || 0
  const waypoint = bonusWaypoint(seed, position, bonusPosition)
  const bonusAngle = Math.atan2(waypoint.y - position.y, waypoint.x - position.x)
  const bonusDistance = Math.round(distance(position, bonusPosition))
  const direction = ['E', 'SE', 'S', 'SO', 'O', 'NO', 'N', 'NE'][(Math.round(bonusAngle / (Math.PI / 4)) + 8) % 8]

  return (
    <main className="matrix-shell">
      <header className="matrix-header">
        <h1>The Chosen One</h1>
        <div className="player-profile">
          <label htmlFor="player-name">NOME GIOCATORE</label>
          <input id="player-name" maxLength={18} value={playerName} placeholder="Anonimo"
            onChange={event => {
              nameRef.current = event.target.value
              setPlayerName(event.target.value)
              try { localStorage.setItem('moscerino-player-name', event.target.value) } catch { /* Spazio non disponibile */ }
            }} />
        </div>
      </header>

      {/* Container principale */}
      <div className="game-container">
        {/* UI Bar */}
        <div className="ui-bar">
          <div className="info-text"><span>Livello</span><strong>{level}</strong></div>
          <div className="info-text"><span>Punteggio</span><strong>{score}</strong></div>
          <div className="info-text"><span>Record</span><strong>{highScore}</strong></div>
          <div className="matrix-energy">
            <label htmlFor="matrix-energy">Energia <strong>{Math.ceil(energy)}%</strong></label>
            <progress id="matrix-energy" max={MAX_ENERGY} value={energy} />
          </div>
        </div>

        {/* Game Area */}
        <div className={`game-area${speed === 0 ? ' time-stopped' : ''}${speed < 1 ? ' time-dilated' : ''}${isBoostActive ? ' dash-active' : ''}`}
          onPointerDown={startMusic} style={{ '--slow': 1 - speed }}>
          <div className="arena-location">
            <span className="tissue-status">{sector.tissue} · {game.healthy.has(sector.key) ? 'Sana' : `Infetta · ${game.remaining.get(sector.key) ?? 0}`}</span>
            <span data-pressure={sector.pressure}>Distanza {Math.round(distanceFromOrigin(position))} · Pressione {sector.pressure}/5</span>
            <span data-time-scale={speed}>{speed === 0 ? 'Tempo fermo' : `Tempo ${Math.round(speed * 100)}%`}</span>
            <span>Bonus {direction} · {bonusDistance}</span>
          </div>
          {game.frame - game.cleanseFrame < 85 && <div className="cleanse-signal" role="status">Tessuto bonificato</div>}
          <div className="arena-world" style={{ transformOrigin: '0 0', transform: `translate(50%, 50%) scale(0.95238) translate(${-position.x}px, ${-position.y}px)` }}>
            {[...sectors.values()].map(room => (
              <Room healthy={game.healthy.has(room.key)} key={room.key} room={room} opened={game.opened} collected={game.collected.get(room.key) ?? 0} liveMask={room.circuits.reduce((mask, piece, index) => mask | (Number(circuitActive(piece, game.frame)) << index), 0)} />
            ))}
            {showLanding && <div className="soul-landing" style={{ left: landing.x, top: landing.y }} aria-label="Ultima posizione valida" />}
            {target && (
              <>
                <div className={`soul-link${blocked ? ' is-blocked' : ''}`} style={{
                  left: position.x, top: position.y, width: Math.hypot(soul.x, soul.y),
                  transform: `rotate(${Math.atan2(soul.y, soul.x)}rad)`
                }} />
                <div className={`matrix-soul${blocked ? ' is-blocked' : ''}`}
                  style={{ left: target.x, top: target.y }}
                  aria-label={blocked ? 'Anima, trasferimento non disponibile' : 'Anima, trasferimento disponibile'} />
              </>
            )}

            {/* Bonus */}
            {bonusPosition && (
              <div className={`bonus${bonusPosition.points > 1 ? ' bonus-rich' : ''}`} style={{
                position: 'absolute',
                left: bonusPosition.x - bonusPosition.size / 2,
                top: bonusPosition.y - bonusPosition.size / 2,
                width: bonusPosition.size,
                height: bonusPosition.size,
                willChange: 'transform'
              }}></div>
            )}

            {/* Utilizzo del componente Enemy memorizzato per ogni nemico */}
            {enemies.map((enemy) => (
              <Enemy key={`enemy-${enemy.id}`} enemy={enemy} />
            ))}
            {trail.map((point, index) => (
              <div key={point.id} className="boost-trail" style={{
                left: point.x - PLAYER_RADIUS, top: point.y - PLAYER_RADIUS,
                opacity: (index + 1) / trail.length * 0.8,
                transform: `scale(${0.4 + index / trail.length * 0.9})`
              }} />
            ))}

            {/* Giocatore - con effetto trail durante il boost */}
            <div className={`player ${isBoostActive ? 'player-boost' : ''}`} style={{
              position: 'absolute',
              left: position.x - PLAYER_RADIUS,
              top: position.y - PLAYER_RADIUS,
              width: PLAYER_RADIUS * 2,
              height: PLAYER_RADIUS * 2,
              willChange: 'transform'
            }}></div>
          </div>
        </div>
      </div>
      <p className="body-guide"><strong>{freedOrgans === 4 ? 'Quattro organi liberati' : `Organi liberati ${freedOrgans}/4`}</strong> · Ultimo anticorpo · Dal plesso solare: cuore a est, polmoni a ovest, fegato a sud, cervello due stanze a nord.</p>
      <ul className="matrix-controls" aria-label="Comandi">
        <li><kbd>Analogico sinistro / Frecce</kbd> Movimento</li>
        <li><kbd>R1 / Spazio</kbd> Scatta contro i patogeni per eliminarli</li>
        <li><kbd>R2 / Maiusc</kbd> Tempo</li>
        <li><kbd>Analogico destro / WASD</kbd> Anima, rilascia per trasferirti</li>
      </ul>
      <section className="leaderboard" aria-label="Classifica locale">
        <h2>CLASSIFICA <small>salvata su questo dispositivo</small></h2>
        {leaderboard.length ? <ol>{leaderboard.map((entry, index) => (
          <li key={`${entry.date}-${index}`}><span>{entry.name}</span><strong>{entry.score}</strong></li>
        ))}</ol> : <p>Gioca e raccogli punti per entrare in classifica.</p>}
      </section>
    </main>
  )
}

export default React.memo(App)
