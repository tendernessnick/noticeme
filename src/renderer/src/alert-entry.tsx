import React from 'react'
import { createRoot } from 'react-dom/client'
import AlertApp from './alert-main'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AlertApp />
  </React.StrictMode>
)
