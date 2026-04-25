import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'

// Stamp the service worker with a build-time hash on each build
function swVersionPlugin() {
  return {
    name: 'sw-version-stamp',
    writeBundle() {
      const swPath = resolve(__dirname, 'dist', 'sw.js');
      try {
        let content = readFileSync(swPath, 'utf-8');
        const buildHash = Date.now().toString(36);
        content = content.replace(/const CACHE_VERSION = "[^"]+";/, `const CACHE_VERSION = "${buildHash}";`);
        writeFileSync(swPath, content);
      } catch { /* sw.js might not exist in dev */ }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  build: {
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
