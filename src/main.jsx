import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './styles/editorial.css'
import './styles/simple.css'
import {initDisplayPreferences} from '../public/i18n/preferences.mjs'
import { initTheme } from './utils/theme'
import ErrorBoundary from './components/ErrorBoundary'

initTheme()
initDisplayPreferences()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
