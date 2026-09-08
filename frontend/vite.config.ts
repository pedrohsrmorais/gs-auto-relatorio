import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    // Gera automaticamente routeTree.gen.ts a partir de src/routes
    TanStackRouterVite({ routesDirectory: "./src/routes" }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  build: {
    // dist/ plana com index.html + assets/ — o server.js do backend serve
    // isso como estático (express.static) com fallback de SPA pro index.html.
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Em dev, a API Express roda separada (ver .env do backend, PORT=3000).
    // Ajuste o target se você mudar a porta do backend.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
