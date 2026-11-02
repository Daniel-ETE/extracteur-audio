import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// "base" doit être identique au nom du dépôt GitHub
export default defineConfig({
  base: '/extracteur-audio/',
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
})