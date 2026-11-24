import React, { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import {
  WIDTH as GAME_WIDTH, HEIGHT as GAME_HEIGHT, RADIUS as PLAYER_RADIUS, ORIGIN,
  bonusWaypoint, circuitActive, createBonus, crossesBarrier, distanceFromOrigin, hitsObstacle, loadNearby, sectorAt, sectorKey, seedFromText
} from './arena.js'
import { DASH_COST, MAX_ENERGY, ORB_ENERGY, TRANSFER_COST, moveSoul, slowMotion, soulStick } from './powers.js'
import { soundtrackUrl, startSoundtrack } from './soundtrack.js'

const PREDICTION_FACTOR = 25 // Quanto "avanti" guardano i nemici
const ENEMY_BASE_ACCELERATION = 0.2 // Accelerazione base nemici
const ENEMY_FRICTION = 0.96        // Frizione nemici
const SPEED_MULTIPLIERS = { slow: 0.7, medium: 0.9, fast: 1.1 };
const BONUS_GUARD_RADIUS = 200 // Raggio entro cui il guardiano INIZIA ad attaccare
const DISENGAGE_RADIUS = 400  // Raggio OLTRE cui il guardiano SMETTE di attaccare
const GUARD_PATROL_RADIUS = 100 // Distanza entro cui il guardiano rallenta vicino al bonus
const SENTINEL_AGGRO_RADIUS = 400 // Raggio inseguimento sentinelle
const BONUS_SIZES = [8, 10, 12] // Dimensioni possibili per i bonus (piccolo, medio, grande)
const PLAYER_FRICTION = 0.93// Frizione del giocatore (ridotta inerzia)
const AUTO_ATTRACTION_RADIUS = 2 // Raggio entro cui il bonus viene attratto automaticamente
const AUTO_ATTRACTION_SPEED = 1 // Velocità di attrazione automatica

const OBSTACLE_AVOIDANCE_RADIUS = 40

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
  const speeds = Object.values(SPEED_MULTIPLIERS)
  return {
    ...point,
    id: nextEnemyId++,
    home: sector.key,
    role: roles[Math.floor(Math.random() * roles.length)],
    vx: 0, vy: 0, isEngaged: false, patrolTarget: null,
    speedMultiplier: speeds[Math.min(2, Math.floor(Math.random() * (sector.pressure >= 2 ? 3 : 1)))],
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
  return {
    position: ORIGIN, velocity: { x: 0, y: 0 }, sectors, sector,
    enemies: spawnEnemies(sector, ORIGIN, [], 1),
    bonus: createBonus(sector, BONUS_SIZES[1], true),
    score: 0, trail: [], boost: 0, frame: 0,
    energy: MAX_ENERGY, worldStep: 0, speed: 1, exhausted: false, soul: null,
    opened: new Set(), collected: new Map(), soulGesture: false, soulLanding: null
  }
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
  return [...run.sectors.values()].flatMap(room => room.circuits)
    .filter(circuit => circuitActive(circuit, run.frame))
}

const Obstacle = React.memo(function Obstacle({ obstacle, className = 'matrix-wall' }) {
  return obstacle.segments.map(([x, y, width, height], index) => (
    <div key={index} className={className}
      style={{ left: obstacle.x + x, top: obstacle.y + y, width, height }} />
  ))
})

const Room = React.memo(function Room({ room, opened, collected, liveMask }) {
  return (
    <div className="matrix-room" data-room={room.key} data-pressure={room.pressure}>
      <div className="sector-floor" data-band={room.pressure}
        style={{ left: room.x, top: room.y, width: GAME_WIDTH, height: GAME_HEIGHT }}>
        <span className="room-coordinate" aria-hidden="true">{room.col} / {room.row}</span>
      </div>
      {room.traces.map((trace, index) => <div key={index} className="matrix-trace" style={trace} aria-hidden="true" />)}
      {room.obstacles.map(obstacle => <Obstacle key={obstacle.id} obstacle={obstacle} />)}
      {room.circuits.map((circuit, index) => <Obstacle key={circuit.id} obstacle={circuit}
        className={liveMask & (1 << index) ? 'matrix-circuit is-live' : 'matrix-circuit'} />)}
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
  // The local pressure determines the next encounter, including on a return trip.
  const sector = run.sector
  run.enemies = spawnEnemies(sector, run.position, [], sector.pressure + 1)
}

function soulTarget(position, soul) {
  return { x: position.x + soul.x, y: position.y + soul.y }
}

// Calcola vettore di evitamento per un ostacolo
const calculateAvoidanceVector = (entity, obstacle) => {
  const dx = entity.x - obstacle.x;
  const dy = entity.y - obstacle.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) return { x: 1, y: 0 }; // Evita divisione per zero

  // Normalizza e scala in base alla distanza
  const strength = Math.min(1.0, OBSTACLE_AVOIDANCE_RADIUS / dist);
  return {
    x: (dx / dist) * strength,
    y: (dy / dist) * strength
  };
};

// Funzione ottimizzata per aggiornare lo stato dei nemici
function updateEnemies(enemies, playerPos, playerVel, bonusPos, isBoostMode, obstacles, sectors) {
  // Se il boost è attivo, i nemici rallentano leggermente
  const timeScale = isBoostMode ? ENEMY_SLOW_FACTOR : 1.0;
  const predictedX = playerPos.x + playerVel.x * PREDICTION_FACTOR;
  const predictedY = playerPos.y + playerVel.y * PREDICTION_FACTOR;

  // Primo passo: filtra eventuali nemici che hanno colpito ostacoli
  let updatedEnemies = enemies.filter(enemy => {
    // Controlla collisioni con ostacoli
    for (const obstacle of obstacles) {
      if (hitsObstacle(enemy, obstacle)) {
        return false; // Nemico eliminato
      }
    }
    return true;
  });

  // Secondo passo: aggiorna posizione e velocità
  updatedEnemies = updatedEnemies.map((enemy, index) => {
    let targetX = predictedX;
    let targetY = predictedY;
    let accelX = 0;
    let accelY = 0;
    let currentAccelerationFactor = ENEMY_BASE_ACCELERATION * enemy.speedMultiplier;
    let nextIsEngaged = enemy.isEngaged;
    let nextPatrolTarget = enemy.patrolTarget;

    // Modifica del target in base al livello di intelligenza
    if (enemy.intelligence === INTELLIGENCE_LEVELS.low) {
      // Poco intelligenti: inseguimento diretto del giocatore
      targetX = playerPos.x;
      targetY = playerPos.y;

    } else if (enemy.intelligence === INTELLIGENCE_LEVELS.medium) {
      // Intelligenti: anticipano le mosse del giocatore
      // Calcola una posizione anticipata basata sul movimento e velocità attuali
      const anticipationFactor = 25 + Math.random() * 15; // Più randomico di PREDICTION_FACTOR
      targetX = playerPos.x + playerVel.x * anticipationFactor;
      targetY = playerPos.y + playerVel.y * anticipationFactor;

      // Aggiungi un po' di randomicità per simulare l'intelligenza
      targetX += (Math.random() - 0.5) * 40;
      targetY += (Math.random() - 0.5) * 40;

    } else if (enemy.intelligence === INTELLIGENCE_LEVELS.high) {
      // Molto intelligenti: comportamento strategico
      if (bonusPos) {
        // Calcola la direzione dal giocatore al bonus
        const towardsBonusX = bonusPos.x - playerPos.x;
        const towardsBonusY = bonusPos.y - playerPos.y;
        const distToBonus = Math.sqrt(towardsBonusX * towardsBonusX + towardsBonusY * towardsBonusY);

        if (distToBonus > 0 && distToBonus < 200) {
          // Il giocatore sembra dirigersi verso il bonus: intercetta
          // Cerca di mettersi tra il giocatore e il bonus
          const interceptX = playerPos.x + (towardsBonusX / distToBonus) * (distToBonus * 0.7);
          const interceptY = playerPos.y + (towardsBonusY / distToBonus) * (distToBonus * 0.7);

          targetX = interceptX;
          targetY = interceptY;
        } else {
          // Anticipa le mosse del giocatore in modo avanzato
          const advancedAnticipationFactor = 30 + Math.random() * 20;

          // Prova a predire dove il giocatore andrà in base alla sua direzione attuale
          // Aggiungi un po' di casualità per simulare "intuizione"
          const directionChangeProbability = Math.random();

          if (directionChangeProbability > 0.7) {
            // Simula che il nemico "preveda" un cambio di direzione
            targetX = playerPos.x - playerVel.x * advancedAnticipationFactor;
            targetY = playerPos.y - playerVel.y * advancedAnticipationFactor;
          } else {
            // Usa la previsione normale ma migliorata
            targetX = playerPos.x + playerVel.x * advancedAnticipationFactor;
            targetY = playerPos.y + playerVel.y * advancedAnticipationFactor;
          }

          // Aggiungi randomicità per comportamento più imprevedibile
          targetX += (Math.random() - 0.5) * 30;
          targetY += (Math.random() - 0.5) * 30;
        }
      }
    }

    // Logica target basata sul ruolo (sovrascrive il target di intelligenza in casi specifici)
    if (enemy.role === 'guard' && bonusPos) {
      const playerDistToBonus = distance(playerPos, bonusPos)
      const enemyDistToBonus = distance(enemy, bonusPos)

      if (enemy.isEngaged) {
        // Attualmente sta attaccando
        targetX = predictedX
        targetY = predictedY
        // Controlla se deve disingaggiare
        if (playerDistToBonus > DISENGAGE_RADIUS) {
          nextIsEngaged = false; // Torna a difendere nel prossimo frame
        }
      } else {
        // Attualmente sta difendendo
        // Controlla se deve ingaggiare
        if (playerDistToBonus <= BONUS_GUARD_RADIUS) {
          nextIsEngaged = true; // Inizia ad attaccare nel prossimo frame
          targetX = predictedX // Inizia subito a puntare al giocatore
          targetY = predictedY
        } else {
          // Continua a difendere
          targetX = bonusPos.x
          targetY = bonusPos.y
          if (enemyDistToBonus < GUARD_PATROL_RADIUS) {
            currentAccelerationFactor *= 0.1; // Rallenta ancora di più il pattugliamento lento
            const vecToBonusX = bonusPos.x - enemy.x;
            const vecToBonusY = bonusPos.y - enemy.y;
            const distToBonus = Math.sqrt(vecToBonusX * vecToBonusX + vecToBonusY * vecToBonusY) || 1;
            accelX = -vecToBonusY / distToBonus;
            accelY = vecToBonusX / distToBonus;
            if (distToBonus < GUARD_PATROL_RADIUS * 0.8) {
              accelX -= (vecToBonusX / distToBonus) * 0.5;
              accelY -= (vecToBonusY / distToBonus) * 0.5;
            }
            const accelLen = Math.sqrt(accelX*accelX + accelY*accelY) || 1;
            accelX /= accelLen;
            accelY /= accelLen;
          } // Altrimenti (fuori raggio patrol), accelera normalmente verso il bonus (calcolato dopo)
        }
      }
    } else if (enemy.role === 'flanker') {
      const flankOffset = 50
      const vecToPlayerX = playerPos.x - enemy.x
      const vecToPlayerY = playerPos.y - enemy.y
      let len = Math.sqrt(vecToPlayerX*vecToPlayerX + vecToPlayerY*vecToPlayerY)
      len = len === 0 ? 1 : len
      const perpX = -vecToPlayerY / len
      const perpY = vecToPlayerX / len
      const side = (index % 2 === 0) ? 1 : -1
      targetX = predictedX + perpX * flankOffset * side
      targetY = predictedY + perpY * flankOffset * side
    } else if (enemy.role === 'sentinel') {
      const playerDist = distance(playerPos, enemy);
      if (playerDist <= SENTINEL_AGGRO_RADIUS) {
        // INSEGUE GIOCATORE
        targetX = predictedX;
        targetY = predictedY;
      } else {
        // PATTUGLIA
        if (!enemy.patrolTarget || distance(enemy, enemy.patrolTarget) < 20) {
          // Se non ha un target o l'ha raggiunto, ne genera uno nuovo
          const home = sectors.get(enemy.home);
          nextPatrolTarget = { x: home.x + ORIGIN.x, y: home.y + 90 + Math.random() * (GAME_HEIGHT - 180) };
        }
        // Punta al target di pattuglia corrente (o a quello appena generato)
        targetX = nextPatrolTarget ? nextPatrolTarget.x : enemy.x; // Se null, sta fermo? No, punta a se stesso
        targetY = nextPatrolTarget ? nextPatrolTarget.y : enemy.y;
      }
    } // 'aggressive' usa targetX/Y predefiniti (predictedX)

    // Calcola accelerazione verso il target (se non già calcolata dal guardiano in pattuglia)
    if (accelX === 0 && accelY === 0) {
      const dx = targetX - enemy.x
      const dy = targetY - enemy.y
      let length = Math.sqrt(dx * dx + dy * dy)
      if (length > 1) { // Applica accelerazione solo se c'è distanza da coprire
         length = length === 0 ? 1 : length
         accelX = (dx / length)
         accelY = (dy / length)
      }
    }

    // Evitamento ostacoli per nemici intelligenti e molto intelligenti
    if (enemy.intelligence === INTELLIGENCE_LEVELS.medium ||
        enemy.intelligence === INTELLIGENCE_LEVELS.high) {
      // Calcola vettori di evitamento per tutti gli ostacoli vicini
      let avoidX = 0;
      let avoidY = 0;

      for (const obstacle of obstacles) {
        const obstacleDistance = distance(enemy, obstacle);

        if (obstacleDistance < OBSTACLE_AVOIDANCE_RADIUS) {
          const avoidVector = calculateAvoidanceVector(enemy, obstacle);
          const avoidStrength = enemy.intelligence === INTELLIGENCE_LEVELS.high ? 1.5 : 1.0;

          avoidX += avoidVector.x * avoidStrength;
          avoidY += avoidVector.y * avoidStrength;
        }
      }

      // Combina vettore di avoidance con la direzione corrente
      if (avoidX !== 0 || avoidY !== 0) {
        // Normalizza il vettore di evitamento
        const avoidMagnitude = Math.sqrt(avoidX * avoidX + avoidY * avoidY);
        if (avoidMagnitude > 0) {
          avoidX /= avoidMagnitude;
          avoidY /= avoidMagnitude;
        }

        // Mix evitamento con accelerazione originale
        const mixFactor = enemy.intelligence === INTELLIGENCE_LEVELS.high ? 0.7 : 0.5;
        accelX = accelX * (1 - mixFactor) + avoidX * mixFactor;
        accelY = accelY * (1 - mixFactor) + avoidY * mixFactor;

        // Rinormalizza
        const newAccelMagnitude = Math.sqrt(accelX * accelX + accelY * accelY);
        if (newAccelMagnitude > 0) {
          accelX /= newAccelMagnitude;
          accelY /= newAccelMagnitude;
        }
      }
    }

    // Aggiorna velocità del nemico con inerzia
    let newVx = (enemy.vx + accelX * currentAccelerationFactor) * ENEMY_FRICTION
    let newVy = (enemy.vy + accelY * currentAccelerationFactor) * ENEMY_FRICTION
    if (Math.abs(newVx) < 0.01) newVx = 0;
    if (Math.abs(newVy) < 0.01) newVy = 0;

    // Applica velocità alla posizione del nemico SCALATA per boost
    const newX = enemy.x + newVx * timeScale
    const newY = enemy.y + newVy * timeScale

    // Ritorna il nemico aggiornato senza ancora risolvere collisioni
    return {
      ...enemy,
      x: newX,
      y: newY,
      vx: newVx,
      vy: newVy,
      isEngaged: nextIsEngaged,
      patrolTarget: nextPatrolTarget
    }
  });

  // Terzo passo: Risolvi le collisioni tra nemici
  const enemiesToRemove = new Set();

  for (let i = 0; i < updatedEnemies.length; i++) {
    for (let j = i + 1; j < updatedEnemies.length; j++) {
      const enemy1 = updatedEnemies[i];
      const enemy2 = updatedEnemies[j];

      const dx = enemy2.x - enemy1.x;
      const dy = enemy2.y - enemy1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const totalRadius = PLAYER_RADIUS * 2;

      if (dist < totalRadius) {
        enemiesToRemove.add(i);
        enemiesToRemove.add(j);
      }
    }
  }

  if (enemiesToRemove.size > 0) {
    updatedEnemies = updatedEnemies.filter((_, index) => !enemiesToRemove.has(index));
  }

  return updatedEnemies.filter(enemy => {
    const home = sectors.get(enemy.home);
    return distance(enemy, { x: home.x + ORIGIN.x, y: home.y + ORIGIN.y }) < GAME_WIDTH;
  });
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
      const tones = { boost: [220, 880, 0.24, 'sawtooth'], bonus: [520, 980, 0.13, 'sine'], hit: [240, 65, 0.32, 'triangle'], door: [320, 660, 0.18, 'sine'], transfer: [880, 260, 0.2, 'sine'] };
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
    let crossHeld = false
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
      const updated = updateEnemies(activeEnemies, position, velocity, run.bonus, Boolean(run.boost), [...obstacles, ...live], run.sectors)
      const nextEnemies = new Map(updated.map(enemy => [enemy.id, enemy]))
      if (activeEnemies.some(enemy => enemyContact(previousPosition, position, enemy, nextEnemies.get(enemy.id)))) {
        playSound('hit')
        saveScore(run.score)
        return newRun(seed)
      }
      run.enemies = updated

      const bonus = run.bonus
      const bonusDistance = distance(position, bonus)
      if (bonusDistance < PLAYER_RADIUS + bonus.size / 2) {
        playSound('bonus')
        run.score += bonus.points
        const [dx, dy] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]
        const next = run.sectors.get(sectorKey(run.sector.col + dx, run.sector.row + dy))
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
        const cross = Boolean(pad?.buttons[0]?.pressed)
        const active = Boolean(cross || pad?.buttons[7]?.value > 0 || pad?.axes.some(axis => Math.abs(axis) > 0.23))
        if (active && !padEngaged) startMusic()
        padEngaged = active
        let dash = boostRequested.current || (cross && !crossHeld)
        boostRequested.current = false
        crossHeld = cross
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
            <span data-pressure={sector.pressure}>Distanza {Math.round(distanceFromOrigin(position))} · Pressione {sector.pressure}/5</span>
            <span data-time-scale={speed}>{speed === 0 ? 'Tempo fermo' : `Tempo ${Math.round(speed * 100)}%`}</span>
            <span>Bonus {direction} · {bonusDistance}</span>
          </div>
          <div className="arena-world" style={{ transform: `translate3d(calc(50% - ${position.x}px), calc(50% - ${position.y}px), 0)` }}>
            {[...sectors.values()].map(room => (
              <Room key={room.key} room={room} opened={game.opened} collected={game.collected.get(room.key) ?? 0} liveMask={room.circuits.reduce((mask, piece, index) => mask | (Number(circuitActive(piece, game.frame)) << index), 0)} />
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
      <ul className="matrix-controls" aria-label="Comandi">
        <li><kbd>Analogico sinistro / Frecce</kbd> Movimento</li>
        <li><kbd>× / Spazio</kbd> Scatto</li>
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
