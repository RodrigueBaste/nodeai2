import {
  ILLMProvider,
  ILLMResponseChunk,
} from "../../domain/ports/ILLMProvider.js";
import { Message } from "../../domain/entities/Message.js";

export class OllamaAdapter implements ILLMProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  public async *streamChat(
    messages: Message[],
    signal: AbortSignal,
    tools: unknown[],
  ): AsyncIterable<ILLMResponseChunk> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama request failed: ${res.status} ${text}`);
    }

    if (!res.body) {
      throw new Error("No response body from Ollama");
    }

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
          const content = parsed.message?.content || "";
          const tcRaw = (parsed.message?.tool_calls || []) as {
            function: { name: string; arguments: unknown };
          }[];

          const tool_calls = tcRaw.map((tc) => ({
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments),
          }));

          yield { content, tool_calls };
        } catch {
          // Skip fragments or invalid JSON
        }
      }
    }
  }
}
