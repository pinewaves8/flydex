import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import './styles/globals.css'

// 调试日志：白板排查时,在 webview DevTools Console 中可看到
console.log('[flydex] main.tsx loaded, mounting React…')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
