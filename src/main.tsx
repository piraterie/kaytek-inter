// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/globals.css'
import { ensureFreshBuild } from './lib/buildGuard'

// Fire-and-forget : purge SW/caches si la version embarquée a changé depuis
// le dernier lancement, sans retarder le premier rendu dans le cas normal.
void ensureFreshBuild()

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 2, retry: 1, refetchOnWindowFocus: false } }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
