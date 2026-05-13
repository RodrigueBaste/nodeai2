import { FastifyInstance, FastifyRequest } from "fastify";
import { toolDefinitions, executeTool } from "../tools/registry.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const MAX_ITERATIONS = 5;

const agentBodySchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 4096 },
  },
  additionalProperties: false,
};

const makeAbortOnDisconnect = (request: FastifyRequest) => {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  request.socket.once("close", onClose);
  const cleanup = () => request.socket.removeListener("close", onClose);
  return { controller, cleanup };
};

interface ToolCall {
  function: {
    name: string;
    arguments: string; // Arguments are JSON string from Ollama
  };
}

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[];
}

export const agentRoute = async (app: FastifyInstance) => {
  app.post<{ Body: { message: string } }>(
    "/chat/agent",
    {
      schema: { body: agentBodySchema },
    },
    async (request, reply) => {
      const { message } = request.body;
      const messages: Message[] = [{ role: "user", content: message }];

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (payload: unknown) =>
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      const { controller, cleanup } = makeAbortOnDisconnect(request);

      try {
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              model: MODEL,
              messages,
              tools: toolDefinitions,
              stream: true,
            }),
          });

          if (!res.ok) {
            const text = await res.text();
            request.log.error(
              { status: res.status, body: text },
              "Ollama error",
            );
            sendEvent({ type: "error", message: "Ollama request failed" });
            break;
          }

          let assistantContent = "";
          const toolCalls: ToolCall[] = [];

          if (!res.body) break;
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
                  assistantContent += parsed.message.content;
                  sendEvent({ type: "token", value: parsed.message.content });
                }
                if (parsed.message?.tool_calls?.length) {
                  toolCalls.push(...parsed.message.tool_calls);
                }
              } catch {
                // fragment
              }
            }
          }

          messages.push({
            role: "assistant",
            content: assistantContent,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          });

          if (!toolCalls.length) {
            sendEvent({ type: "done" });
            break;
          }

          for (const tc of toolCalls) {
            const name = tc.function.name;
            const args = tc.function.arguments;

            request.log.info({ name, args }, "Tool call");
            sendEvent({ type: "tool_call", name, args });

            let result;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              result = await executeTool(name as any, args as any);
            } catch (err: unknown) {
              const errorMessage =
                err instanceof Error ? err.message : String(err);
              result = `Erreur: ${errorMessage}`;
              request.log.warn({ name, err: errorMessage }, "Tool error");
            }

            request.log.info({ name, result }, "Tool result");
            sendEvent({ type: "tool_result", name, result });

            messages.push({ role: "tool", content: String(result) });
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          request.log.error(err, "Agent error");
          sendEvent({ type: "error", message: err.message });
        }
      } finally {
        cleanup();
        reply.raw.end();
      }
    },
  );
};
