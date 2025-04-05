import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './App.css'

const GAME_WIDTH = 800
const GAME_HEIGHT = 600
const PREDICTION_FACTOR = 25 // Quanto "avanti" guardano i nemici
const ENEMY_BASE_ACCELERATION = 0.2 // Accelerazione base nemici
const ENEMY_FRICTION = 0.96        // Frizione nemici
const SPEED_MULTIPLIERS = { slow: 0.7, medium: 0.9, fast: 1.1 };
const BONUS_GUARD_RADIUS = 200 // Raggio entro cui il guardiano INIZIA ad attaccare
const DISENGAGE_RADIUS = 400  // Raggio OLTRE cui il guardiano SMETTE di attaccare
const GUARD_PATROL_RADIUS = 100 // Distanza entro cui il guardiano rallenta vicino al bonus
const SENTINEL_AGGRO_RADIUS = 400 // Raggio inseguimento sentinelle
const BONUS_SIZES = [8, 10, 12] // Dimensioni possibili per i bonus (piccolo, medio, grande)
const PLAYER_RADIUS = 3
const PLAYER_FRICTION = 0.93// Frizione del giocatore (ridotta inerzia)
const AUTO_ATTRACTION_RADIUS = 2 // Raggio entro cui il bonus viene attratto automaticamente
const AUTO_ATTRACTION_SPEED = 1 // Velocità di attrazione automatica

// Costanti per gli ostacoli
const OBSTACLE_SIZE = 16 // Dimensione degli ostacoli
const OBSTACLE_AVOIDANCE_RADIUS = 40 // Raggio entro cui i nemici intelligenti iniziano a evitare

// Slow Motion Constants
const SLOW_MOTION_DURATION_FRAMES = 3 * 60; // 3 secondi a 60fps
const SLOW_MOTION_COOLDOWN_FRAMES = 10 * 60; // 10 secondi a 60fps
const SLOW_MOTION_FACTOR = 0.3; // Rallenta i nemici al 30% della velocità
const PLAYER_SLOW_MOTION_FACTOR = 0.6 // Rallenta il giocatore al 70% (meno dei nemici)
const BONUS_ATTRACTION_RADIUS = 50; // Raggio entro cui il bonus viene attratto al giocatore
const BONUS_ATTRACTION_SPEED = 0.8; // Velocità di attrazione del bonus

// Trajectory Constants
const TRAJECTORY_LENGTH = 100;       // Lunghezza max della previsione in px
const TRAJECTORY_MAX_STEPS = 60;     // Numero max di passi per evitare loop infiniti
const TRAJECTORY_DASH_SKIP = 3;      // Renderizza un punto ogni N passi
const TRAJECTORY_DOT_SIZE = 2.5;       // Raggio dei punti della traiettoria
const TRAJECTORY_HOMING_RADIUS = 200; // Raggio entro cui la traiettoria si aggancia al bonus
const TRAJECTORY_HOMING_ACCEL_FACTOR = 1.5; // Moltiplicatore accelerazione verso bonus

// Definizione dei livelli di intelligenza
const INTELLIGENCE_LEVELS = { low: 'low', medium: 'medium', high: 'high' };

// Caratteri per la pioggia Matrix
const MATRIX_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{};:,./<>?゠アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

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
  
  // Assegna casualmente un livello di intelligenza
  const intelligenceKeys = Object.keys(INTELLIGENCE_LEVELS);
  const randomIntelligenceKey = intelligenceKeys[Math.floor(Math.random() * intelligenceKeys.length)];
  
  return {
    x: Math.random() * GAME_WIDTH,
    y: Math.random() * GAME_HEIGHT,
    role: getRandomRole(),
    vx: 0, vy: 0,
    isEngaged: false,
    patrolTarget: null,
    speedMultiplier: SPEED_MULTIPLIERS[randomSpeedKey], // Assegna moltiplicatore velocità
    intelligence: INTELLIGENCE_LEVELS[randomIntelligenceKey] // Assegna livello di intelligenza
  };
};

// Funzione per creare un nemico lontano dal giocatore
const createEnemyAwayFromPlayer = (playerPosition) => {
  const MIN_DISTANCE = 200; // Distanza minima dal giocatore
  
  // Genera proprietà base del nemico
  const enemy = createEnemy();
  
  // Riposiziona il nemico fino a quando non è abbastanza lontano
  let attempts = 0;
  let validPosition = false;
  
  while (!validPosition && attempts < 50) {
    // Genera una posizione casuale
    enemy.x = Math.random() * GAME_WIDTH;
    enemy.y = Math.random() * GAME_HEIGHT;
    
    // Calcola la distanza dal giocatore
    const dist = distance(enemy, playerPosition);
    
    if (dist >= MIN_DISTANCE) {
      validPosition = true;
    } else {
      // Se troppo vicino, prova a posizionare sul lato opposto
      if (attempts > 25) {
        // Calcola vettore direzione dal giocatore al nemico
        const dx = enemy.x - playerPosition.x;
        const dy = enemy.y - playerPosition.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Estendi questo vettore per raggiungere la distanza minima
        const factor = MIN_DISTANCE / len;
        enemy.x = playerPosition.x + dx * factor;
        enemy.y = playerPosition.y + dy * factor;
        
        // Riporta all'interno dell'area di gioco se necessario
        enemy.x = (enemy.x + GAME_WIDTH) % GAME_WIDTH;
        enemy.y = (enemy.y + GAME_HEIGHT) % GAME_HEIGHT;
        
        validPosition = true;
      }
    }
    
    attempts++;
  }
  
  return enemy;
};

// Funzione per la collisione elastica tra due moscerini
const resolveCollision = (enemy1, enemy2) => {
  // Vettore della differenza di posizione
  const dx = enemy2.x - enemy1.x;
  const dy = enemy2.y - enemy1.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  // Normalizzazione del vettore
  const nx = dx / distance;
  const ny = dy / distance;
  
  // Differenza della velocità lungo il vettore normale
  const dvx = enemy2.vx - enemy1.vx;
  const dvy = enemy2.vy - enemy1.vy;
  const dotProduct = nx * dvx + ny * dvy;
  
  // Se i due oggetti si stanno allontanando, non applicare impulso
  if (dotProduct > 0) return { enemy1, enemy2 };
  
  // Coefficiente di rimbalzo (1 = perfettamente elastico)
  const restitution = 0.8;
  
  // Calcolo dell'impulso
  const impulse = (-(1 + restitution) * dotProduct) / 2;
  
  // Applicazione dell'impulso ai vettori velocità
  const enemy1NewVx = enemy1.vx - impulse * nx;
  const enemy1NewVy = enemy1.vy - impulse * ny;
  const enemy2NewVx = enemy2.vx + impulse * nx;
  const enemy2NewVy = enemy2.vy + impulse * ny;
  
  return {
    enemy1: { ...enemy1, vx: enemy1NewVx, vy: enemy1NewVy },
    enemy2: { ...enemy2, vx: enemy2NewVx, vy: enemy2NewVy }
  };
};

// Matrix random characters for decorative elements
const getMatrixChar = () => {
  const chars = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
  return chars.charAt(Math.floor(Math.random() * chars.length));
};

// Random Matrix ID for decorative elements
const generateMatrixID = () => {
  return Array(8).fill().map(() => Math.floor(Math.random() * 10)).join('');
};

// Random Matrix ASCII patterns
const MATRIX_PATTERNS = [
  "=-=-=-=-=-=-=-=-=-=-=-=-=-=",
  "[][][][][][][][][][][][][]",
  "::::::::::::::::::::::::::::",
  "▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░▒▓▒░",
  "┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐┌┐"
];

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
        height: PLAYER_RADIUS * 2
      }}
    />
  );
});

// Componente ottimizzato per la traiettoria
const Trajectory = React.memo(({ points }) => {
  return points
    .filter((_, index) => index % 3 === 0) // Ridotto a meno punti (filtro ogni 3 invece di ogni 2)
    .map((point, index, filtered) => {
      const opacity = 1 - index / filtered.length;
      const dotColor = point.isHoming ? '#ff0000' : '#aaaaaa';
      return (
        <div
          key={`trajectory-${index}`} 
          className="trajectory-dot"
          style={{
            position: 'absolute',
            left: point.x - TRAJECTORY_DOT_SIZE / 2,
            top: point.y - TRAJECTORY_DOT_SIZE / 2,
            width: TRAJECTORY_DOT_SIZE,
            height: TRAJECTORY_DOT_SIZE,
            backgroundColor: dotColor,
            opacity: opacity
          }}
        />
      );
    });
});

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
  // Stati per livelli e ostacoli
  const [obstacles, setObstacles] = useState([])
  const [level, setLevel] = useState(1)
  // Stato per l'high score
  const [highScore, setHighScore] = useState(0)
  
  // Matrix decoration states
  const [matrixPattern, setMatrixPattern] = useState(MATRIX_PATTERNS[0]);
  const [matrixID, setMatrixID] = useState(generateMatrixID());

  // Riferimenti e memo
  const requestRef = useRef();
  const previousTimeRef = useRef();
  const lastBonusTimeRef = useRef(0);
  
  // Funzione per generare una nuova posizione e dimensione del bonus
  const generateNewBonus = () => ({
    x: Math.random() * (GAME_WIDTH - 20) + 10, // Evita spawn troppo vicino ai bordi
    y: Math.random() * (GAME_HEIGHT - 20) + 10,
    size: BONUS_SIZES[Math.floor(Math.random() * BONUS_SIZES.length)]
  })

  // Funzione per generare un nuovo ostacolo in posizione non sovrapposta ad altri elementi
  const generateNewObstacle = () => {
    let newObstacle;
    let isValid = false;
    
    // Tenta di generare una posizione valida (non sovrapposta)
    while (!isValid) {
      newObstacle = {
        x: Math.random() * (GAME_WIDTH - OBSTACLE_SIZE - 20) + 10,
        y: Math.random() * (GAME_HEIGHT - OBSTACLE_SIZE - 20) + 10
      };
      
      isValid = true;
      
      // Controlla sovrapposizione con il giocatore
      if (distance(newObstacle, position) < 50) {
        isValid = false;
        continue;
      }
      
      // Controlla sovrapposizione con il bonus
      if (bonusPosition && distance(newObstacle, bonusPosition) < 30) {
        isValid = false;
        continue;
      }
      
      // Controlla sovrapposizione con altri ostacoli
      for (const obstacle of obstacles) {
        if (
          Math.abs(obstacle.x - newObstacle.x) < OBSTACLE_SIZE * 1.5 && 
          Math.abs(obstacle.y - newObstacle.y) < OBSTACLE_SIZE * 1.5
        ) {
          isValid = false;
          break;
        }
      }
    }
    
    return newObstacle;
  };

  // Effetto per generare il primo bonus al mount
  useEffect(() => {
    setBonusPosition(generateNewBonus())
  }, [])

  // Controlla se è necessario aumentare di livello
  useEffect(() => {
    const newLevel = Math.floor(score / 5) + 1;
    
    if (newLevel > level) {
      setLevel(newLevel);
      
      // Aggiungi un nuovo ostacolo per il nuovo livello
      if (newLevel > 1) { // Dal livello 2 in poi
        setObstacles(prev => [...prev, generateNewObstacle()]);
      }
    }
  }, [score, level]);

  const resetGame = () => {
    // Controlla se il punteggio attuale è maggiore dell'high score
    if (score > highScore) {
      setHighScore(score);
    }
    
    // Matrix reset effect - cambia pattern e ID
    setMatrixPattern(MATRIX_PATTERNS[Math.floor(Math.random() * MATRIX_PATTERNS.length)]);
    setMatrixID(generateMatrixID());
    
    // Reset del gioco
    setPosition({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 })
    setEnemies([createEnemy()]) // Usa la funzione createEnemy
    setBonusPosition(generateNewBonus()) // Rigenera bonus al reset
    setScore(0)
    setVelocity({ x: 0, y: 0 }) // Resetta anche la velocità del giocatore
    // Resetta anche slow motion
    setIsSlowMotionActive(false)
    setSlowMotionDurationTimer(0)
    setSlowMotionCooldownTimer(0)
    // Resetta livello e ostacoli
    setLevel(1)
    setObstacles([])
  }

  // Controlla se un punto è dentro un ostacolo
  const isPointInObstacle = (point, obstacle) => {
    return (
      point.x >= obstacle.x - OBSTACLE_SIZE/2 && 
      point.x <= obstacle.x + OBSTACLE_SIZE/2 &&
      point.y >= obstacle.y - OBSTACLE_SIZE/2 && 
      point.y <= obstacle.y + OBSTACLE_SIZE/2
    );
  };

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

  // Utilizzo useMemo per il calcolo della traiettoria per evitare ricalcoli inutili
  const trajectoryPoints = useMemo(() => {
    if (!isSlowMotionActive || (Math.abs(velocity.x) <= 0.1 && Math.abs(velocity.y) <= 0.1 && !Object.values(keys).some(v => v))) {
      return [];
    }
    
    // Resto del calcolo della traiettoria (lasciato invariato)
    let currentX = position.x;
    let currentY = position.y;
    let currentVx = velocity.x;
    let currentVy = velocity.y;
    let totalDistance = 0;
    const points = [];

    for (let i = 0; i < TRAJECTORY_MAX_STEPS && totalDistance < TRAJECTORY_LENGTH; i++) {
      let isHoming = false;
      let sim_ax = 0;
      let sim_ay = 0;
      let sim_accel = 0.3;

      if (bonusPosition && distance({ x: currentX, y: currentY }, bonusPosition) <= TRAJECTORY_HOMING_RADIUS) {
          isHoming = true;
          const dx_bonus = bonusPosition.x - currentX;
          const dy_bonus = bonusPosition.y - currentY;
          let len_bonus = Math.sqrt(dx_bonus * dx_bonus + dy_bonus * dy_bonus);
          len_bonus = len_bonus === 0 ? 1 : len_bonus;
          sim_ax = dx_bonus / len_bonus;
          sim_ay = dy_bonus / len_bonus;
          sim_accel *= TRAJECTORY_HOMING_ACCEL_FACTOR;
      } else {
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

      points.push({ x: currentX, y: currentY, isHoming });
      const stepDist = Math.sqrt(currentVx * currentVx + currentVy * currentVy);
      totalDistance += stepDist;
      if(stepDist < 0.01 && sim_ax === 0 && sim_ay === 0) break; 
    }
    
    return points;
  }, [isSlowMotionActive, velocity, position, keys, bonusPosition]);

  // updatePhysics ottimizzato per essere più efficiente
  const updatePhysics = useCallback(() => {
    // Determina il fattore di scala temporale
    const timeScale = isSlowMotionActive ? SLOW_MOTION_FACTOR : 1.0
    // Fattore di scala temporale per il giocatore (diverso dai nemici)
    const playerTimeScale = isSlowMotionActive ? PLAYER_SLOW_MOTION_FACTOR : 1.0
    
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
    
    // Aggiorna velocità e posizione del giocatore in una singola operazione
    setVelocity(vel => {
      const acceleration = 0.3
      let newVx = (vel.x + ax_player * acceleration) * PLAYER_FRICTION
      let newVy = (vel.y + ay_player * acceleration) * PLAYER_FRICTION
      if (Math.abs(newVx) < 0.01) newVx = 0
      if (Math.abs(newVy) < 0.01) newVy = 0
      
      // Aggiorna anche posizione
      const playerVel = { x: newVx, y: newVy };
      
      setPosition(pos => {
        if (Math.abs(playerVel.x) < 0.01 && Math.abs(playerVel.y) < 0.01) return pos
        let newX = pos.x + playerVel.x * playerTimeScale
        let newY = pos.y + playerVel.y * playerTimeScale
        newX = Math.max(PLAYER_RADIUS, Math.min(GAME_WIDTH - PLAYER_RADIUS, newX))
        newY = Math.max(PLAYER_RADIUS, Math.min(GAME_HEIGHT - PLAYER_RADIUS, newY))
        return { x: newX, y: newY }
      });
      
      return playerVel;
    });
    
    // --- Aggiornamento Nemici (con inerzia) --- 
    const predictedX = position.x + velocity.x * PREDICTION_FACTOR
    const predictedY = position.y + velocity.y * PREDICTION_FACTOR

    let enemiesNeedsUpdate = [...enemies]; // Copia per modificare patrolTarget

    // Primo passo: filtra eventuali nemici che hanno colpito ostacoli
    enemiesNeedsUpdate = enemiesNeedsUpdate.filter(enemy => {
      // Controlla collisioni con ostacoli
      for (const obstacle of obstacles) {
        if (isPointInObstacle(enemy, obstacle)) {
          return false; // Nemico eliminato
        }
      }
      return true;
    });

    enemiesNeedsUpdate = enemiesNeedsUpdate.map((enemy, index) => {
      let targetX = predictedX
      let targetY = predictedY
      let accelX = 0
      let accelY = 0
      let currentAccelerationFactor = ENEMY_BASE_ACCELERATION * enemy.speedMultiplier;
      let nextIsEngaged = enemy.isEngaged;
      let nextPatrolTarget = enemy.patrolTarget; // Mantiene target pattuglia

      // Modifica del target in base al livello di intelligenza
      if (enemy.intelligence === INTELLIGENCE_LEVELS.low) {
        // Poco intelligenti: inseguimento diretto del giocatore
        targetX = position.x;
        targetY = position.y;
        
      } else if (enemy.intelligence === INTELLIGENCE_LEVELS.medium) {
        // Intelligenti: anticipano le mosse del giocatore
        // Calcola una posizione anticipata basata sul movimento e velocità attuali
        const anticipationFactor = 25 + Math.random() * 15; // Più randomico di PREDICTION_FACTOR
        targetX = position.x + velocity.x * anticipationFactor;
        targetY = position.y + velocity.y * anticipationFactor;
        
        // Aggiungi un po' di randomicità per simulare l'intelligenza
        targetX += (Math.random() - 0.5) * 40;
        targetY += (Math.random() - 0.5) * 40;
        
      } else if (enemy.intelligence === INTELLIGENCE_LEVELS.high) {
        // Molto intelligenti: comportamento strategico
        if (bonusPosition) {
          // Calcola la direzione dal giocatore al bonus
          const towardsBonusX = bonusPosition.x - position.x;
          const towardsBonusY = bonusPosition.y - position.y;
          const distToBonus = Math.sqrt(towardsBonusX * towardsBonusX + towardsBonusY * towardsBonusY);
          
          if (distToBonus > 0 && distToBonus < 200) {
            // Il giocatore sembra dirigersi verso il bonus: intercetta
            // Cerca di mettersi tra il giocatore e il bonus
            const interceptX = position.x + (towardsBonusX / distToBonus) * (distToBonus * 0.7);
            const interceptY = position.y + (towardsBonusY / distToBonus) * (distToBonus * 0.7);
            
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
              targetX = position.x - velocity.x * advancedAnticipationFactor;
              targetY = position.y - velocity.y * advancedAnticipationFactor;
            } else {
              // Usa la previsione normale ma migliorata
              targetX = position.x + velocity.x * advancedAnticipationFactor;
              targetY = position.y + velocity.y * advancedAnticipationFactor;
            }
            
            // Aggiungi randomicità per comportamento più imprevedibile
            targetX += (Math.random() - 0.5) * 30;
            targetY += (Math.random() - 0.5) * 30;
          }
        }
      }

      // Logica target basata sul ruolo (sovrascrive il target di intelligenza in casi specifici)
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

      // Applica velocità alla posizione del nemico SCALATA per slow motion
      let newX = enemy.x + newVx * timeScale
      let newY = enemy.y + newVy * timeScale

      // Applica limiti di bordo
      newX = Math.max(PLAYER_RADIUS, Math.min(GAME_WIDTH - PLAYER_RADIUS, newX))
      newY = Math.max(PLAYER_RADIUS, Math.min(GAME_HEIGHT - PLAYER_RADIUS, newY))

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

    // Secondo passo: Risolvi le collisioni tra nemici con rimbalzo
    // Teniamo traccia di quali nemici devono essere eliminati
    const enemiesToRemove = new Set();
    
    for (let i = 0; i < enemiesNeedsUpdate.length; i++) {
      for (let j = i + 1; j < enemiesNeedsUpdate.length; j++) {
        const enemy1 = enemiesNeedsUpdate[i];
        const enemy2 = enemiesNeedsUpdate[j];
        
        // Calcola distanza tra i due nemici
        const dx = enemy2.x - enemy1.x;
        const dy = enemy2.y - enemy1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Raggio totale (diametro di ciascun nemico)
        const totalRadius = PLAYER_RADIUS * 2;
        
        // Se c'è collisione, marchia entrambi i nemici per la rimozione
        if (dist < totalRadius) {
          enemiesToRemove.add(i);
          enemiesToRemove.add(j);
        }
      }
    }
    
    // Filtra i nemici che devono essere eliminati
    if (enemiesToRemove.size > 0) {
      enemiesNeedsUpdate = enemiesNeedsUpdate.filter((_, index) => !enemiesToRemove.has(index));
    }

    // Aggiorna lo stato principale dei nemici
    setEnemies(enemiesNeedsUpdate);

    // --- Attrazione e raccolta bonus ---
    if (bonusPosition) {
      // Controlla se il bonus deve essere attratto verso il giocatore
      const distToBonus = distance(bonusPosition, position);
      
      // Attrazione automatica sempre attiva entro 10px
      const isInAutoRange = distToBonus < AUTO_ATTRACTION_RADIUS;
      // Attrazione entro 50px sempre attiva (non dipende più dallo slow motion)
      const isInAttractionRange = distToBonus < BONUS_ATTRACTION_RADIUS;
      
      if (isInAutoRange || isInAttractionRange) {
        // Calcola vettore direzione dal bonus al giocatore
        const dx = position.x - bonusPosition.x;
        const dy = position.y - bonusPosition.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Determina la velocità di attrazione in base al contesto
        let attractionSpeed;
        if (isInAutoRange) {
          // Attrazione automatica più forte
          attractionSpeed = AUTO_ATTRACTION_SPEED;
        } else {
          // Attrazione standard con raggio maggiore
          // Se in slow motion, l'attrazione è più forte
          const baseAttractionSpeed = BONUS_ATTRACTION_SPEED * (1 - distToBonus / BONUS_ATTRACTION_RADIUS);
          attractionSpeed = isSlowMotionActive ? baseAttractionSpeed * 1.5 : baseAttractionSpeed;
        }
        
        // Applica movimento di attrazione
        const newBonusX = bonusPosition.x + (dx / len) * attractionSpeed;
        const newBonusY = bonusPosition.y + (dy / len) * attractionSpeed;
        
        // Aggiorna la posizione del bonus
        setBonusPosition({
          ...bonusPosition,
          x: newBonusX,
          y: newBonusY
        });
      }
      
      // Usa la dimensione del bonus per la collisione
      const collisionDistance = PLAYER_RADIUS + bonusPosition.size / 2;
      const dist = distance(bonusPosition, position);
      if (dist < collisionDistance) {
        setScore(score + 1);
        
        // Aggiungi nemici in base al livello corrente
        setEnemies(prevEnemies => {
          const newEnemies = [...prevEnemies];
          
          // Genera tanti nemici quanti indicati dal livello
          for (let i = 0; i < level; i++) {
            newEnemies.push(createEnemyAwayFromPlayer(position));
          }
          
          return newEnemies;
        });
        
        setBonusPosition(generateNewBonus());
      }
    }

    // --- Controlla collisione nemico-moscerino ---
    enemies.forEach(enemy => {
      const dist = distance(enemy, position)
      if (dist < PLAYER_RADIUS * 2) { // Collisione basata sui raggi
        resetGame()
      }
    })

    // --- Controlla collisione giocatore-ostacolo ---
    for (const obstacle of obstacles) {
      if (isPointInObstacle(position, obstacle)) {
        resetGame();
        break;
      }
    }

  }, [keys, velocity, position, enemies, bonusPosition, score, isSlowMotionActive, obstacles, level]) // Aggiunta dipendenze

  // useEffect per game loop ottimizzato
  useEffect(() => {
    // Utilizzo setInterval invece di requestAnimationFrame per più stabilità
    // e per limitare gli FPS a 60 (o meno se il browser/dispositivo non può gestirli)
    const gameLoopInterval = setInterval(() => {
      if (isSlowMotionActive) {
        setSlowMotionDurationTimer(t => {
          const nextTimer = t - 1;
          if (nextTimer <= 0) {
            setIsSlowMotionActive(false);
            return 0;
          }
          return nextTimer;
        });
      }
      
      if (slowMotionCooldownTimer > 0) {
        setSlowMotionCooldownTimer(t => Math.max(0, t - 1));
      }
      
      updatePhysics();
    }, 16); // ~60 FPS
    
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
          case 'ArrowUp': setKeys(prev => ({ ...prev, up: true })); break;
          case 'ArrowDown': setKeys(prev => ({ ...prev, down: true })); break;
          case 'ArrowLeft': setKeys(prev => ({ ...prev, left: true })); break;
          case 'ArrowRight': setKeys(prev => ({ ...prev, right: true })); break;
          default: break;
        }
      }
    }
    
    const handleKeyUp = (e) => {
      switch(e.key) {
        case 'ArrowUp': setKeys(prev => ({ ...prev, up: false })); break;
        case 'ArrowDown': setKeys(prev => ({ ...prev, down: false })); break;
        case 'ArrowLeft': setKeys(prev => ({ ...prev, left: false })); break;
        case 'ArrowRight': setKeys(prev => ({ ...prev, right: false })); break;
        default: break;
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      clearInterval(gameLoopInterval);
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [updatePhysics, isSlowMotionActive, slowMotionCooldownTimer]);

  // Calcolo percentuale per la barra di cooldown
  const cooldownPercent = useMemo(() => {
    return Math.max(0, 1 - (slowMotionCooldownTimer / SLOW_MOTION_COOLDOWN_FRAMES)) * 100;
  }, [slowMotionCooldownTimer]);

  // Update Matrix decorative elements
  useEffect(() => {
    const patternInterval = setInterval(() => {
      const newPattern = MATRIX_PATTERNS[Math.floor(Math.random() * MATRIX_PATTERNS.length)];
      setMatrixPattern(newPattern);
    }, 5000);
    
    const idInterval = setInterval(() => {
      setMatrixID(generateMatrixID());
    }, 3000);
    
    return () => {
      clearInterval(patternInterval);
      clearInterval(idInterval);
    };
  }, []);

  return (
    <div style={{ 
      width: '100%', 
      height: '100vh',
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      flexDirection: 'column',
      backgroundColor: '#000' // Sfondo nero senza effetti
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
      
      {/* Container principale */}
      <div className="game-container" style={{ width: GAME_WIDTH, height: GAME_HEIGHT + 40 }}>
        {/* UI Bar */}
        <div className="ui-bar" style={{ 
          height: '40px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '0 10px' 
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
                width: `${isSlowMotionActive 
                  ? `${(1 - slowMotionDurationTimer / SLOW_MOTION_DURATION_FRAMES) * 100}%` 
                  : slowMotionCooldownTimer === 0 
                    ? '100%' 
                    : `${(1 - slowMotionCooldownTimer / SLOW_MOTION_COOLDOWN_FRAMES) * 100}%`
                }`, 
                height: '100%', 
                backgroundColor: isSlowMotionActive ? '#0ff' : '#0f0',
                boxShadow: `0 0 5px ${isSlowMotionActive ? '#0ff' : '#0f0'}`
              }}></div>
            </div>
          </div>
        </div>
        
        {/* Game Area */}
        <div className="game-area" style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}>
          {/* Griglia di sfondo */}
          <div className="grid-background"></div>
          
          {/* Ostacoli */}
          {obstacles.map((obs, i) => (
            <div key={`obstacle-${i}`} className="obstacle" style={{
              position: 'absolute',
              left: obs.x,
              top: obs.y,
              width: obs.width,
              height: obs.height
            }}></div>
          ))}
          
          {/* Bonus */}
          {bonusPosition && (
            <div className="bonus" style={{
              position: 'absolute',
              left: bonusPosition.x - bonusPosition.size / 2,
              top: bonusPosition.y - bonusPosition.size / 2,
              width: bonusPosition.size,
              height: bonusPosition.size
            }}></div>
          )}
          
          {/* Utilizzo del componente Trajectory memorizzato */}
          {isSlowMotionActive && trajectoryPoints.length > 0 && (
            <Trajectory points={trajectoryPoints} />
          )}
          
          {/* Utilizzo del componente Enemy memorizzato per ogni nemico */}
          {enemies.map((enemy) => (
            <Enemy key={`enemy-${enemy.id || Math.random()}`} enemy={enemy} />
          ))}
          
          {/* Giocatore - senza effetto wiggle */}
          <div className="player" style={{
            position: 'absolute',
            left: position.x - PLAYER_RADIUS,
            top: position.y - PLAYER_RADIUS,
            width: PLAYER_RADIUS * 2,
            height: PLAYER_RADIUS * 2
          }}></div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(App) // Memorize anche il componente principale
