import { FastifyInstance } from "fastify";
import { retrieve } from "../rag/retriever.js";
import { indexDocs } from "../rag/indexer.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

const RAG_SYSTEM_PROMPT = `Tu es un assistant qui répond UNIQUEMENT à partir du contexte ci-dessous.
Si le contexte ne contient pas la réponse, réponds exactement : "Je ne trouve pas l'information dans mes documents."
Cite tes sources entre crochets, format [fichier.md§section].`;

export const ragRoute = async (app: FastifyInstance) => {
  // POST /rag/reindex — relance l'indexation complète
  app.post("/rag/reindex", async (request) => {
    request.log.info("RAG: réindexation manuelle déclenchée");
    const { files, chunks } = await indexDocs(app.db, app.stmts);
    return { indexed: true, files, chunks };
  });

  // POST /rag/search — recherche les K chunks les plus pertinents
  app.post<{ Body: { query: string; k?: number } }>(
    "/rag/search",
    {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1 },
            k: { type: "integer", minimum: 1, maximum: 10, default: 4 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { query, k = 4 } = request.body;
      const results = await retrieve(app.stmts, query, k);
      return results.map((r) => ({
        source: r.source,
        section: r.section,
        content: r.content,
        similarity: Math.round(r.similarity * 1000) / 1000,
      }));
    },
  );

  // POST /chat/rag — chat qui utilise le RAG + SSE
  app.post<{ Body: { message: string } }>(
    "/chat/rag",
    {
      schema: {
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 4096 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { message } = request.body;

      const chunks = await retrieve(app.stmts, message);

      if (chunks.length === 0) {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        reply.raw.write(
          `data: ${JSON.stringify({ type: "token", value: "Je ne trouve pas l'information dans mes documents." })}\n\n`,
        );
        reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        reply.raw.end();
        return;
      }

      const contextBlock = chunks
        .map((c) => `[${c.source}§${c.section}]\n${c.content}`)
        .join("\n\n---\n\n");

      const systemMessage = `${RAG_SYSTEM_PROMPT}\n\nContexte :\n${contextBlock}`;

      const controller = new AbortController();
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: message },
          ],
          stream: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        request.log.error({ status: res.status, body: text }, "Ollama error");
        return reply.status(502).send({ error: "Ollama request failed" });
      }

      request.socket.once("close", () => controller.abort());

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (payload: unknown) =>
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);

      sendEvent({
        type: "sources",
        sources: chunks.map((c) => ({
          source: c.source,
          section: c.section,
          similarity: Math.round(c.similarity * 1000) / 1000,
        })),
      });

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
              if (parsed.done) sendEvent({ type: "done" });
            } catch {
              // fragment
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          request.log.error(err, "RAG streaming error");
          sendEvent({ type: "error", message: err.message });
        }
      } finally {
        reply.raw.end();
      }
    },
  );
};
