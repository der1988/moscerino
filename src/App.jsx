import React, { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import {
  WIDTH as GAME_WIDTH, HEIGHT as GAME_HEIGHT, RADIUS as PLAYER_RADIUS, ORIGIN,
  bonusWaypoint, createBonus, hitsObstacle, loadNearby, obstacleActive, sectorAt, sectorKey, seedFromText
} from './arena.js'

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

// Boost Mode Constants (sostituisce Slow Motion)
const BOOST_DURATION_FRAMES = 20; // Durata boost: circa 0.3 secondi a 60fps
const BOOST_COOLDOWN_FRAMES = 10 * 60; // 10 secondi a 60fps
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
  const roles = sector.pressure ? sector.zone.roles : ['aggressive', 'flanker', 'guard', 'sentinel']
  const speeds = Object.values(SPEED_MULTIPLIERS)
  return {
    ...point,
    id: nextEnemyId++,
    home: sector.key,
    role: roles[Math.floor(Math.random() * roles.length)],
    vx: 0, vy: 0, isEngaged: false, patrolTarget: null,
    speedMultiplier: speeds[Math.floor(Math.random() * speeds.length)],
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
    enemies: spawnEnemies(sector, ORIGIN, [], 1), visited: new Set([sector.key]),
    bonus: createBonus(sector, BONUS_SIZES[1], true),
    score: 0, trail: [], boost: 0, cooldown: 0, frame: 0
  }
}

function readStick(pad) {
  const x = pad?.axes[0] ?? 0
  const y = pad?.axes[1] ?? 0
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

const Obstacle = React.memo(function Obstacle({ obstacle, active }) {
  return obstacle.segments.map(([x, y, width, height], index) => (
    <div
      key={index}
      className={`obstacle obstacle-${obstacle.type}${active ? '' : ' obstacle-inactive'}`}
      style={{ position: 'absolute', left: obstacle.x + x, top: obstacle.y + y, width, height, '--circuit-color': obstacle.color }}
    />
  ))
})

const SectorFloor = React.memo(function SectorFloor({ sector }) {
  return (
    <div className="sector-floor" style={{
      left: sector.x, top: sector.y, width: GAME_WIDTH, height: GAME_HEIGHT, '--circuit-color': sector.zone.color
    }} />
  )
})

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

// Game loop ottimizzato basato su requestAnimationFrame con frame throttling

function App() {
  const [seed] = useState(() => seedFromText(new URLSearchParams(location.search).get('seme') || 'moscerino'))
  const [game, setGame] = useState(() => newRun(seed))
  const [leaderboard, setLeaderboard] = useState(readScores)
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('moscerino-player-name') || '')
  const nameRef = useRef(playerName)
  const leaderboardRef = useRef(leaderboard)
  const audioRef = useRef(null)

  const playSound = useCallback((kind) => {
    try {
      const context = audioRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioRef.current = context;
      if (context.state === 'suspended') context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const tones = { boost: [220, 880, 0.24, 'sawtooth'], bonus: [520, 980, 0.13, 'sine'], hit: [240, 65, 0.32, 'triangle'] };
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
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    const keyDown = event => {
      if (event.target.closest?.('input, button, [contenteditable]')) return
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) boostRequested.current = true
      } else if (arrows.includes(event.key)) {
        event.preventDefault()
        keys.add(event.key)
      }
    }
    const keyUp = event => keys.delete(event.key)
    const clear = () => {
      keys.clear()
      boostRequested.current = false
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
  }, [])

  useEffect(() => {
    let animationFrame
    let previous = null
    let elapsed = 0
    let r1Held = false

    function tick(pad, requestBoost) {
      const run = runRef.current
      const frame = run.frame + 1
      const keys = keysRef.current
      const stick = readStick(pad)
      const ax = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')) + stick.x
      const ay = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp')) + stick.y
      const inputLength = Math.max(1, Math.hypot(ax, ay))
      let boost = Math.max(0, run.boost - 1)
      let cooldown = Math.max(0, run.cooldown - 1)
      if (requestBoost && run.cooldown === 0) {
        boost = BOOST_DURATION_FRAMES
        cooldown = BOOST_COOLDOWN_FRAMES
        playSound('boost')
      }

      const vx = (run.velocity.x + ax / inputLength * 0.3) * PLAYER_FRICTION
      const vy = (run.velocity.y + ay / inputLength * 0.3) * PLAYER_FRICTION
      const velocity = { x: Math.abs(vx) < 0.01 ? 0 : vx, y: Math.abs(vy) < 0.01 ? 0 : vy }
      const scale = boost ? PLAYER_BOOST_FACTOR : 1
      const position = { x: run.position.x + velocity.x * scale, y: run.position.y + velocity.y * scale }
      const { col, row } = sectorAt(position)
      const key = sectorKey(col, row)
      const sectorChanged = key !== run.sector.key
      const sectors = sectorChanged ? new Map(run.sectors) : run.sectors
      if (sectorChanged) loadNearby(sectors, seed, col, row)
      const sector = sectors.get(key)
      const obstacles = [...sectors.values()].flatMap(item => item.obstacles)
        .filter(piece => obstacleActive(piece, frame))
      // A wall is only eight pixels thick. Check between frames during a boost.
      const midpoint = { x: (position.x + run.position.x) / 2, y: (position.y + run.position.y) / 2 }

      const activeEnemies = run.enemies.filter(enemy => sectors.has(enemy.home))
      const updated = updateEnemies(activeEnemies, position, velocity, run.bonus, Boolean(boost), obstacles, sectors)
      const nextEnemies = new Map(updated.map(enemy => [enemy.id, enemy]))
      if (activeEnemies.some(enemy => enemyContact(run.position, position, enemy, nextEnemies.get(enemy.id))) ||
          obstacles.some(piece => hitsObstacle(position, piece) || hitsObstacle(midpoint, piece))) {
        playSound('hit')
        saveScore(run.score)
        return newRun(seed)
      }

      const visited = sectorChanged ? new Set([...run.visited].filter(id => sectors.has(id))) : run.visited
      let enemies = updated
      if (!visited.has(key)) {
        visited.add(key)
        enemies = spawnEnemies(sector, position, enemies, sector.pressure + 1)
      }

      let bonus = run.bonus
      let score = run.score
      const bonusDistance = distance(position, bonus)
      if (bonusDistance < PLAYER_RADIUS + bonus.size / 2) {
        playSound('bonus')
        score += bonus.points
        cooldown = 0
        const level = Math.floor(score / 5) + 1
        const localCount = enemies.filter(enemy => enemy.home === key).length
        enemies = spawnEnemies(sector, position, enemies, Math.min(level, Math.max(0, 3 + sector.pressure - localCount)))
        const [dx, dy] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]
        const next = sectors.get(sectorKey(col + dx, row + dy))
        bonus = createBonus(next, BONUS_SIZES[Math.floor(Math.random() * BONUS_SIZES.length)])
      } else if (bonusDistance < BONUS_ATTRACTION_RADIUS) {
        const speed = bonusDistance < AUTO_ATTRACTION_RADIUS ? AUTO_ATTRACTION_SPEED
          : BONUS_ATTRACTION_SPEED * (1 - bonusDistance / BONUS_ATTRACTION_RADIUS) * (boost ? 1.5 : 1)
        const next = {
          ...bonus,
          x: bonus.x + (position.x - bonus.x) / bonusDistance * speed,
          y: bonus.y + (position.y - bonus.y) / bonusDistance * speed
        }
        // Keep attraction on the bonus side of a wall.
        if (!obstacles.some(piece => hitsObstacle(next, piece, bonus.size / 2))) bonus = next
      }

      const trail = boost ? [...run.trail.slice(-13), { ...run.position, id: frame }] : run.trail.slice(2)
      return { position, velocity, sectors, sector, enemies, visited, bonus, score, trail, boost, cooldown, frame }
    }

    function gameLoop(timestamp) {
      elapsed += previous === null ? 0 : Math.min(timestamp - previous, 100)
      previous = timestamp
      if (elapsed >= FRAME_TIME) {
        const pad = Array.from(navigator.getGamepads?.() ?? []).find(gamepad => gamepad?.connected)
        const r1 = Boolean(pad?.buttons[5]?.pressed)
        let request = boostRequested.current || (r1 && !r1Held)
        boostRequested.current = false
        r1Held = r1
        while (elapsed >= FRAME_TIME) {
          runRef.current = tick(pad, request)
          request = false
          elapsed -= FRAME_TIME
        }
        setGame(runRef.current)
      }
      animationFrame = requestAnimationFrame(gameLoop)
    }
    animationFrame = requestAnimationFrame(gameLoop)
    return () => cancelAnimationFrame(animationFrame)
  }, [playSound, saveScore, seed])

  const { position, enemies, sectors, sector, bonus: bonusPosition, score, trail, frame } = game
  const boostDurationTimer = game.boost
  const boostCooldownTimer = game.cooldown
  const isBoostActive = boostDurationTimer > 0
  const level = Math.floor(score / 5) + 1
  const highScore = leaderboard[0]?.score || 0
  const matrixModeColor = isBoostActive || !boostCooldownTimer ? '#0ff' : '#0f0'
  const waypoint = bonusWaypoint(seed, position, bonusPosition)
  const bonusAngle = Math.atan2(waypoint.y - position.y, waypoint.x - position.x)
  const bonusDistance = Math.round(distance(position, bonusPosition))
  const direction = ['E', 'SE', 'S', 'SO', 'O', 'NO', 'N', 'NE'][(Math.round(bonusAngle / (Math.PI / 4)) + 8) % 8]

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'column',
      backgroundColor: '#000'
    }}>
      {/* Titolo */}
      <div style={{
        color: '#0f0',
        textShadow: '0 0 10px #0f0, 0 0 5px #fff',
        marginBottom: '20px',
        zIndex: 2,
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fontSize: '36px',
        letterSpacing: '2px'
      }}>
        THE CHOSEN ONE
      </div>
      <div className="player-profile">
        <label htmlFor="player-name">NOME GIOCATORE</label>
        <input id="player-name" maxLength={18} value={playerName} placeholder="Anonimo"
          onChange={event => {
            nameRef.current = event.target.value;
            setPlayerName(event.target.value);
            try { localStorage.setItem('moscerino-player-name', event.target.value); } catch { /* Spazio non disponibile */ }
          }} />
        <span>Frecce / analogico sinistro · Spazio / R1</span>
      </div>

      {/* Container principale */}
      <div className="game-container">
        {/* UI Bar */}
        <div className="ui-bar" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div className="info-text" style={{
            fontSize: '14px',
            minWidth: '100px',
            textAlign: 'left'
          }}>
            LEVEL: {level}
          </div>

          <div className="info-text" style={{
            fontSize: '14px',
            flex: 1,
            textAlign: 'center'
          }}>
            SCORE: {score} | HIGH: {highScore}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            minWidth: '250px',
            justifyContent: 'flex-end'
          }}>
            <span className="cooldown-label" style={{
              fontSize: '12px',
              marginRight: '5px'
            }}>
              MATRIX MODE:
            </span>
            <div className="cooldown-bar" style={{ width: '120px', height: '15px' }}>
              <div className="cooldown-progress" style={{
                width: `${isBoostActive
                  ? `${(1 - boostDurationTimer / BOOST_DURATION_FRAMES) * 100}%`
                  : boostCooldownTimer === 0
                    ? '100%'
                    : `${(1 - boostCooldownTimer / BOOST_COOLDOWN_FRAMES) * 100}%`
                }`,
                height: '100%',
                backgroundColor: matrixModeColor,
                boxShadow: `0 0 5px ${matrixModeColor}`
              }}></div>
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div className="game-area">
          <div className="arena-location" style={{ '--circuit-color': sector.zone.color }}>
            <span>{sector.zone.name} · Settore {sector.col}, {sector.row}</span>
            <span>Bonus {direction} · {bonusDistance} m</span>
          </div>
          <div className="arena-world" style={{ transform: `translate3d(calc(50% - ${position.x}px), calc(50% - ${position.y}px), 0)` }}>
            {[...sectors.values()].map(item => (
              <React.Fragment key={item.key}>
                <SectorFloor sector={item} />
                {item.obstacles.map(obstacle => (
                  <Obstacle key={obstacle.id} obstacle={obstacle} active={obstacleActive(obstacle, frame)} />
                ))}
              </React.Fragment>
            ))}

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

            {/* Rimossa la traiettoria di previsione */}

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
      <section className="leaderboard" aria-label="Classifica locale">
        <h2>CLASSIFICA <small>salvata su questo dispositivo</small></h2>
        {leaderboard.length ? <ol>{leaderboard.map((entry, index) => (
          <li key={`${entry.date}-${index}`}><span>{entry.name}</span><strong>{entry.score}</strong></li>
        ))}</ol> : <p>Gioca e raccogli punti per entrare in classifica.</p>}
      </section>
    </div>
  )
}

export default React.memo(App)
