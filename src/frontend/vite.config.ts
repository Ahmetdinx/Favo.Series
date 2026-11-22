import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], base: '/dizi/', server: { host: 'localhost', port: 5177, strictPort: true, proxy: {
 '/api/series': { target: 'http://localhost:5140' }, '/api': { target: 'http://localhost:5120' },
} } })
