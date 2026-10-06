import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// relative base so the static build works from any sub-path (GitHub Pages, a folder, etc.)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
})
