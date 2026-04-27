import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Render de React
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// ✅ Registro del Service Worker (PWA)
import { registerSW } from 'vite-plugin-pwa/register'

registerSW()