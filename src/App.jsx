import { useState, useEffect, useCallback } from 'react'
import './App.css'

const GAME_WIDTH = 800
const GAME_HEIGHT = 600
const PREDICTION_FACTOR = 15 // Quanto "avanti" guardano i nemici
const ENEMY_BASE_ACCELERATION = 0.2 // Accelerazione base nemici
const ENEMY_FRICTION = 0.96        // Frizione nemici
const SPEED_MULTIPLIERS = { slow: 0.7, medium: 1.0, fast: 1.3 };
const BONUS_GUARD_RADIUS = 150 // Raggio entro cui il guardiano INIZIA ad attaccare
const DISENGAGE_RADIUS = 300   // Raggio OLTRE cui il guardiano SMETTE di attaccare
const GUARD_PATROL_RADIUS = 100 // Distanza entro cui il guardiano rallenta vicino al bonus
const SENTINEL_AGGRO_RADIUS = 350 // Raggio inseguimento sentinelle
const WIGGLE_AMOUNT = 1.5
const WIGGLE_SPEED = 0.1
const BONUS_SIZES = [6, 10, 14] // Dimensioni possibili per i bonus (piccolo, medio, grande)
const PLAYER_RADIUS = 4
const PLAYER_FRICTION = 0.97 // Frizione del giocatore (usata per traiettoria)

// Slow Motion Constants
const SLOW_MOTION_DURATION_FRAMES = 3 * 60; // 3 secondi a 60fps
const SLOW_MOTION_COOLDOWN_FRAMES = 10 * 60; // 10 secondi a 60fps
const SLOW_MOTION_FACTOR = 0.3; // Rallenta i nemici al 30% della velocità

// Trajectory Constants
const TRAJECTORY_LENGTH = 100;       // Lunghezza max della previsione in px
const TRAJECTORY_MAX_STEPS = 60;     // Numero max di passi per evitare loop infiniti
const TRAJECTORY_DASH_SKIP = 3;      // Renderizza un punto ogni N passi
const TRAJECTORY_DOT_SIZE = 2;       // Raggio dei punti della traiettoria
const TRAJECTORY_HOMING_RADIUS = 200; // Raggio entro cui la traiettoria si aggancia al bonus
const TRAJECTORY_HOMING_ACCEL_FACTOR = 1.5; // Moltiplicatore accelerazione verso bonus

// Funzione per assegnare un ruolo casuale
const getRandomRole = () => {
  const roles = ['aggressive', 'flanker', 'guard', 'sentinel']
  return roles[Math.floor(Math.random() * roles.length)]
}

// Funzione helper per la distanza
const distance = (p1, p2) => {
  if (!p1 || !p2) return Infinity // Gestisce il caso bonus non ancora caricato o nullo
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Funzione per generare un punto di pattuglia casuale
const getRandomPatrolPoint = () => ({
  x: Math.random() * GAME_WIDTH,
  y: Math.random() * GAME_HEIGHT
})

// Funzione per creare un nuovo nemico con ruolo e velocità casuali
const createEnemy = () => {
  const speedKeys = Object.keys(SPEED_MULTIPLIERS);
  const randomSpeedKey = speedKeys[Math.floor(Math.random() * speedKeys.length)];
  return {
    x: Math.random() * GAME_WIDTH,
    y: Math.random() * GAME_HEIGHT,
    role: getRandomRole(),
    vx: 0, vy: 0,
    isEngaged: false,
    patrolTarget: null,
    speedMultiplier: SPEED_MULTIPLIERS[randomSpeedKey] // Assegna moltiplicatore velocità
  };
};

function App() {
  const [position, setPosition] = useState({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 })
  const [velocity, setVelocity] = useState({ x: 0, y: 0 })
  const [keys, setKeys] = useState({ up: false, down: false, left: false, right: false })
  const [enemies, setEnemies] = useState([createEnemy()]) // Usa la funzione createEnemy
  const [bonusPosition, setBonusPosition] = useState(null) // Ora include { x, y, size }
  const [score, setScore] = useState(0)
  const [frame, setFrame] = useState(0) // Stato per il conteggio dei frame per il wiggle
  // Slow Motion State
  const [isSlowMotionActive, setIsSlowMotionActive] = useState(false)
  const [slowMotionDurationTimer, setSlowMotionDurationTimer] = useState(0)
  const [slowMotionCooldownTimer, setSlowMotionCooldownTimer] = useState(0)

  // Funzione per generare una nuova posizione e dimensione del bonus
  const generateNewBonus = () => ({
    x: Math.random() * (GAME_WIDTH - 20) + 10, // Evita spawn troppo vicino ai bordi
    y: Math.random() * (GAME_HEIGHT - 20) + 10,
    size: BONUS_SIZES[Math.floor(Math.random() * BONUS_SIZES.length)]
  })

  // Effetto per generare il primo bonus al mount
  useEffect(() => {
    setBonusPosition(generateNewBonus())
  }, [])

  const resetGame = () => {
    setPosition({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 })
    setEnemies([createEnemy()]) // Usa la funzione createEnemy
    setBonusPosition(generateNewBonus()) // Rigenera bonus al reset
    setScore(0)
    setVelocity({ x: 0, y: 0 }) // Resetta anche la velocità del giocatore
    // Resetta anche slow motion
    setIsSlowMotionActive(false)
    setSlowMotionDurationTimer(0)
    setSlowMotionCooldownTimer(0)
  }

  const updatePhysics = useCallback(() => {
    // Determina il fattore di scala temporale
    const timeScale = isSlowMotionActive ? SLOW_MOTION_FACTOR : 1.0

    // --- Aggiornamento Moscerino ---
    let ax_player = 0
    let ay_player = 0
    if (Object.values(keys).some(value => value)) {
      if (keys.up) ay_player -= 1
      if (keys.down) ay_player += 1
      if (keys.left) ax_player -= 1
      if (keys.right) ax_player += 1
      if (ax_player !== 0 && ay_player !== 0) {
        const length = Math.sqrt(ax_player * ax_player + ay_player * ay_player)
        ax_player /= length
        ay_player /= length
      }
    }
    setVelocity(vel => {
      const acceleration = 0.3
      let newVx = (vel.x + ax_player * acceleration) * PLAYER_FRICTION // Usa frizione giocatore
      let newVy = (vel.y + ay_player * acceleration) * PLAYER_FRICTION // Usa frizione giocatore
      if (Math.abs(newVx) < 0.01) newVx = 0
      if (Math.abs(newVy) < 0.01) newVy = 0
      return { x: newVx, y: newVy }
    })
    setPosition(pos => {
      if (Math.abs(velocity.x) < 0.01 && Math.abs(velocity.y) < 0.01) return pos
      let newX = pos.x + velocity.x
      let newY = pos.y + velocity.y
      newX = Math.max(PLAYER_RADIUS, Math.min(GAME_WIDTH - PLAYER_RADIUS, newX))
      newY = Math.max(PLAYER_RADIUS, Math.min(GAME_HEIGHT - PLAYER_RADIUS, newY))
      return { x: newX, y: newY }
    })
    
    // --- Aggiornamento Nemici (con inerzia) --- 
    const predictedX = position.x + velocity.x * PREDICTION_FACTOR
    const predictedY = position.y + velocity.y * PREDICTION_FACTOR

    let enemiesNeedsUpdate = [...enemies]; // Copia per modificare patrolTarget

    enemiesNeedsUpdate = enemiesNeedsUpdate.map((enemy, index) => {
      let targetX = predictedX
      let targetY = predictedY
      let accelX = 0
      let accelY = 0
      let currentAccelerationFactor = ENEMY_BASE_ACCELERATION * enemy.speedMultiplier;
      let nextIsEngaged = enemy.isEngaged;
      let nextPatrolTarget = enemy.patrolTarget; // Mantiene target pattuglia

      // Logica target basata sul ruolo
      if (enemy.role === 'guard' && bonusPosition) {
        const playerDistToBonus = distance(position, bonusPosition)
        const enemyDistToBonus = distance(enemy, bonusPosition)
        
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
            targetX = bonusPosition.x
            targetY = bonusPosition.y
            if (enemyDistToBonus < GUARD_PATROL_RADIUS) { 
              currentAccelerationFactor *= 0.1; // Rallenta ancora di più il pattugliamento lento
              const vecToBonusX = bonusPosition.x - enemy.x;
              const vecToBonusY = bonusPosition.y - enemy.y;
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
        const vecToPlayerX = position.x - enemy.x
        const vecToPlayerY = position.y - enemy.y
        let len = Math.sqrt(vecToPlayerX*vecToPlayerX + vecToPlayerY*vecToPlayerY) 
        len = len === 0 ? 1 : len
        const perpX = -vecToPlayerY / len
        const perpY = vecToPlayerX / len
        const side = (index % 2 === 0) ? 1 : -1 
        targetX = predictedX + perpX * flankOffset * side
        targetY = predictedY + perpY * flankOffset * side
      } else if (enemy.role === 'sentinel') {
        const playerDist = distance(position, enemy);
        if (playerDist <= SENTINEL_AGGRO_RADIUS) {
          // INSEGUE GIOCATORE
          targetX = predictedX;
          targetY = predictedY;
        } else {
          // PATTUGLIA
          if (!enemy.patrolTarget || distance(enemy, enemy.patrolTarget) < 20) {
            // Se non ha un target o l'ha raggiunto, ne genera uno nuovo
            nextPatrolTarget = getRandomPatrolPoint();
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
      
      // Aggiorna velocità del nemico con inerzia
      let newVx = (enemy.vx + accelX * currentAccelerationFactor) * ENEMY_FRICTION
      let newVy = (enemy.vy + accelY * currentAccelerationFactor) * ENEMY_FRICTION
      if (Math.abs(newVx) < 0.01) newVx = 0;
      if (Math.abs(newVy) < 0.01) newVy = 0;

      // Applica velocità alla posizione del nemico SCALATA per slow motion
      let newX = enemy.x + newVx * timeScale
      let newY = enemy.y + newVy * timeScale

      // Evita sovrapposizioni tra nemici (ridotto effetto)
      enemiesNeedsUpdate.forEach((otherEnemy, otherIndex) => {
        if (index !== otherIndex) {
          const checkX = (otherIndex > index) ? otherEnemy.x : newX // Usa posizioni già aggiornate se disponibili
          const checkY = (otherIndex > index) ? otherEnemy.y : newY
          const currentX = (otherIndex > index) ? newX : otherEnemy.x
          const currentY = (otherIndex > index) ? newY : otherEnemy.y
          
          const distX = checkX - currentX;
          const distY = checkY - currentY;
          let dist = Math.sqrt(distX * distX + distY * distY)
          dist = dist === 0 ? 1 : dist
          if (dist < 12) { // Ancora più vicini possibili
            const force = (12 - dist) * 0.05; // Forza di separazione debole
            if (otherIndex > index) {
                // Modifica nemico corrente in base a quello già aggiornato
                 newX -= (distX / dist) * force;
                 newY -= (distY / dist) * force;
            } else {
               // Modifica nemico già aggiornato in base a quello corrente (più complesso, per ora no)
               // Potrebbe richiedere un ciclo while o più passate
            } 
          }
        }
      })

      // Riapplica limiti dopo separazione
       newX = Math.max(PLAYER_RADIUS, Math.min(GAME_WIDTH - PLAYER_RADIUS, newX))
       newY = Math.max(PLAYER_RADIUS, Math.min(GAME_HEIGHT - PLAYER_RADIUS, newY))

      // Ritorna lo stato aggiornato del nemico (inclusa velocità e stato engaged)
      return { ...enemy, x: newX, y: newY, vx: newVx, vy: newVy, isEngaged: nextIsEngaged, patrolTarget: nextPatrolTarget } 
    })

    // Aggiorna lo stato principale dei nemici
    setEnemies(enemiesNeedsUpdate);

    // --- Controlla raccolta bonus ---
    if (bonusPosition) {
      // Usa la dimensione del bonus per la collisione
      const collisionDistance = PLAYER_RADIUS + bonusPosition.size / 2;
      const dist = distance(bonusPosition, position)
      if (dist < collisionDistance) {
        setScore(score + 1)
        setEnemies(prevEnemies => [...prevEnemies, createEnemy()]) // Usa createEnemy
        setBonusPosition(generateNewBonus())
      }
    }

    // --- Controlla collisione nemico-moscerino ---
    enemies.forEach(enemy => {
      const dist = distance(enemy, position)
      if (dist < PLAYER_RADIUS * 2) { // Collisione basata sui raggi
        resetGame()
      }
    })

  }, [keys, velocity, position, enemies, bonusPosition, score, isSlowMotionActive]) // Aggiunta dipendenza isSlowMotionActive

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === ' ' ) { // Barra spaziatrice
         e.preventDefault(); // Impedisce lo scroll della pagina
         if (slowMotionCooldownTimer <= 0) {
             setIsSlowMotionActive(true);
             setSlowMotionDurationTimer(SLOW_MOTION_DURATION_FRAMES);
             setSlowMotionCooldownTimer(SLOW_MOTION_COOLDOWN_FRAMES);
         }
      } else {
        switch(e.key) {
          case 'ArrowUp': setKeys(prev => ({ ...prev, up: true })); break
          case 'ArrowDown': setKeys(prev => ({ ...prev, down: true })); break
          case 'ArrowLeft': setKeys(prev => ({ ...prev, left: true })); break
          case 'ArrowRight': setKeys(prev => ({ ...prev, right: true })); break
          default: break
        }
      }
    }
    const handleKeyUp = (e) => {
      switch(e.key) {
        case 'ArrowUp': setKeys(prev => ({ ...prev, up: false })); break
        case 'ArrowDown': setKeys(prev => ({ ...prev, down: false })); break
        case 'ArrowLeft': setKeys(prev => ({ ...prev, left: false })); break
        case 'ArrowRight': setKeys(prev => ({ ...prev, right: false })); break
        default: break
      }
    }

    let animationFrame 
    const gameLoop = () => {
      setFrame(f => f + 1) // Incrementa il frame count per il wiggle
      
      // Aggiorna Timers Slow Motion
      if (isSlowMotionActive) {
         setSlowMotionDurationTimer(t => {
           const nextTimer = t - 1;
           if (nextTimer <= 0) {
             setIsSlowMotionActive(false); // Disattiva slow motion
             return 0;
           }
           return nextTimer;
         });
      }
      if (slowMotionCooldownTimer > 0) {
         setSlowMotionCooldownTimer(t => Math.max(0, t - 1));
      }
      
      updatePhysics() // Chiama SEMPRE updatePhysics
      animationFrame = requestAnimationFrame(gameLoop)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    animationFrame = requestAnimationFrame(gameLoop)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      cancelAnimationFrame(animationFrame)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatePhysics, isSlowMotionActive, slowMotionCooldownTimer]) // Aggiunte dipendenze per i timer

  // Calcolo Wiggle per il giocatore
  const playerWiggleX = Math.sin(frame * WIGGLE_SPEED) * WIGGLE_AMOUNT;
  const playerWiggleY = Math.cos(frame * WIGGLE_SPEED * 0.8) * WIGGLE_AMOUNT;

  // Calcolo percentuale per la barra di cooldown
  const cooldownPercent = Math.max(0, 1 - (slowMotionCooldownTimer / SLOW_MOTION_COOLDOWN_FRAMES)) * 100;

  // --- Calcolo Traiettoria (Modificato per Homing) ---
  let trajectoryPoints = [];
  if (isSlowMotionActive && (Math.abs(velocity.x) > 0.1 || Math.abs(velocity.y) > 0.1 || Object.values(keys).some(v => v))) {
      let currentX = position.x;
      let currentY = position.y;
      let currentVx = velocity.x;
      let currentVy = velocity.y;
      let totalDistance = 0;

      for (let i = 0; i < TRAJECTORY_MAX_STEPS && totalDistance < TRAJECTORY_LENGTH; i++) {
          let isHoming = false; // Flag per questo punto
          let sim_ax = 0;
          let sim_ay = 0;
          let sim_accel = 0.3; // Accelerazione normale giocatore

          // Controlla se siamo vicini al bonus
          if (bonusPosition && distance({ x: currentX, y: currentY }, bonusPosition) <= TRAJECTORY_HOMING_RADIUS) {
              isHoming = true;
              // Calcola accelerazione verso il bonus
              const dx_bonus = bonusPosition.x - currentX;
              const dy_bonus = bonusPosition.y - currentY;
              let len_bonus = Math.sqrt(dx_bonus * dx_bonus + dy_bonus * dy_bonus);
              len_bonus = len_bonus === 0 ? 1 : len_bonus;
              sim_ax = dx_bonus / len_bonus;
              sim_ay = dy_bonus / len_bonus;
              sim_accel *= TRAJECTORY_HOMING_ACCEL_FACTOR; // Applica fattore homing
          } else {
              // Altrimenti, usa l'accelerazione basata sui tasti
              if (keys.up) sim_ay -= 1;
              if (keys.down) sim_ay += 1;
              if (keys.left) sim_ax -= 1;
              if (keys.right) sim_ax += 1;
              if (sim_ax !== 0 && sim_ay !== 0) {
                const length = Math.sqrt(sim_ax * sim_ax + sim_ay * sim_ay);
                sim_ax /= length;
                sim_ay /= length;
              }
          }
         
          currentVx = (currentVx + sim_ax * sim_accel) * PLAYER_FRICTION; 
          currentVy = (currentVy + sim_ay * sim_accel) * PLAYER_FRICTION;

          if (Math.abs(currentVx) < 0.01 && Math.abs(currentVy) < 0.01 && sim_ax === 0 && sim_ay === 0) break;

          currentX += currentVx; 
          currentY += currentVy;

          currentX = Math.max(PLAYER_RADIUS, Math.min(GAME_WIDTH - PLAYER_RADIUS, currentX));
          currentY = Math.max(PLAYER_RADIUS, Math.min(GAME_HEIGHT - PLAYER_RADIUS, currentY));

          trajectoryPoints.push({ x: currentX, y: currentY, isHoming }); // Salva flag homing
          const stepDist = Math.sqrt(currentVx * currentVx + currentVy * currentVy);
          totalDistance += stepDist;
          if(stepDist < 0.01 && sim_ax === 0 && sim_ay === 0) break; 
      }
  }

  return (
    <div style={{
      width: `${GAME_WIDTH}px`,
      height: `${GAME_HEIGHT}px`,
      backgroundColor: 'white',
      overflow: 'hidden',
      position: 'relative',
      border: '1px solid black'
    }}>
      <div id="score">Punti: {score}</div>
      {/* Barra Slow Motion e testo */}
      <div style={{ position: 'absolute', top: '10px', right: '10px', textAlign: 'right' }}>
        <div style={{ 
            width: '100px', 
            height: '20px', 
            border: '1px solid black', 
            backgroundColor: '#eee',
            display: 'inline-block',
            position: 'relative'
        }}>
          <div style={{ 
              width: `${cooldownPercent}%`, 
              height: '100%', 
              backgroundColor: isSlowMotionActive ? 'lightblue' : (slowMotionCooldownTimer <= 0 ? 'lime' : 'orange'), 
              transition: isSlowMotionActive ? 'none' : 'width 0.1s linear' 
          }} />
          <span style={{ 
              position: 'absolute', 
              left: '50%', 
              top: '50%', 
              transform: 'translate(-50%, -50%)', 
              fontSize: '12px', 
              color: 'white',
              pointerEvents: 'none',
              textShadow: '1px 1px 1px rgba(0,0,0,0.7)'
          }}>
             Slowmotion
          </span>
        </div>
        {/* Testo SOTTO la barra */} 
        <div style={{ 
            fontSize: '10px', 
            color: 'black',
            marginTop: '2px',
            width: '100px',
            textAlign: 'center'
         }}>
          Press Spacebar
        </div>
      </div>
      
      {/* Moscerino */}
      <div style={{
        width: `${PLAYER_RADIUS * 2}px`, height: `${PLAYER_RADIUS * 2}px`, backgroundColor: 'black',
        borderRadius: '50%', position: 'absolute',
        left: `${position.x - PLAYER_RADIUS + playerWiggleX}px`,
        top: `${position.y - PLAYER_RADIUS + playerWiggleY}px`,
        transform: 'translate3d(0,0,0)', willChange: 'left, top',
        zIndex: 10
      }} />
      {enemies.map((enemy, index) => {
        const enemyWiggleX = Math.sin(frame * WIGGLE_SPEED * 0.9 + index * 0.5) * WIGGLE_AMOUNT * 0.8;
        const enemyWiggleY = Math.cos(frame * WIGGLE_SPEED * 0.7 + index * 0.6) * WIGGLE_AMOUNT * 0.8;
        // Determina colore in base alla velocità
        let enemyColor = 'orange'; // Default medio
        if (enemy.speedMultiplier < SPEED_MULTIPLIERS.medium) {
            enemyColor = 'gold'; // Cambiato in gold
        } else if (enemy.speedMultiplier > SPEED_MULTIPLIERS.medium) {
            enemyColor = 'red';
        }
        return (
          <div key={index} style={{
            width: `${PLAYER_RADIUS * 2}px`, height: `${PLAYER_RADIUS * 2}px`, backgroundColor: enemyColor, // Usa colore dinamico
            borderRadius: '50%', position: 'absolute',
            left: `${enemy.x - PLAYER_RADIUS + enemyWiggleX}px`,
            top: `${enemy.y - PLAYER_RADIUS + enemyWiggleY}px`,
            transform: 'translate3d(0,0,0)', willChange: 'left, top',
            zIndex: 5
          }} />
        );
      })}
      {bonusPosition && (
        <div className="bonus" style={{
          width: `${bonusPosition.size}px`, // Usa dimensione dallo stato
          height: `${bonusPosition.size}px`, // Usa dimensione dallo stato
          left: `${bonusPosition.x - bonusPosition.size / 2}px`, // Centra in base alla dimensione
          top: `${bonusPosition.y - bonusPosition.size / 2}px`, // Centra in base alla dimensione
          zIndex: 5
        }} />
      )}
      {/* Traiettoria */}
      {isSlowMotionActive && trajectoryPoints.length > 0 && (
          trajectoryPoints
              .filter((_, index) => index % TRAJECTORY_DASH_SKIP === 0) 
              .map((point, index, filteredArray) => {
                  const opacity = 0.8 * (1 - (index / (filteredArray.length || 1))); // Fade da 0.8 a 0
                  const dotColor = point.isHoming 
                                   ? `rgba(255, 0, 0, ${opacity})` // Rosso se homing
                                   : `rgba(100, 100, 100, ${opacity})`; // Grigio altrimenti
                  return (
                      <div
                          key={`traj-${index}`}
                          style={{
                              position: 'absolute',
                              width: `${TRAJECTORY_DOT_SIZE * 2}px`,
                              height: `${TRAJECTORY_DOT_SIZE * 2}px`,
                              backgroundColor: dotColor, // Usa colore calcolato
                              borderRadius: '50%',
                              left: `${point.x - TRAJECTORY_DOT_SIZE}px`,
                              top: `${point.y - TRAJECTORY_DOT_SIZE}px`,
                              zIndex: 3, 
                              pointerEvents: 'none',
                          }}
                      />
                  );
              })
      )}
    </div>
  )
}

export default App
