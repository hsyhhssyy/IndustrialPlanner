import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    allowedHosts: ['coder.hsyhhssyy.net', 'industrialplanner-7ab124.coder-page.hsyhhssyy.net'],
  },
})
