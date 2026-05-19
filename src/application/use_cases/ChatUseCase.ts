import { ILLMProvider } from "../../domain/ports/ILLMProvider.js";
import { Message } from "../../domain/entities/Message.js";

export interface IChatEventSender {
  sendToken(token: string): void;
  sendError(message: string): void;
  sendDone(): void;
  logError(err: unknown, msg: string): void;
}

export class ChatUseCase {
  constructor(private readonly llmProvider: ILLMProvider) {}

  public async executeComplete(
    messages: Message[],
    signal: AbortSignal,
  ): Promise<string> {
    const stream = this.llmProvider.streamChat(messages, signal, []);

    let fullContent = "";
    for await (const chunk of stream) {
      if (chunk.content) {
        fullContent += chunk.content;
      }
    }
    return fullContent;
  }

  public async executeStream(
    messages: Message[],
    signal: AbortSignal,
    sender: IChatEventSender,
  ): Promise<string> {
    let fullResponse = "";
    try {
      const stream = this.llmProvider.streamChat(messages, signal, []);

      for await (const chunk of stream) {
        if (chunk.content) {
          fullResponse += chunk.content;
          sender.sendToken(chunk.content);
        }
      }
      sender.sendDone();
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        sender.logError(err, "Streaming error");
        sender.sendError(err.message);
      }
    }
    return fullResponse;
  }
}
