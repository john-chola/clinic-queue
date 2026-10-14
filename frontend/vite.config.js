import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the backend runs on port 5000; the browser talks to it through Vite.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
})
