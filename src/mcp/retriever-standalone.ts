/**
 * Retriever standalone pour le serveur MCP.
 * Pas de SQLite partagé — on lit les fichiers à la volée et on calcule
 * les embeddings on-demand. Adapté pour un serveur MCP léger.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { chunkMarkdown } from "../rag/chunker.js";
import { getEmbedding } from "../rag/indexer.js";
import { ChunkData } from "../rag/types.js";

const DOCS_DIR = join(process.cwd(), "docs");
const MIN_SIMILARITY = 0.65;

interface CachedChunk extends ChunkData {
  embedding: number[];
}

export interface SearchResult {
  source: string;
  section: string;
  content: string;
  similarity: number;
}

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/** Cache en mémoire pour éviter de recalculer les embeddings à chaque appel */
let chunksCache: CachedChunk[] | null = null;

const loadChunks = async (): Promise<CachedChunk[]> => {
  if (chunksCache) return chunksCache;

  const files = await readdir(DOCS_DIR, { recursive: true });
  const markdownFiles = files.filter((f) => extname(f) === ".md");

  const allChunks: CachedChunk[] = [];
  for (const file of markdownFiles) {
    const content = await readFile(join(DOCS_DIR, file), "utf8");
    const chunks = chunkMarkdown(content, file);
    for (const chunk of chunks) {
      const embedding = await getEmbedding(chunk.content);
      allChunks.push({ ...chunk, embedding });
    }
  }

  chunksCache = allChunks;
  return allChunks;
};

export const cosineSimilaritySearch = async (
  query: string,
  k: number = 3,
): Promise<SearchResult[]> => {
  const queryEmbedding = await getEmbedding(query);
  const chunks = await loadChunks();

  return chunks
    .map((c) => ({
      source: c.source,
      section: c.section,
      content: c.content,
      similarity:
        Math.round(cosineSimilarity(queryEmbedding, c.embedding) * 1000) / 1000,
    }))
    .filter((c) => c.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
};
