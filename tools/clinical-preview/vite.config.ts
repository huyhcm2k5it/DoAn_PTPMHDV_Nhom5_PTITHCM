import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'lucide-react': `${here}../../apps/web/node_modules/lucide-react/dist/esm/lucide-react.mjs`,
      '@testing-library/react': `${here}../../apps/web/node_modules/@testing-library/react/dist/index.js`,
      'react/jsx-runtime': `${here}../../apps/web/node_modules/react/jsx-runtime.js`,
      'react/jsx-dev-runtime': `${here}../../apps/web/node_modules/react/jsx-dev-runtime.js`,
      'react-dom/client': `${here}../../apps/web/node_modules/react-dom/client.js`,
      'react-dom': `${here}../../apps/web/node_modules/react-dom/index.js`,
      react: `${here}../../apps/web/node_modules/react/index.js`,
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
    proxy: {
      '/api/v1/catalog': 'http://127.0.0.1:8007',
      '/api/v1/diagnostic-orders': 'http://127.0.0.1:8009',
      '/api/v1/specimens': 'http://127.0.0.1:8009',
      '/api/v1/results': 'http://127.0.0.1:8009',
      '^/api/v1/patients/[^/]+/published-results': 'http://127.0.0.1:8009',
      '/api': 'http://127.0.0.1:8008',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
