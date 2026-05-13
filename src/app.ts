import Fastify, { FastifyServerOptions } from "fastify";
import sensible from "@fastify/sensible";
import { healthRoute } from "./routes/health.js";
import { chatRoute } from "./routes/chat.js";
import { conversationsRoute } from "./routes/conversations.js";
import { agentRoute } from "./routes/agent.js";
import { ragRoute } from "./routes/rag.js";
import dbPlugin from "./plugins/db.js";

export const buildApp = async (opts: FastifyServerOptions = {}) => {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV !== "production"
          ? {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "HH:MM:ss" },
            }
          : undefined,
    },
    ...opts,
  });

  // ── Plugins globaux ───────────────────────────────────────────────────────
  await app.register(sensible);
  await app.register(dbPlugin);

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(healthRoute);
  await app.register(chatRoute);
  await app.register(conversationsRoute);
  await app.register(agentRoute);
  await app.register(ragRoute);

  return app;
};
