import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: the UI runs on :5173 and proxies the API + uploaded images to the backend on :5000.
const backend = { target: 'http://localhost:5000', changeOrigin: true }

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': backend, '/uploads': backend } },
})
