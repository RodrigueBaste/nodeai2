import matter from "gray-matter";
import { ChunkData } from "./types.js";

const CHUNK_SIZE = 500; // tokens approximatifs (1 token ≈ 4 chars)
const OVERLAP = 50; // tokens d'overlap entre chunks adjacents

/**
 * Découpe un fichier Markdown en chunks avec overlap.
 * Préserve les métadonnées frontmatter (titre, tags…).
 */
export const chunkMarkdown = (content: string, source: string): ChunkData[] => {
  const { data: frontmatter, content: body } = matter(content);
  const title = (frontmatter.title as string) ?? source;

  // Découpage par paragraphes (double saut de ligne)
  const paragraphs = body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: ChunkData[] = [];
  let currentChunk = "";
  let currentSection = title;
  let position = 0;

  const flush = () => {
    if (currentChunk.trim()) {
      chunks.push({
        source,
        section: currentSection,
        position: position++,
        content: currentChunk.trim(),
      });
    }
  };

  for (const paragraph of paragraphs) {
    // Détecte les titres Markdown pour mettre à jour la section courante
    const headingMatch = paragraph.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1];
    }

    const approxTokens = (currentChunk + paragraph).length / 4;

    if (approxTokens > CHUNK_SIZE && currentChunk) {
      flush();
      // Overlap : on garde les derniers OVERLAP tokens du chunk précédent
      const overlapChars = OVERLAP * 4;
      currentChunk = currentChunk.slice(-overlapChars) + "\n\n" + paragraph;
    } else {
      currentChunk = currentChunk
        ? currentChunk + "\n\n" + paragraph
        : paragraph;
    }
  }

  flush();
  return chunks;
};
