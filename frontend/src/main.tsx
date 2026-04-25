import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { I18nProvider } from './i18n'
import { DarkModeProvider } from './context/DarkModeContext'
import { initSentry } from './sentry'
import './index.css'
import App from './App.tsx'

initSentry();

// Catch unhandled async errors globally
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
      <DarkModeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      </DarkModeProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)
