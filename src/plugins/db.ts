import fp from "fastify-plugin";
import Database, { Database as DBType } from "better-sqlite3";
import { join } from "node:path";
import { FastifyInstance } from "fastify";
import { DatabaseStatements } from "../types/database.js";
import { indexDocs } from "../rag/indexer.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DBType;
    stmts: DatabaseStatements;
  }
}

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), "data.db");

const dbPlugin = async (app: FastifyInstance) => {
  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      title     TEXT    NOT NULL,
      createdAt TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role           TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content        TEXT    NOT NULL,
      createdAt      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      source    TEXT    NOT NULL,
      section   TEXT    NOT NULL,
      position  INTEGER NOT NULL,
      content   TEXT    NOT NULL,
      embedding TEXT    NOT NULL
    );
  `);

  const stmts: DatabaseStatements = {
    createConv: db.prepare(
      "INSERT INTO conversations (title) VALUES (?) RETURNING *",
    ),
    listConvs: db.prepare(`
      SELECT c.id, c.title, c.createdAt,
             COUNT(m.id) AS messageCount
      FROM conversations c
      LEFT JOIN messages m ON m.conversationId = c.id
      GROUP BY c.id ORDER BY c.createdAt DESC
    `),
    getConv: db.prepare("SELECT * FROM conversations WHERE id = ?"),
    deleteConv: db.prepare("DELETE FROM conversations WHERE id = ?"),
    getMessages: db.prepare(
      "SELECT * FROM messages WHERE conversationId = ? ORDER BY id",
    ),
    addMessage: db.prepare(
      "INSERT INTO messages (conversationId, role, content) VALUES (?, ?, ?) RETURNING *",
    ),
    insertChunk: db.prepare(
      "INSERT INTO chunks (source, section, position, content, embedding) VALUES (?, ?, ?, ?, ?)",
    ),
    getAllChunks: db.prepare(
      "SELECT id, source, section, position, content, embedding FROM chunks",
    ),
    countChunks: db.prepare("SELECT COUNT(*) as count FROM chunks"),
  };

  app.decorate("db", db);
  app.decorate("stmts", stmts);

  app.addHook("onClose", async () => {
    db.close();
  });

  app.addHook("onReady", async () => {
    const { count } = stmts.countChunks.get() as { count: number };
    if (count === 0) {
      app.log.info("RAG: No chunks in database, starting indexing...");
      try {
        const { files, chunks } = await indexDocs(db, stmts);
        app.log.info(`RAG: Indexed ${chunks} chunks from ${files} files`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        app.log.warn(
          { err: errorMessage },
          "RAG: Indexing failed (empty docs or Ollama unavailable)",
        );
      }
    } else {
      app.log.info(`RAG: ${count} chunks already indexed`);
    }
  });
};

export default fp(dbPlugin, { name: "db" });
