import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App'
import { bootTheme } from './theme/useThemeStore'
import { getWindowSpec } from './windowActions'
import { guardSecondaryStorage } from './windowKinds'

bootTheme()
const spec = getWindowSpec()
document.documentElement.dataset['windowKind'] = spec.kind
if (spec.kind !== 'main') guardSecondaryStorage()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
