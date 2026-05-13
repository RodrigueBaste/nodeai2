export interface ChunkData {
  source: string;
  section: string;
  position: number;
  content: string;
}

export interface IndexingResult {
  files: number;
  chunks: number;
}
