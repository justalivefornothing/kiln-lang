/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [{ name: 'codemirror', test: /node_modules[\/](@codemirror|@lezer|style-mod|w3c-keyname|crelt)[\/]/ }],
        },
      },
    },
  },
})
