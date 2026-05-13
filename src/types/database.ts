import { z } from "zod";

export const RoleSchema = z.enum(["user", "assistant", "system"]);
export type Role = z.infer<typeof RoleSchema>;

export interface Conversation {
  id: number;
  title: string;
  createdAt: string;
}

export interface ConversationWithCount extends Conversation {
  messageCount: number;
}

export interface Message {
  id: number;
  conversationId: number;
  role: Role;
  content: string;
  createdAt: string;
}

export interface Chunk {
  id: number;
  source: string;
  section: string;
  position: number;
  content: string;
  embedding: string; // JSON string or float array? In DB it's TEXT
}

import { Statement } from "better-sqlite3";

export interface DatabaseStatements {
  createConv: Statement<[string], Conversation>;
  listConvs: Statement<[], ConversationWithCount>;
  getConv: Statement<[number], Conversation>;
  deleteConv: Statement<[number], void>;
  getMessages: Statement<[number], Message>;
  addMessage: Statement<[number, string, string], Message>;
  insertChunk: Statement<[string, string, number, string, string], void>;
  getAllChunks: Statement<[], Chunk>;
  countChunks: Statement<[], { count: number }>;
}
