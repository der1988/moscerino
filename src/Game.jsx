import { useState } from 'react'
import App from './App.jsx'
import CircuitExplorer from './CircuitExplorer.jsx'

export default function Game() {
  const [arcade, setArcade] = useState(false)

  if (!arcade) return <CircuitExplorer onArcade={() => setArcade(true)} />

  return (
    <>
      <button type="button" className="circuit-back" onClick={() => setArcade(false)}>Esplorazione circuiti</button>
      <App />
    </>
  )
}
