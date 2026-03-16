import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteCompression({ algorithm: 'gzip', threshold: 1024, filter: /\.(js|css|html|json|topojson|svg)$/ }),
    viteCompression({ algorithm: 'brotliCompress', threshold: 1024, ext: '.br', filter: /\.(js|css|html|json|topojson|svg)$/ }),
  ],
  build: {
    assetsInlineLimit: 0, // Never inline data files — always emit as hashed assets
  },
})
