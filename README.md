# Aarvi Messaging API (Render)

This repository now contains a Node.js + Express messaging API intended for Render. It uses a separate PostgreSQL database and does not require changing the main Aarvi app repository or its `aarvi-db`.

## Render configuration
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Create a separate PostgreSQL database on Render and set the web service environment variables:
- `DATABASE_URL`: PostgreSQL Internal Database URL
- `AARVI_SERVICE_KEY`: long random secret
- `NODE_ENV`: `production`

## Routes
- `GET /`
- `GET /health`
- `GET /api/messages?chatId=CHAT_ID&limit=100`
- `POST /api/messages` body: `{"chatId":"chat-1","senderId":"user-1","body":"Hello"}`
- `POST /api/messages/read` body: `{"chatId":"chat-1","readerId":"user-1"}`
- `GET /api/chats/unread?readerId=USER_ID`

All `/api/*` endpoints require `X-AARVI-SERVICE-KEY`. Never put this key in frontend/mobile code. The trusted Aarvi backend must authenticate the user and authorize chat membership before forwarding requests.

The old Cloudflare `wrangler.jsonc` and migration files may remain in this repository but are not used by Render. Do not deploy this version to the old Cloudflare Worker expecting it to run as a D1 Worker.
