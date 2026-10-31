import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "react/jsx-runtime": `${here}node_modules/react/jsx-runtime.js`,
      "react/jsx-dev-runtime": `${here}node_modules/react/jsx-dev-runtime.js`,
      "react-dom/client": `${here}node_modules/react-dom/client.js`,
      "react-dom": `${here}node_modules/react-dom/index.js`,
      react: `${here}node_modules/react/index.js`,
    },
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: { "/api": "http://127.0.0.1:8082" },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
