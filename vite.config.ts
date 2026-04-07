import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': 'http://localhost:3100',
    },
  },
})
