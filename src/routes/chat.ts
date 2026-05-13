import { FastifyInstance } from "fastify";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

interface ChatBody {
  message: string;
}

export const chatRoute = async (app: FastifyInstance) => {
  // ── Étape 1 : réponse complète ──────────────────────────────────────────
  app.post<{ Body: ChatBody }>(
    "/chat",
    {
      schema: {
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 4096 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { response: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { message } = request.body;

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: message }],
          stream: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        request.log.error({ status: res.status, body: text }, "Ollama error");
        return reply.status(502).send({ error: "Ollama request failed" });
      }

      const data = (await res.json()) as { message: { content: string } };
      return { response: data.message.content };
    },
  );

  // ── Étape 2 : streaming SSE ─────────────────────────────────────────────
  app.post<{ Body: ChatBody }>(
    "/chat/stream",
    {
      schema: {
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 4096 },
          },
        },
      },
    },
    async (request, reply) => {
      const { message } = request.body;
      const controller = new AbortController();

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: message }],
          stream: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        request.log.error({ status: res.status, body: text }, "Ollama error");
        return reply.status(502).send({ error: "Ollama request failed" });
      }

      request.raw.once("close", () => {
        request.log.info("Client disconnected — aborting Ollama stream");
        controller.abort();
      });

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (payload: unknown) =>
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);

      try {
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                sendEvent({ type: "token", value: parsed.message.content });
              }
              if (parsed.done) {
                sendEvent({ type: "done" });
              }
            } catch {
              // Ignorer les lignes JSON fragmentées ou invalides
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          request.log.error(err, "Streaming error");
          sendEvent({ type: "error", message: err.message });
        }
      } finally {
        reply.raw.end();
      }
    },
  );
};
