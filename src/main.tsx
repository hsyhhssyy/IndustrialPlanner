import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DialogProvider } from './ui/dialog.tsx'
import { ToastProvider } from './ui/toast.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DialogProvider>
  </StrictMode>,
)
