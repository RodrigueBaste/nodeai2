import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { chunkMarkdown } from "./chunker.js";
import { Database } from "better-sqlite3";
import { DatabaseStatements } from "../types/database.js";
import { IndexingResult } from "./types.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";
const DOCS_DIR = join(process.cwd(), "docs");

/**
 * Calcule l'embedding d'un texte via Ollama.
 */
export const getEmbedding = async (text: string): Promise<number[]> => {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });

  if (!res.ok) throw new Error(`Ollama embeddings error: ${res.status}`);

  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
};

/**
 * Scanne ./docs, chunke tous les .md et stocke leurs embeddings dans SQLite.
 */
export const indexDocs = async (
  db: Database,
  stmts: DatabaseStatements,
): Promise<IndexingResult> => {
  const files = await readdir(DOCS_DIR, { recursive: true });
  const markdownFiles = files.filter((f) => extname(f) === ".md");

  // Vide les chunks existants avant réindexation
  db.prepare("DELETE FROM chunks").run();

  const processingResults = await Promise.all(
    markdownFiles.map(async (file) => {
      const fullPath = join(DOCS_DIR, file);
      const content = await readFile(fullPath, "utf8");
      const chunks = chunkMarkdown(content, file);

      // Traitement séquentiel par fichier pour ne pas surcharger Ollama
      // mais on peut paralléliser les fichiers.
      let fileChunks = 0;
      for (const chunk of chunks) {
        const embedding = await getEmbedding(chunk.content);
        stmts.insertChunk.run(
          chunk.source,
          chunk.section,
          chunk.position,
          chunk.content,
          JSON.stringify(embedding),
        );
        fileChunks++;
      }
      return fileChunks;
    }),
  );

  const totalChunks = processingResults.reduce((acc, count) => acc + count, 0);
  return { files: markdownFiles.length, chunks: totalChunks };
};
