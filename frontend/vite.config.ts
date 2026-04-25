import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { createHash } from 'crypto'

// Stamp the service worker with a content-based hash on each build
function swVersionPlugin() {
  return {
    name: 'sw-version-stamp',
    writeBundle() {
      const swPath = resolve(__dirname, 'dist', 'sw.js');
      try {
        let content = readFileSync(swPath, 'utf-8');
        const buildHash = createHash('sha256').update(content).digest('hex').slice(0, 12);
        content = content.replace(/__BUILD_TIMESTAMP__/g, buildHash);
        writeFileSync(swPath, content);
      } catch { /* sw.js might not exist in dev */ }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/recharts')) {
            return 'recharts';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'lucide';
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
