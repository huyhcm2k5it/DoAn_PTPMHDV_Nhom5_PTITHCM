import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    testTimeout: 20000,
    fileParallelism: false,
  },
  server: {
    proxy: {
      '/api/v1': process.env.HQH_GATEWAY_URL ?? 'http://127.0.0.1:8080',
    },
  },
});
