import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/catalog.css'
import './styles/cart.css'
import './styles/checkout.css'
import './styles/order.css'

const root = document.getElementById('root')
if (!root) throw new Error('The #root element is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
