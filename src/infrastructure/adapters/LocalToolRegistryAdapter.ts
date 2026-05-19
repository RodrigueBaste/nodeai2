import { IToolRegistry } from "../../domain/ports/IToolRegistry.js";
import {
  toolDefinitions,
  executeTool,
  ToolName,
} from "../../tools/registry.js";

export class LocalToolRegistryAdapter implements IToolRegistry {
  public getToolDefinitions(): unknown[] {
    return Array.from(toolDefinitions);
  }

  public async executeTool(name: string, args: unknown): Promise<string> {
    return await executeTool(name as ToolName, args);
  }
}
