/**
 * Serveur MCP (Model Context Protocol)
 * Transport : stdio (stdin/stdout)
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";

import { executeTool } from "../tools/registry.js";
import { cosineSimilaritySearch } from "./retriever-standalone.js";

const DOCS_DIR = join(process.cwd(), "docs");

// Initialize McpServer (high-level API)
const server = new McpServer({
  name: "mongpt",
  version: "1.0.0",
});

// Helper wrapper for structured logs and error safety with strict types
const wrapToolCall = async (
  name: string,
  args: Record<string, unknown>,
  executor: () => Promise<string>,
) => {
  process.stderr.write(`[MCP] tool_call: ${name} ${JSON.stringify(args)}\n`);
  try {
    const result = await executor();
    process.stderr.write(`[MCP] tool_result: ${result.slice(0, 100)}\n`);
    return {
      content: [{ type: "text" as const, text: result }],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[MCP] tool_error: ${msg}\n`);
    return {
      content: [{ type: "text" as const, text: `Erreur: ${msg}` }],
      isError: true,
    };
  }
};

// Register Tools using non-deprecated registerTool API
server.registerTool(
  "get_weather",
  {
    description: "Retourne la météo actuelle pour une ville.",
    inputSchema: z.object({
      city: z.string().describe("Nom de la ville (ex: Paris, Lyon, Bordeaux)"),
    }),
  },
  async (args) =>
    wrapToolCall("get_weather", args, () => executeTool("get_weather", args)),
);

server.registerTool(
  "calculator",
  {
    description: "Évalue une expression mathématique simple.",
    inputSchema: z.object({
      expression: z.string().describe("Expression mathématique à évaluer"),
    }),
  },
  async (args) =>
    wrapToolCall("calculator", args, () => executeTool("calculator", args)),
);

server.registerTool(
  "get_datetime",
  {
    description: "Retourne la date et l'heure actuelle.",
    inputSchema: z.object({}),
  },
  async (args) =>
    wrapToolCall("get_datetime", args, () => executeTool("get_datetime", args)),
);

server.registerTool(
  "read_local_file",
  {
    description: "Lit un fichier dans le dossier ./docs du projet.",
    inputSchema: z.object({
      filename: z
        .string()
        .describe("Nom du fichier dans ./docs (ex: notes.md)"),
    }),
  },
  async (args) =>
    wrapToolCall("read_local_file", args, () =>
      executeTool("read_local_file", args),
    ),
);

server.registerTool(
  "search_docs",
  {
    description:
      "Recherche les passages les plus pertinents dans la documentation Markdown.",
    inputSchema: z.object({
      query: z.string().describe("Question ou sujet à rechercher"),
      k: z
        .number()
        .optional()
        .default(3)
        .describe("Nombre de résultats (défaut: 3)"),
    }),
  },
  async (args) =>
    wrapToolCall("search_docs", args, async () => {
      return await searchDocs(args.query, args.k);
    }),
);

// Register Resources using ResourceTemplate pattern
const resourceTemplate = new ResourceTemplate("docs://{filename}", {
  list: async () => {
    const files = await readdir(DOCS_DIR, { recursive: true });
    return {
      resources: files
        .filter((f) => extname(f) === ".md")
        .map((f) => ({
          uri: `docs://${f}`,
          name: f,
          description: `Document Markdown: ${f}`,
          mimeType: "text/markdown",
        })),
    };
  },
});

server.registerResource(
  "Markdown Document",
  resourceTemplate,
  { mimeType: "text/markdown" },
  async (uri, variables) => {
    const filename = variables.filename as string;
    const content = await readFile(join(DOCS_DIR, filename), "utf8");
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: content,
        },
      ],
    };
  },
);

const searchDocs = async (query: string, k: number): Promise<string> => {
  const results = await cosineSimilaritySearch(query, k);
  if (results.length === 0) return "Aucun document pertinent trouvé.";
  return results
    .map(
      (r) =>
        `[${r.source}§${r.section}] (similarité: ${r.similarity})\n${r.content}`,
    )
    .join("\n\n---\n\n");
};

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write("[MCP] Serveur mongpt démarré — en attente sur stdin\n");
