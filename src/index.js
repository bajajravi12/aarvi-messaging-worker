import express from "express";
import cors from "cors";
import helmet from "helmet";
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "64kb" }));

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({
  origin: corsOrigin === "*" ? "*" : corsOrigin.split(",").map(v => v.trim()),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-AARVI-SERVICE-KEY"]
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000
});
const serviceKey = process.env.AARVI_SERVICE_KEY;

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS chat_reads (
      chat_id TEXT NOT NULL, reader_id TEXT NOT NULL,
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, reader_id)
    );
  `);
}
function requireServiceKey(req, res, next) {
  if (!serviceKey) return res.status(503).json({ error: "Server is not configured: service key missing" });
  const a = Buffer.from(req.get("X-AARVI-SERVICE-KEY") || "");
  const b = Buffer.from(serviceKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/", (_req, res) => res.json({ service: "aarvi-messaging-api", health: "/health" }));
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "aarvi-messaging-api", database: "connected" });
  } catch (_) {
    res.status(503).json({ ok: false, service: "aarvi-messaging-api", database: "unavailable" });
  }
});
app.use("/api", requireServiceKey);

app.get("/api/messages", async (req, res) => {
  const chatId = String(req.query.chatId || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || "100", 10) || 100, 1), 100);
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (!chatId) return res.status(400).json({ error: "chatId is required" });
  if (before && Number.isNaN(before.getTime())) return res.status(400).json({ error: "before must be a valid date" });
  try {
    const args = [chatId];
    let sql = 'SELECT id, chat_id AS "chatId", sender_id AS "senderId", body, created_at AS "createdAt" FROM messages WHERE chat_id = $1';
    if (before) { args.push(before.toISOString()); sql += " AND created_at < $2"; }
    args.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${args.length}`;
    const result = await pool.query(sql, args);
    res.json({ messages: result.rows.reverse() });
  } catch (_) { res.status(500).json({ error: "Could not fetch messages" }); }
});

app.post("/api/messages", async (req, res) => {
  const chatId = String(req.body.chatId || "").trim();
  const senderId = String(req.body.senderId || "").trim();
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
  if (!chatId || !senderId || !body) return res.status(400).json({ error: "chatId, senderId and non-empty body are required" });
  if (chatId.length > 200 || senderId.length > 200 || body.length > 10000) return res.status(413).json({ error: "One or more fields exceed allowed length" });
  try {
    const result = await pool.query(
      'INSERT INTO messages (id, chat_id, sender_id, body) VALUES ($1, $2, $3, $4) RETURNING id, chat_id AS "chatId", sender_id AS "senderId", body, created_at AS "createdAt"',
      [crypto.randomUUID(), chatId, senderId, body]
    );
    res.status(201).json({ message: result.rows[0] });
  } catch (_) { res.status(500).json({ error: "Could not save message" }); }
});

app.post("/api/messages/read", async (req, res) => {
  const chatId = String(req.body.chatId || "").trim();
  const readerId = String(req.body.readerId || "").trim();
  if (!chatId || !readerId) return res.status(400).json({ error: "chatId and readerId are required" });
  try {
    const result = await pool.query(
      `INSERT INTO chat_reads (chat_id, reader_id, last_read_at) VALUES ($1, $2, NOW())
       ON CONFLICT (chat_id, reader_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
       RETURNING chat_id AS "chatId", reader_id AS "readerId", last_read_at AS "lastReadAt"`,
      [chatId, readerId]
    );
    res.json({ read: result.rows[0] });
  } catch (_) { res.status(500).json({ error: "Could not update read status" }); }
});

app.get("/api/chats/unread", async (req, res) => {
  const readerId = String(req.query.readerId || "").trim();
  if (!readerId) return res.status(400).json({ error: "readerId is required" });
  try {
    const result = await pool.query(
      `SELECT m.chat_id AS "chatId", COUNT(*)::int AS count
       FROM messages m LEFT JOIN chat_reads r ON r.chat_id = m.chat_id AND r.reader_id = $1
       WHERE m.sender_id <> $1 AND m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
       GROUP BY m.chat_id`,
      [readerId]
    );
    res.json({ unread: result.rows });
  } catch (_) { res.status(500).json({ error: "Could not fetch unread counts" }); }
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled request error:", err?.message || "unknown");
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 10000);
initDb()
  .then(() => app.listen(port, "0.0.0.0", () => console.log(`Aarvi Messaging API listening on ${port}`)))
  .catch(err => { console.error("Database initialization failed:", err.message); process.exit(1); });

process.on("SIGTERM", async () => { await pool.end().catch(() => {}); process.exit(0); });
