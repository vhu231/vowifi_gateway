import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The manager serves the built app and proxies /api + /ws on the same origin.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 350,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/jssip')) return 'jssip'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react-vendor'
        },
      },
    },
  },
  // For local UI development, proxy API/WS to a running control plane. Defaults to
  // localhost; override with VOWIFI_DEV_API (e.g. https://gateway-host:8443).
  server: {
    proxy: {
      '/api': { target: process.env.VOWIFI_DEV_API || 'https://localhost:8443', changeOrigin: true, secure: false },
      '/ws': { target: (process.env.VOWIFI_DEV_API || 'https://localhost:8443').replace(/^http/, 'ws'), ws: true, secure: false },
    },
  },
})
