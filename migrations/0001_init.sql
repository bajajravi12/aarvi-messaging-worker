PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created
  ON messages(chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_reads (
  chat_id TEXT NOT NULL,
  reader_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, reader_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_reads_reader
  ON chat_reads(reader_id);
