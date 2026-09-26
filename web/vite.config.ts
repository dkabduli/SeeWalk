/// <reference types="vitest/config" />
import { appendFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Dev only: the camera lab (…/?lab) posts its log here so it can be read on the laptop
 *  (web/lab-log.jsonl) without screenshots. Not part of the production build. */
const labLog: Plugin = {
  name: "seewalk-lab-log",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__lablog", (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        appendFileSync("lab-log.jsonl", body.trim() + "\n");
        res.statusCode = 204;
        res.end();
      });
    });
  },
};

const api = {
  "/api": {
    target: "http://localhost:8000",
    rewrite: (p: string) => p.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react(), labLog],
  server: { host: true, allowedHosts: true, proxy: api },
  preview: { host: true, allowedHosts: true, proxy: api },
  test: { environment: "jsdom" },
});
