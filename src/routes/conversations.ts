import { FastifyInstance } from "fastify";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";

const messageSchema = {
  $id: "Message",
  type: "object",
  properties: {
    id: { type: "integer" },
    conversationId: { type: "integer" },
    role: { type: "string" },
    content: { type: "string" },
    createdAt: { type: "string" },
  },
};

const conversationSchema = {
  $id: "Conversation",
  type: "object",
  properties: {
    id: { type: "integer" },
    title: { type: "string" },
    createdAt: { type: "string" },
    messageCount: { type: "integer" },
  },
};

export const conversationsRoute = async (app: FastifyInstance) => {
  app.addSchema(messageSchema);
  app.addSchema(conversationSchema);

  // POST /conversations — crée une nouvelle conversation
  app.post(
    "/conversations",
    {
      schema: {
        response: { 201: { $ref: "Conversation#" } },
      },
    },
    async (request, reply) => {
      const conv = app.stmts.createConv.get("Nouvelle conversation");
      return reply.status(201).send(conv);
    },
  );

  // GET /conversations — liste toutes les conversations
  app.get(
    "/conversations",
    {
      schema: {
        response: { 200: { type: "array", items: { $ref: "Conversation#" } } },
      },
    },
    async () => {
      return app.stmts.listConvs.all();
    },
  );

  // GET /conversations/:id — détail + messages
  app.get<{ Params: { id: number } }>(
    "/conversations/:id",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "integer" },
              title: { type: "string" },
              createdAt: { type: "string" },
              messages: { type: "array", items: { $ref: "Message#" } },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const conv = app.stmts.getConv.get(request.params.id);
      if (!conv)
        return reply.notFound(`Conversation ${request.params.id} introuvable`);
      const messages = app.stmts.getMessages.all(conv.id);
      return { ...conv, messages };
    },
  );

  // DELETE /conversations/:id — supprime conversation et messages (CASCADE)
  app.delete<{ Params: { id: number } }>(
    "/conversations/:id",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
      },
    },
    async (request, reply) => {
      const result = app.stmts.deleteConv.run(request.params.id);
      if (result.changes === 0)
        return reply.notFound(`Conversation ${request.params.id} introuvable`);
      return reply.status(204).send();
    },
  );

  // POST /conversations/:id/messages — message user + réponse assistant en SSE
  app.post<{ Params: { id: number }; Body: { message: string } }>(
    "/conversations/:id/messages",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
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
      const convId = request.params.id;
      const conv = app.stmts.getConv.get(convId);
      if (!conv) return reply.notFound(`Conversation ${convId} introuvable`);

      const { message } = request.body;

      const history = app.stmts.getMessages.all(convId);
      if (history.length === 0) {
        app.db
          .prepare("UPDATE conversations SET title = ? WHERE id = ?")
          .run(message.slice(0, 60), convId);
      }

      app.stmts.addMessage.get(convId, "user", message);

      const updatedHistory = app.stmts.getMessages.all(convId);
      const ollamaMessages = updatedHistory.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (payload: unknown) =>
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);

      const sender = {
        sendToken: (token: string) =>
          sendEvent({ type: "token", value: token }),
        sendError: (message: string) => sendEvent({ type: "error", message }),
        sendDone: () => sendEvent({ type: "done" }),
        logError: (err: unknown, msg: string) => request.log.error(err, msg),
      };

      const { OllamaAdapter } =
        await import("../infrastructure/adapters/OllamaAdapter.js");
      const { ChatUseCase } =
        await import("../application/use_cases/ChatUseCase.js");
      const llmProvider = new OllamaAdapter(OLLAMA_URL, MODEL);
      const useCase = new ChatUseCase(llmProvider);

      const controller = new AbortController();
      request.raw.once("close", () => controller.abort());

      const fullResponse = await useCase.executeStream(
        ollamaMessages,
        controller.signal,
        sender,
      );

      if (fullResponse) {
        app.stmts.addMessage.get(convId, "assistant", fullResponse);
      }

      reply.raw.end();
    },
  );
};
