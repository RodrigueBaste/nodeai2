import { getEmbedding } from "./indexer.js";
import { DatabaseStatements } from "../types/database.js";

const MIN_SIMILARITY = 0.65;

export interface RetrievableChunk {
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

/**
 * Retrouve les K chunks les plus pertinents pour une query.
 */
export const retrieve = async (
  stmts: DatabaseStatements,
  query: string,
  k = 4,
): Promise<RetrievableChunk[]> => {
  const queryEmbedding = await getEmbedding(query);

  // Récupère tous les chunks avec leurs embeddings
  const chunks = stmts.getAllChunks.all() as {
    embedding: string;
    source: string;
    section: string;
    content: string;
  }[];

  // Calcule la similarité cosinus pour chaque chunk
  const ranked = chunks
    .map((chunk) => {
      const embedding = JSON.parse(chunk.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      return {
        source: chunk.source,
        section: chunk.section,
        content: chunk.content,
        similarity,
      };
    })
    .filter((c) => c.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  return ranked;
};
