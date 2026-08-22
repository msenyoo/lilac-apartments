import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import App from './App'
import './index.css'

ModuleRegistry.registerModules([AllCommunityModule])

// A deploy can replace lazy-loaded chunk files while a tab is still open on the
// previous build; recover by reloading once instead of showing a dead error banner.
const PRELOAD_RELOAD_KEY = 'lilac-preload-reload'
sessionStorage.removeItem(PRELOAD_RELOAD_KEY)
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return
  sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1')
  window.location.reload()
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
