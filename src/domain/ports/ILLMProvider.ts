import { Message } from "../entities/Message.js";

export interface ILLMResponseChunk {
  content: string;
  tool_calls: { name: string; arguments: string }[];
}

export interface ILLMProvider {
  streamChat(
    messages: Message[],
    signal: AbortSignal,
    tools: unknown[],
  ): AsyncIterable<ILLMResponseChunk>;
}
