import { FastifyInstance } from "fastify";
import { ChatController } from "../presentation/http/controllers/ChatController.js";
import { ChatUseCase } from "../application/use_cases/ChatUseCase.js";
import { OllamaAdapter } from "../infrastructure/adapters/OllamaAdapter.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

export const chatRoute = async (app: FastifyInstance) => {
  const llmProvider = new OllamaAdapter(OLLAMA_URL, MODEL);
  const chatUseCase = new ChatUseCase(llmProvider);
  const controller = new ChatController(chatUseCase);

  const schemaDefinition = {
    body: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string", minLength: 1, maxLength: 4096 },
      },
    },
  };

  app.post(
    "/chat",
    {
      schema: {
        ...schemaDefinition,
        response: {
          200: {
            type: "object",
            properties: { response: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      await controller.handleComplete(request, reply);
    },
  );

  app.post(
    "/chat/stream",
    {
      schema: schemaDefinition,
    },
    async (request, reply) => {
      await controller.handleStream(request, reply);
    },
  );
};
