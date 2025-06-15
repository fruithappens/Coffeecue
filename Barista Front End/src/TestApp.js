import React from 'react';

// Simple test component to verify React is working
function TestApp() {
  return (
    <div style={{
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      minHeight: '100vh',
      color: 'white'
    }}>
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        background: 'rgba(255,255,255,0.1)',
        padding: '30px',
        borderRadius: '15px',
        backdropFilter: 'blur(10px)'
      }}>
        <h1>☕ Coffee Cue React App - Test Mode</h1>
        <h2>✅ React is Working!</h2>
        
        <div style={{
          background: 'rgba(255,255,255,0.2)',
          padding: '20px',
          borderRadius: '10px',
          margin: '20px 0'
        }}>
          <h3>🔍 System Status</h3>
          <p>✅ React development server: Running</p>
          <p>✅ React components: Loading</p>
          <p>✅ JavaScript: Executing</p>
          <p>✅ Styling: Applied</p>
        </div>
        
        <div style={{
          background: 'rgba(255,255,255,0.2)',
          padding: '20px',
          borderRadius: '10px',
          margin: '20px 0'
        }}>
          <h3>🔧 Next Steps</h3>
          <p>If you can see this page, React is working correctly!</p>
          <p>The issue might be with:</p>
          <ul>
            <li>Authentication guards blocking the main app</li>
            <li>API connection issues</li>
            <li>Routing configuration</li>
            <li>Component errors in the main app</li>
          </ul>
        </div>
        
        <div style={{
          background: 'rgba(255,255,255,0.2)',
          padding: '20px',
          borderRadius: '10px',
          margin: '20px 0'
        }}>
          <h3>🌐 URLs to Test</h3>
          <p><strong>Main App:</strong> <a href="http://localhost:3000" style={{color: '#fff'}}>http://localhost:3000</a></p>
          <p><strong>Backend:</strong> <a href="http://localhost:5001" style={{color: '#fff'}}>http://localhost:5001</a></p>
          <p><strong>Migration Tool:</strong> <a href="http://localhost:5001/static/localStorage-to-database-migration.html" style={{color: '#fff'}}>Migration Tool</a></p>
        </div>
        
        <button 
          onClick={() => window.location.href = '/'}
          style={{
            background: '#fff',
            color: '#667eea',
            border: 'none',
            padding: '15px 30px',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
            margin: '10px'
          }}
        >
          🏠 Try Main App
        </button>
        
        <button 
          onClick={() => window.location.href = 'http://localhost:5001'}
          style={{
            background: '#fff',
            color: '#667eea',
            border: 'none',
            padding: '15px 30px',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
            margin: '10px'
          }}
        >
          🔧 Backend
        </button>
      </div>
    </div>
  );
}

export default TestApp;