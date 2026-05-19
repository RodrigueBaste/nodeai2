export interface IToolRegistry {
  getToolDefinitions(): unknown[];
  executeTool(name: string, args: unknown): Promise<string>;
}
