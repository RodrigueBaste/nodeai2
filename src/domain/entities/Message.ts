export interface ToolCall {
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[];
}
