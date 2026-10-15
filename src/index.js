const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-AARVI-SERVICE-KEY",
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export default {
  async fetch(request, env) {
    // Keep the health check independent of secrets, bindings, and API helpers.
    // This makes it possible to verify that the deployed Worker is responding.
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (url.pathname === "/health" && request.method === "GET") {
        return new Response('{"ok":true,"service":"aarvi-messaging-worker"}', {
          status: 200,
          headers: corsHeaders
        });
      }

      if (!env || !env.MSG_DB) return json({ error: "MSG_DB binding is missing" }, 500);
      if (!env.AARVI_SERVICE_KEY) return json({ error: "Service key is not configured" }, 500);

      const suppliedKey = request.headers.get("X-AARVI-SERVICE-KEY") || "";
      if (!constantTimeEqual(suppliedKey, env.AARVI_SERVICE_KEY)) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (url.pathname === "/api/messages" && request.method === "GET") {
        const chatId = url.searchParams.get("chatId");
        if (!validId(chatId)) return json({ error: "Valid chatId is required" }, 400);

        const rawLimit = Number(url.searchParams.get("limit") || 100);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 100;
        const before = url.searchParams.get("before");
        const sql = before
          ? `SELECT id, chat_id AS chatId, sender_id AS senderId, body, created_at AS createdAt
             FROM messages WHERE chat_id = ? AND created_at < ?
             ORDER BY created_at DESC LIMIT ?`
          : `SELECT id, chat_id AS chatId, sender_id AS senderId, body, created_at AS createdAt
             FROM messages WHERE chat_id = ?
             ORDER BY created_at DESC LIMIT ?`;
        const stmt = before
          ? env.MSG_DB.prepare(sql).bind(chatId, before, limit)
          : env.MSG_DB.prepare(sql).bind(chatId, limit);
        const result = await stmt.all();
        return json({ chatId, messages: (result.results || []).reverse(), limit });
      }

      if (url.pathname === "/api/messages" && request.method === "POST") {
        const input = await request.json().catch(() => null);
        if (!input || !validId(input.chatId) || !validId(input.senderId) ||
            typeof input.body !== "string" || !input.body.trim() || input.body.length > 10000) {
          return json({ error: "chatId, senderId and a non-empty body (max 10000 chars) are required" }, 400);
        }

        const id = validId(input.id) ? input.id : crypto.randomUUID();
        const createdAt = new Date().toISOString();
        await env.MSG_DB.prepare(
          "INSERT INTO messages (id, chat_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(id, input.chatId, input.senderId, input.body.trim(), createdAt).run();

        return json({
          ok: true,
          message: { id, chatId: input.chatId, senderId: input.senderId, body: input.body.trim(), createdAt }
        }, 201);
      }

      if (url.pathname === "/api/messages/read" && request.method === "POST") {
        const input = await request.json().catch(() => null);
        if (!input || !validId(input.chatId) || !validId(input.readerId)) {
          return json({ error: "chatId and readerId are required" }, 400);
        }

        const readAt = new Date().toISOString();
        await env.MSG_DB.prepare(
          `INSERT INTO chat_reads (chat_id, reader_id, last_read_at)
           VALUES (?, ?, ?)
           ON CONFLICT(chat_id, reader_id) DO UPDATE SET last_read_at = excluded.last_read_at`
        ).bind(input.chatId, input.readerId, readAt).run();

        return json({ ok: true, chatId: input.chatId, readerId: input.readerId, lastReadAt: readAt });
      }

      if (url.pathname === "/api/chats/unread" && request.method === "GET") {
        const readerId = url.searchParams.get("readerId");
        if (!validId(readerId)) return json({ error: "Valid readerId is required" }, 400);
        const result = await env.MSG_DB.prepare(
          `SELECT m.chat_id AS chatId, COUNT(*) AS unreadCount
           FROM messages m
           LEFT JOIN chat_reads r ON r.chat_id = m.chat_id AND r.reader_id = ?
           WHERE m.sender_id != ?
             AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
           GROUP BY m.chat_id`
        ).bind(readerId, readerId).all();
        return json({ unread: result.results || [] });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Aarvi messaging Worker exception:", error && error.stack ? error.stack : String(error));
      return json({ error: "Internal server error" }, 500);
    }
  }
};
