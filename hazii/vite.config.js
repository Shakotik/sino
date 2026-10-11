import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { offlineManifest } from './scripts/offlineManifest.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), offlineManifest()],
  server: {
    // The browser talks only to /api. Vite forwards it to the local server,
    // while production uses a reverse proxy with the same public path.
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
