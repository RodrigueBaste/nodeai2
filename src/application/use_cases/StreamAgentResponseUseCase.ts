import {
  ILLMProvider,
  ILLMResponseChunk,
} from "../../domain/ports/ILLMProvider.js";
import { IToolRegistry } from "../../domain/ports/IToolRegistry.js";
import { Message, ToolCall } from "../../domain/entities/Message.js";

export interface IAgentEventSender {
  sendToken(token: string): void;
  sendToolCall(name: string, args: string): void;
  sendToolResult(name: string, result: string): void;
  sendError(message: string): void;
  sendDone(): void;
  logInfo(obj: unknown, msg: string): void;
  logWarn(obj: unknown, msg: string): void;
  logError(err: unknown, msg: string): void;
}

export class StreamAgentResponseUseCase {
  private readonly MAX_ITERATIONS = 5;

  constructor(
    private readonly llmProvider: ILLMProvider,
    private readonly toolRegistry: IToolRegistry,
  ) {}

  public async execute(
    initialMessage: string,
    signal: AbortSignal,
    sender: IAgentEventSender,
  ): Promise<void> {
    const messages: Message[] = [{ role: "user", content: initialMessage }];
    const toolDefinitions = this.toolRegistry.getToolDefinitions();

    try {
      for (let iteration = 0; iteration < this.MAX_ITERATIONS; iteration++) {
        const stream = this.llmProvider.streamChat(
          messages,
          signal,
          toolDefinitions,
        );

        const { assistantContent, toolCalls } = await this.processStream(
          stream,
          sender,
        );

        messages.push({
          role: "assistant",
          content: assistantContent,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });

        if (toolCalls.length === 0) {
          sender.sendDone();
          break;
        }

        await this.executeToolCalls(toolCalls, sender, messages);
      }
    } catch (err: unknown) {
      this.handleExecutionError(err, sender);
    }
  }

  private async processStream(
    stream: AsyncIterable<ILLMResponseChunk>,
    sender: IAgentEventSender,
  ): Promise<{ assistantContent: string; toolCalls: ToolCall[] }> {
    let assistantContent = "";
    const toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      if (chunk.content) {
        assistantContent += chunk.content;
        sender.sendToken(chunk.content);
      }
      if (chunk.tool_calls && chunk.tool_calls.length > 0) {
        for (const tc of chunk.tool_calls) {
          toolCalls.push({
            function: { name: tc.name, arguments: tc.arguments },
          });
        }
      }
    }

    return { assistantContent, toolCalls };
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    sender: IAgentEventSender,
    messages: Message[],
  ): Promise<void> {
    for (const tc of toolCalls) {
      const name = tc.function.name;
      const args = tc.function.arguments;

      sender.logInfo({ name, args }, "Tool call");
      sender.sendToolCall(name, args);

      const result = await this.safeExecuteTool(name, args, sender);

      sender.logInfo({ name, result }, "Tool result");
      sender.sendToolResult(name, result);

      messages.push({ role: "tool", content: result });
    }
  }

  private async safeExecuteTool(
    name: string,
    args: string,
    sender: IAgentEventSender,
  ): Promise<string> {
    try {
      return await this.toolRegistry.executeTool(name, args);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sender.logWarn({ name, err: errorMessage }, "Tool error");
      return `Erreur: ${errorMessage}`;
    }
  }

  private handleExecutionError(err: unknown, sender: IAgentEventSender): void {
    if (err instanceof Error && err.name !== "AbortError") {
      sender.logError(err, "Agent error");
      sender.sendError(err.message);
    }
  }
}
