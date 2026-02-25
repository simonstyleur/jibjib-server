import "dotenv/config";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { logger } from "./utils/logger";

const app = express();
const server = createServer(app);

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    uptime: process.uptime(),
  });
});

server.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
});

export { app, server };
