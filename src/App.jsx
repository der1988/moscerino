import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [position, setPosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e) => {
      setPosition({
        x: e.clientX,
        y: e.clientY
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: 'white',
      position: 'relative'
    }}>
      <div style={{
        width: '10px',
        height: '10px',
        backgroundColor: 'black',
        borderRadius: '50%',
        position: 'absolute',
        left: `${position.x - 5}px`,
        top: `${position.y - 5}px`,
        transition: 'all 0.1s ease-out'
      }} />
    </div>
  )
}

export default App
