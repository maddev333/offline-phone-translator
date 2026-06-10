import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(currentDir, "../frontend");

export function createApp() {
  const app = express();

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "offline-phone-translator" });
  });

  app.use(express.static(frontendDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDir, "index.html"));
  });

  return app;
}
