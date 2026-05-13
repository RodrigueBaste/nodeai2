/**
 * Serveur MCP (Model Context Protocol)
 * Transport : stdio (stdin/stdout)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";

import { executeTool } from "../tools/registry.js";
import {
  cosineSimilaritySearch,
  SearchResult,
} from "./retriever-standalone.js";

const DOCS_DIR = join(process.cwd(), "docs");

const MCP_TOOLS = [
  {
    name: "get_weather",
    description: "Retourne la météo actuelle pour une ville.",
    inputSchema: {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string", description: "Nom de la ville" } },
    },
  },
  {
    name: "calculator",
    description: "Évalue une expression mathématique.",
    inputSchema: {
      type: "object",
      required: ["expression"],
      properties: {
        expression: { type: "string", description: "Expression à calculer" },
      },
    },
  },
  {
    name: "get_datetime",
    description: "Retourne la date et l'heure actuelle.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_local_file",
    description: "Lit un fichier dans le dossier ./docs.",
    inputSchema: {
      type: "object",
      required: ["filename"],
      properties: {
        filename: { type: "string", description: "Nom du fichier dans ./docs" },
      },
    },
  },
  {
    name: "search_docs",
    description:
      "Recherche les passages les plus pertinents dans la documentation Markdown.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Question ou sujet à rechercher",
        },
        k: {
          type: "number",
          description: "Nombre de résultats (défaut: 3)",
          default: 3,
        },
      },
    },
  },
];

const server = new Server(
  { name: "mongpt", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: MCP_TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  process.stderr.write(`[MCP] tool_call: ${name} ${JSON.stringify(args)}\n`);

  try {
    let result: string | SearchResult[];

    if (name === "search_docs") {
      const query = (args as { query: string }).query;
      const k = (args as { k?: number }).k ?? 3;
      result = await searchDocs(query, k);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await executeTool(name as any, args as Record<string, unknown>);
    }

    process.stderr.write(
      `[MCP] tool_result: ${String(result).slice(0, 100)}\n`,
    );

    return {
      content: [{ type: "text", text: String(result) }],
      isError: false,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[MCP] tool_error: ${errorMessage}\n`);
    return {
      content: [{ type: "text", text: `Erreur: ${errorMessage}` }],
      isError: true,
    };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const files = await readdir(DOCS_DIR, { recursive: true });
  const resources = files
    .filter((f) => extname(f) === ".md")
    .map((f) => ({
      uri: `docs://${f}`,
      name: f,
      description: `Document Markdown: ${f}`,
      mimeType: "text/markdown",
    }));
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const filename = uri.replace("docs://", "");
  const content = await readFile(join(DOCS_DIR, filename), "utf8");
  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text: content,
      },
    ],
  };
});

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
