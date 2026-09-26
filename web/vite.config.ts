/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = {
  "/api": {
    target: "http://localhost:8000",
    rewrite: (p: string) => p.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { host: true, allowedHosts: true, proxy: api },
  preview: { host: true, allowedHosts: true, proxy: api },
  test: { environment: "jsdom" },
});
