import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import FinSim from './FinSim.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FinSim/>
  </StrictMode>,
)
