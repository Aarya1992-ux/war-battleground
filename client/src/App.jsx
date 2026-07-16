import React, { useState, useEffect } from 'react';
import './App.css';

export default function App() {
  const [gameReady, setGameReady] = useState(false);

  useEffect(() => {
    setGameReady(true);
  }, []);

  if (!gameReady) {
    return <div style={{ padding: '20px', color: '#f1e6d8', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ 
      background: '#1a1a1a', 
      color: '#f1e6d8', 
      padding: '20px',
      minHeight: '100vh',
      textAlign: 'center'
    }}>
      <h1>⚔️ War Battleground</h1>
      <p>2-Player Strategy Game</p>
      <p style={{ fontSize: '14px', color: '#888' }}>Backend: war-battleground-production.up.railway.app</p>
      <p style={{ fontSize: '14px', color: '#888' }}>Ready to play!</p>
    </div>
  );
}