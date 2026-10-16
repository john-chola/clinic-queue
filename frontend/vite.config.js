import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Development ports are 5180 (this app) and 5050 (the API), not Vite's usual 5173 and 5000,
// so this project never shares an address, or a cached service worker, with another project.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5050',
      '/socket.io': { target: 'http://localhost:5050', ws: true },
    },
  },
  preview: { port: 5180 },
})
