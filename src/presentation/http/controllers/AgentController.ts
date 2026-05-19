import { FastifyRequest, FastifyReply } from "fastify";
import {
  StreamAgentResponseUseCase,
  IAgentEventSender,
} from "../../../application/use_cases/StreamAgentResponseUseCase.js";
import { z } from "zod";

export const agentBodySchema = z.object({
  message: z.string().min(1).max(4096),
});

const makeAbortOnDisconnect = (request: FastifyRequest) => {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  request.socket.once("close", onClose);
  const cleanup = () => request.socket.removeListener("close", onClose);
  return { controller, cleanup };
};

export class AgentController {
  constructor(
    private readonly streamAgentResponseUseCase: StreamAgentResponseUseCase,
  ) {}

  public async handleAgentChat(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parseResult = agentBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({ error: "Invalid request body" });
      return;
    }

    const { message } = parseResult.data;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const sendEvent = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const { controller, cleanup } = makeAbortOnDisconnect(request);

    const sender: IAgentEventSender = {
      sendToken: (token: string) => sendEvent({ type: "token", value: token }),
      sendToolCall: (name: string, args: string) =>
        sendEvent({ type: "tool_call", name, args }),
      sendToolResult: (name: string, result: string) =>
        sendEvent({ type: "tool_result", name, result }),
      sendError: (msg: string) => sendEvent({ type: "error", message: msg }),
      sendDone: () => sendEvent({ type: "done" }),
      logInfo: (obj: unknown, msg: string) =>
        request.log.info(obj as object, msg),
      logWarn: (obj: unknown, msg: string) =>
        request.log.warn(obj as object, msg),
      logError: (err: unknown, msg: string) =>
        request.log.error(err as object, msg),
    };

    try {
      await this.streamAgentResponseUseCase.execute(
        message,
        controller.signal,
        sender,
      );
    } finally {
      cleanup();
      reply.raw.end();
    }
  }
}
