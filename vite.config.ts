/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // In development the floor plan reader runs separately (npm run server).
  server: { proxy: { "/api": "http://localhost:8787" } },
  test: { include: ["src/**/*.test.ts"] },
});
