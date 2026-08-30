import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel sets these as build-time env vars; unset locally (npm run dev / npm run build
// outside Vercel), where the fallbacks below apply instead.
const commitSha    = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
const commitBranch = process.env.VERCEL_GIT_COMMIT_REF ?? 'local'
const vercelEnv    = process.env.VERCEL_ENV ?? 'development'

export default defineConfig({
  define: {
    __APP_COMMIT__:   JSON.stringify(commitSha),
    __APP_BRANCH__:   JSON.stringify(commitBranch),
    __APP_ENV__:      JSON.stringify(vercelEnv),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: 'Lilac Apartments',
        short_name: 'Lilac',
        description: 'Lilac Apartment Association — Monthly Reports',
        theme_color: '#7c3aed',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  resolve: {
    alias: { '@': '/src' }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'ag-grid': ['ag-grid-community', 'ag-grid-react'],
          recharts: ['recharts'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
})
