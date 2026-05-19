import { FastifyInstance } from "fastify";
import { AgentController } from "../presentation/http/controllers/AgentController.js";
import { StreamAgentResponseUseCase } from "../application/use_cases/StreamAgentResponseUseCase.js";
import { OllamaAdapter } from "../infrastructure/adapters/OllamaAdapter.js";
import { LocalToolRegistryAdapter } from "../infrastructure/adapters/LocalToolRegistryAdapter.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

export const agentRoute = async (app: FastifyInstance) => {
  // Dependency Injection Wiring
  const llmProvider = new OllamaAdapter(OLLAMA_URL, MODEL);
  const toolRegistry = new LocalToolRegistryAdapter();
  const useCase = new StreamAgentResponseUseCase(llmProvider, toolRegistry);
  const controller = new AgentController(useCase);

  const agentBodySchema = {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string", minLength: 1, maxLength: 4096 },
    },
    additionalProperties: false,
  };

  app.post(
    "/chat/agent",
    {
      schema: { body: agentBodySchema },
    },
    async (request, reply) => {
      await controller.handleAgentChat(request, reply);
    },
  );
};
