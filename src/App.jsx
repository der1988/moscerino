import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './App.css'

const GAME_WIDTH = 800
const GAME_HEIGHT = 600
const PLAYER_RADIUS = 3
const PLAYER_FRICTION = 0.93
const ENEMY_FRICTION = 0.96
const WALL_THICKNESS = 8 // Spessore dei muri
const CONE_LENGTH = 150 // Lunghezza base dei coni di visione
const CONE_ANGLE = Math.PI / 4 // Angolo base dei coni di visione (45 gradi)

// Definizione dei livelli di intelligenza
const INTELLIGENCE_LEVELS = { low: 'low', medium: 'medium', high: 'high' };

// Funzione per la distanza
const distance = (p1, p2) => {
  if (!p1 || !p2) return Infinity
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Funzione per verificare se un punto si trova all'interno di un muro
const isPointInWall = (point, walls) => {
  for (const wall of walls) {
    if (
      point.x >= wall.x - WALL_THICKNESS/2 && 
      point.x <= wall.x + wall.width + WALL_THICKNESS/2 &&
      point.y >= wall.y - WALL_THICKNESS/2 && 
      point.y <= wall.y + wall.height + WALL_THICKNESS/2
    ) {
      return true;
    }
  }
  return false;
};

// Funzione per generare un punto di pattuglia casuale
const getRandomPatrolPoint = (walls) => {
  let point = {
    x: Math.random() * GAME_WIDTH,
    y: Math.random() * GAME_HEIGHT
  };
  
  // Verifica che il punto non sia all'interno di un muro
  let attempts = 0;
  while (isPointInWall(point, walls) && attempts < 50) {
    point = {
      x: Math.random() * GAME_WIDTH,
      y: Math.random() * GAME_HEIGHT
    };
    attempts++;
  }
  
  return point;
};

// Funzione per la collisione elastica tra due nemici
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

// Dati di livello che definiscono i muri e le posizioni
const levelData = {
  1: {
    // Livello 1 - layout semplice
    walls: [
      { x: 100, y: 100, width: 600, height: 10 },
      { x: 100, y: 100, width: 10, height: 400 },
      { x: 100, y: 490, width: 600, height: 10 },
      { x: 690, y: 100, width: 10, height: 400 },
      { x: 350, y: 250, width: 100, height: 10 }
    ],
    bonusPosition: { x: 150, y: 150, size: 8 },
    playerPosition: { x: 650, y: 450 }
  },
  2: {
    // Livello 2 - layout più complesso
    walls: [
      { x: 50, y: 50, width: 700, height: 10 },
      { x: 50, y: 50, width: 10, height: 500 },
      { x: 50, y: 540, width: 700, height: 10 },
      { x: 740, y: 50, width: 10, height: 500 },
      { x: 200, y: 150, width: 10, height: 200 },
      { x: 400, y: 250, width: 200, height: 10 },
      { x: 600, y: 150, width: 10, height: 200 }
    ],
    bonusPosition: { x: 700, y: 500, size: 8 },
    playerPosition: { x: 100, y: 100 }
  },
  3: {
    // Livello 3 - labirinto
    walls: [
      { x: 50, y: 50, width: 700, height: 10 },
      { x: 50, y: 50, width: 10, height: 500 },
      { x: 50, y: 540, width: 700, height: 10 },
      { x: 740, y: 50, width: 10, height: 500 },
      { x: 150, y: 150, width: 500, height: 10 },
      { x: 150, y: 150, width: 10, height: 300 },
      { x: 150, y: 450, width: 500, height: 10 },
      { x: 650, y: 150, width: 10, height: 300 },
      { x: 250, y: 250, width: 300, height: 10 },
      { x: 250, y: 250, width: 10, height: 100 },
      { x: 550, y: 250, width: 10, height: 100 },
      { x: 250, y: 350, width: 300, height: 10 }
    ],
    bonusPosition: { x: 400, y: 300, size: 8 },
    playerPosition: { x: 100, y: 100 }
  }
  // Aggiungi altri livelli se necessario...
};

// Funzione per creare nemici basati sul livello
const createEnemies = (level, bonusPosition, walls) => {
  // Aumenta l'intelligenza e la velocità dei nemici in base al livello
  const intelligence = level <= 2 ? INTELLIGENCE_LEVELS.low : 
                       level <= 5 ? INTELLIGENCE_LEVELS.medium : INTELLIGENCE_LEVELS.high;
  
  const speedMultiplier = 0.7 + (level * 0.1); // Aumenta velocità con il livello
  
  // Aumenta la grandezza del cono visivo con il livello
  const coneLength = CONE_LENGTH + (level * 15);
  const coneAngle = CONE_ANGLE + (level * 0.05);
  
  // Crea il primo nemico - guardiano del bonus
  const guardEnemy = {
    id: 1,
    x: bonusPosition.x + 50,
    y: bonusPosition.y + 50,
    role: 'guard',
    vx: 0, vy: 0,
    patrolTarget: null,
    speedMultiplier: speedMultiplier,
    intelligence: intelligence,
    direction: 0, // Direzione attuale in radianti
    coneLength: coneLength,
    coneAngle: coneAngle * 0.8, // Cono più stretto per il guardiano
    playerSpotted: false
  };
  
  // Crea il secondo nemico - pattugliatore
  let patrolPosition = getRandomPatrolPoint(walls);
  let attempts = 0;
  // Assicura che il pattugliatore non sia troppo vicino al bonus o al giocatore
  while ((distance(patrolPosition, bonusPosition) < 150 || 
          distance(patrolPosition, levelData[level].playerPosition) < 150) && 
         attempts < 50) {
    patrolPosition = getRandomPatrolPoint(walls);
    attempts++;
  }
  
  const patrolEnemy = {
    id: 2,
    x: patrolPosition.x,
    y: patrolPosition.y,
    role: 'patrol',
    vx: 0, vy: 0,
    patrolTarget: getRandomPatrolPoint(walls),
    speedMultiplier: speedMultiplier * 0.9, // Leggermente più lento
    intelligence: intelligence,
    direction: Math.random() * Math.PI * 2, // Direzione casuale
    coneLength: coneLength * 1.2, // Cono più lungo per il pattugliatore
    coneAngle: coneAngle, // Angolo standard
    playerSpotted: false
  };
  
  return [guardEnemy, patrolEnemy];
};

// Componente Enemy ottimizzato
const Enemy = React.memo(({ enemy }) => {
  return (
    <>
      {/* Corpo del nemico */}
      <div 
        className={`enemy enemy-${enemy.intelligence}`} 
        style={{
          position: 'absolute',
          left: enemy.x - PLAYER_RADIUS,
          top: enemy.y - PLAYER_RADIUS,
          width: PLAYER_RADIUS * 2,
          height: PLAYER_RADIUS * 2,
          transform: `rotate(${enemy.direction}rad)`
        }}
      />
      
      {/* Cono di visione */}
      <div 
        className={`vision-cone ${enemy.playerSpotted ? 'player-spotted' : ''}`} 
        style={{
          position: 'absolute',
          left: enemy.x,
          top: enemy.y,
          width: 0,
          height: 0,
          borderLeft: `${Math.tan(enemy.coneAngle/2) * enemy.coneLength}px solid transparent`,
          borderRight: `${Math.tan(enemy.coneAngle/2) * enemy.coneLength}px solid transparent`,
          borderBottom: `${enemy.coneLength}px solid rgba(255, 0, 0, 0.15)`,
          transformOrigin: 'center top',
          transform: `rotate(${enemy.direction}rad)`
        }}
      />
    </>
  );
});

function App() {
  const [position, setPosition] = useState({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 })
  const [velocity, setVelocity] = useState({ x: 0, y: 0 })
  const [keys, setKeys] = useState({ up: false, down: false, left: false, right: false })
  const [enemies, setEnemies] = useState([])
  const [bonusPosition, setBonusPosition] = useState(null)
  const [level, setLevel] = useState(1)
  const [highScore, setHighScore] = useState(1)
  const [walls, setWalls] = useState([])
  
  // Riferimenti e memo
  const requestRef = useRef();
  const previousTimeRef = useRef();
  
  // Funzione per determinare se il giocatore è nel cono visivo di un nemico
  const isPlayerInCone = (player, enemy) => {
    // Calcola vettore dal nemico al giocatore
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distanceToPlayer = Math.sqrt(dx * dx + dy * dy);
    
    // Se il giocatore è troppo lontano, non può essere nel cono
    if (distanceToPlayer > enemy.coneLength) return false;
    
    // Calcola l'angolo tra la direzione del nemico e il vettore verso il giocatore
    const playerAngle = Math.atan2(dy, dx);
    const enemyDirection = enemy.direction;
    
    // Calcola la differenza dell'angolo (considera la ciclicità)
    let angleDiff = Math.abs(playerAngle - enemyDirection);
    angleDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
    
    // Il giocatore è nel cono se l'angolo è minore di metà dell'angolo del cono
    return angleDiff <= enemy.coneAngle / 2;
  };
  
  // Inizializza il livello
  const initializeLevel = useCallback((levelNum) => {
    const level = levelData[levelNum] || levelData[1];
    
    // Imposta muri
    setWalls(level.walls);
    
    // Imposta il bonus
    setBonusPosition(level.bonusPosition);
    
    // Imposta la posizione del giocatore
    setPosition(level.playerPosition);
    setVelocity({ x: 0, y: 0 });
    
    // Crea nemici appropriati per questo livello
    setEnemies(createEnemies(levelNum, level.bonusPosition, level.walls));
  }, []);
  
  // Inizializza il primo livello al mount
  useEffect(() => {
    initializeLevel(1);
  }, [initializeLevel]);
  
  // Gestione reset del gioco
  const resetGame = () => {
    // Salva l'high score
    if (level > highScore) {
      setHighScore(level);
    }
    
    // Resetta al livello 1
    setLevel(1);
    initializeLevel(1);
  };
  
  // Game loop principale
  const gameLoop = useCallback((time) => {
    if (previousTimeRef.current === undefined) {
      previousTimeRef.current = time;
    }
    
    const deltaTime = time - previousTimeRef.current;
    previousTimeRef.current = time;
    
    // Aggiorna la posizione del giocatore
    let ax = 0;
    let ay = 0;
    const accel = 0.3;
    
    if (keys.up) ay -= 1;
    if (keys.down) ay += 1;
    if (keys.left) ax -= 1;
    if (keys.right) ax += 1;
    
    if (ax !== 0 && ay !== 0) {
      const length = Math.sqrt(ax * ax + ay * ay);
      ax /= length;
      ay /= length;
    }
    
    // Calcola la nuova velocità con attrito
    const newVx = (velocity.x + ax * accel) * PLAYER_FRICTION; 
    const newVy = (velocity.y + ay * accel) * PLAYER_FRICTION;
    
    // Calcola la nuova posizione
    let newX = position.x + newVx;
    let newY = position.y + newVy;
    
    // Controlla collisioni con i muri
    const newPosition = { x: newX, y: newY };
    if (isPointInWall(newPosition, walls)) {
      newX = position.x;
      newY = position.y;
    }
    
    // Applica i limiti dell'area di gioco
    newX = Math.max(PLAYER_RADIUS, Math.min(GAME_WIDTH - PLAYER_RADIUS, newX));
    newY = Math.max(PLAYER_RADIUS, Math.min(GAME_HEIGHT - PLAYER_RADIUS, newY));
    
    // Aggiorna posizione e velocità del giocatore
    setPosition({ x: newX, y: newY });
    setVelocity({ x: newVx, y: newVy });
    
    // Aggiorna i nemici
    setEnemies(prevEnemies => {
      const updatedEnemies = prevEnemies.map(enemy => {
        // Verifica se il nemico vede il giocatore
        const playerSpotted = isPlayerInCone({ x: newX, y: newY }, enemy);
        
        // Determina il target del nemico in base al suo ruolo e se ha visto il giocatore
        let targetX, targetY;
        
        if (playerSpotted) {
          // Se il nemico vede il giocatore, lo insegue
          targetX = newX;
          targetY = newY;
        } else if (enemy.role === 'guard') {
          // Il guardiano pattuglia intorno al bonus
          const angle = (Date.now() / 1000) % (2 * Math.PI); // Rotazione nel tempo
          const patrolRadius = 50;
          targetX = bonusPosition.x + Math.cos(angle) * patrolRadius;
          targetY = bonusPosition.y + Math.sin(angle) * patrolRadius;
        } else {
          // Il pattugliatore cerca un punto casuale
          if (!enemy.patrolTarget || distance(enemy, enemy.patrolTarget) < 20) {
            // Genera un nuovo punto di pattuglia
            const newTarget = getRandomPatrolPoint(walls);
            enemy = { ...enemy, patrolTarget: newTarget };
          }
          targetX = enemy.patrolTarget.x;
          targetY = enemy.patrolTarget.y;
        }
        
        // Calcola la direzione verso il target
        const dx = targetX - enemy.x;
        const dy = targetY - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Aggiorna la direzione del nemico (verso dove sta guardando)
        let newDirection = enemy.direction;
        if (dist > 0) {
          newDirection = Math.atan2(dy, dx);
        }
        
        // Calcola accelerazione verso il target
        let ax = 0;
        let ay = 0;
        if (dist > 1) {
          ax = dx / dist;
          ay = dy / dist;
        }
        
        // Aggiorna velocità del nemico con accelerazione e attrito
        const baseAccel = 0.2 * enemy.speedMultiplier;
        let newVx = (enemy.vx + ax * baseAccel) * ENEMY_FRICTION;
        let newVy = (enemy.vy + ay * baseAccel) * ENEMY_FRICTION;
        
        // Applica velocità alla posizione del nemico
        let newX = enemy.x + newVx;
        let newY = enemy.y + newVy;
        
        // Controlla collisioni con i muri
        if (isPointInWall({ x: newX, y: newY }, walls)) {
          newX = enemy.x;
          newY = enemy.y;
          newVx = -enemy.vx * 0.5; // Rimbalza leggermente
          newVy = -enemy.vy * 0.5;
        }
        
        // Applica limiti dell'area di gioco
        newX = Math.max(PLAYER_RADIUS, Math.min(GAME_WIDTH - PLAYER_RADIUS, newX));
        newY = Math.max(PLAYER_RADIUS, Math.min(GAME_HEIGHT - PLAYER_RADIUS, newY));
        
        return {
          ...enemy,
          x: newX,
          y: newY,
          vx: newVx,
          vy: newVy,
          direction: newDirection,
          playerSpotted
        };
      });
      
      // Risolvi collisioni tra nemici
      for (let i = 0; i < updatedEnemies.length; i++) {
        for (let j = i + 1; j < updatedEnemies.length; j++) {
          const enemy1 = updatedEnemies[i];
          const enemy2 = updatedEnemies[j];
          
          const dist = distance(enemy1, enemy2);
          if (dist < PLAYER_RADIUS * 2) {
            const resolved = resolveCollision(enemy1, enemy2);
            updatedEnemies[i] = resolved.enemy1;
            updatedEnemies[j] = resolved.enemy2;
          }
        }
      }
      
      return updatedEnemies;
    });
    
    // Controlla collisione con il bonus
    if (bonusPosition && distance(position, bonusPosition) < (PLAYER_RADIUS + bonusPosition.size / 2)) {
      // Sale di livello
      const newLevel = level + 1;
      setLevel(newLevel);
      
      // Aggiorna highscore se necessario
      if (newLevel > highScore) {
        setHighScore(newLevel);
      }
      
      // Inizializza il nuovo livello, o crea un livello procedurale se oltre quelli predefiniti
      if (levelData[newLevel]) {
        initializeLevel(newLevel);
      } else {
        // Per i livelli oltre quelli predefiniti, genera una mappa procedurale
        // Qui dovresti implementare la generazione procedurale dei livelli
        // Per ora usiamo una versione randomizzata del livello 3
        const randomLevel = JSON.parse(JSON.stringify(levelData[3]));
        // Modifica randomizzata...
        setWalls(randomLevel.walls);
        setBonusPosition({
          x: 100 + Math.random() * (GAME_WIDTH - 200),
          y: 100 + Math.random() * (GAME_HEIGHT - 200),
          size: 8
        });
        setPosition({
          x: 100 + Math.random() * (GAME_WIDTH - 200),
          y: 100 + Math.random() * (GAME_HEIGHT - 200)
        });
        setEnemies(createEnemies(newLevel, bonusPosition, randomLevel.walls));
      }
    }
    
    // Controlla collisione con i nemici
    for (const enemy of enemies) {
      if (distance(position, enemy) < PLAYER_RADIUS * 2) {
        resetGame();
        break;
      }
    }
    
    requestRef.current = requestAnimationFrame(gameLoop);
  }, [position, velocity, keys, enemies, bonusPosition, level, highScore, walls, initializeLevel]);
  
  // Setup del game loop
  useEffect(() => {
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [gameLoop]);
  
  // Gestione input da tastiera
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch(e.key) {
        case 'ArrowUp':
        case 'w':
          setKeys(prev => ({ ...prev, up: true }));
          break;
        case 'ArrowDown':
        case 's':
          setKeys(prev => ({ ...prev, down: true }));
          break;
        case 'ArrowLeft':
        case 'a':
          setKeys(prev => ({ ...prev, left: true }));
          break;
        case 'ArrowRight':
        case 'd':
          setKeys(prev => ({ ...prev, right: true }));
          break;
        default:
          break;
      }
    };
    
    const handleKeyUp = (e) => {
      switch(e.key) {
        case 'ArrowUp':
        case 'w':
          setKeys(prev => ({ ...prev, up: false }));
          break;
        case 'ArrowDown':
        case 's':
          setKeys(prev => ({ ...prev, down: false }));
          break;
        case 'ArrowLeft':
        case 'a':
          setKeys(prev => ({ ...prev, left: false }));
          break;
        case 'ArrowRight':
        case 'd':
          setKeys(prev => ({ ...prev, right: false }));
          break;
        default:
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
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
            HIGH SCORE: {highScore}
          </div>
        </div>
        
        {/* Game Area */}
        <div className="game-area" style={{ width: GAME_WIDTH, height: GAME_HEIGHT }}>
          {/* Griglia di sfondo */}
          <div className="grid-background"></div>
          
          {/* Muri */}
          {walls.map((wall, i) => (
            <div key={`wall-${i}`} className="wall" style={{
              position: 'absolute',
              left: wall.x,
              top: wall.y,
              width: wall.width,
              height: wall.height
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
          
          {/* Nemici con i loro coni di visione */}
          {enemies.map((enemy) => (
            <Enemy key={`enemy-${enemy.id}`} enemy={enemy} />
          ))}
          
          {/* Giocatore */}
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

export default React.memo(App)
