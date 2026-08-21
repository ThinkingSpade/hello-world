import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/aether/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../aether',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
})
