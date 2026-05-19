import { FastifyRequest, FastifyReply } from "fastify";
import {
  ChatUseCase,
  IChatEventSender,
} from "../../../application/use_cases/ChatUseCase.js";
import { z } from "zod";
import { Message } from "../../../domain/entities/Message.js";

export const chatBodySchema = z.object({
  message: z.string().min(1).max(4096),
});

const makeAbortOnDisconnect = (request: FastifyRequest) => {
  const controller = new AbortController();
  const onClose = () => {
    request.log.info("Client disconnected — aborting logic");
    controller.abort();
  };
  request.raw.once("close", onClose);
  const cleanup = () => request.raw.removeListener("close", onClose);
  return { controller, cleanup };
};

export class ChatController {
  constructor(private readonly chatUseCase: ChatUseCase) {}

  public async handleComplete(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parseResult = chatBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({ error: "Invalid request body" });
      return;
    }

    const { message } = parseResult.data;
    const { controller, cleanup } = makeAbortOnDisconnect(request);

    try {
      const messages: Message[] = [{ role: "user", content: message }];
      const response = await this.chatUseCase.executeComplete(
        messages,
        controller.signal,
      );
      return reply.send({ response });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      request.log.error({ err: errorMessage }, "Chat request failed");
      return reply.status(502).send({ error: "Chat request failed" });
    } finally {
      cleanup();
    }
  }

  public async handleStream(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parseResult = chatBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({ error: "Invalid request body" });
      return;
    }

    const { message } = parseResult.data;
    const { controller, cleanup } = makeAbortOnDisconnect(request);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const sender: IChatEventSender = {
      sendToken: (token: string) => sendEvent({ type: "token", value: token }),
      sendError: (msg: string) => sendEvent({ type: "error", message: msg }),
      sendDone: () => sendEvent({ type: "done" }),
      logError: (err: unknown, msg: string) =>
        request.log.error(err as object, msg),
    };

    try {
      const messages: Message[] = [{ role: "user", content: message }];
      await this.chatUseCase.executeStream(messages, controller.signal, sender);
    } finally {
      cleanup();
      reply.raw.end();
    }
  }
}
