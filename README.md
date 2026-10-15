# Aarvi Messaging Worker

A separate Cloudflare Worker API for Aarvi messaging, intended to run in the second Cloudflare account and use its `aarvi-messages-db` D1 database.

## What is included

- Message list endpoint capped at 100 messages per request
- Message create endpoint
- Per-reader chat read-state endpoint
- Unread count endpoint
- D1 schema and indexes
- Shared-secret authentication for server-to-server calls

## Important

This is a starter API and is **not yet connected to the live Aarvi app**. Do not change the original Aarvi app repository for this setup.

The main Aarvi Worker must authenticate the current user and verify chat membership before forwarding requests to this service. Keep the service key only in Cloudflare Worker secrets; never put it in browser/mobile frontend code. The current API schema does not implement chat membership checks itself.

## Setup

1. In the second Cloudflare account, open D1 and copy the database ID for `aarvi-messages-db`.
2. Replace `REPLACE_WITH_DATABASE_ID` in `wrangler.jsonc` with that ID.
3. Install Wrangler and authenticate to the second Cloudflare account:

   ```sh
   npm install
   npx wrangler login
   npx wrangler d1 list
   ```

4. Apply the schema:

   ```sh
   npx wrangler d1 migrations apply aarvi-messages-db --remote
   ```

5. Set a strong random secret and deploy:

   ```sh
   npx wrangler secret put AARVI_SERVICE_KEY
   npm run deploy
   ```

   Use the same secret in the main Aarvi Worker under the secret name `MESSAGING_API_KEY`, and configure the messaging Worker URL there. Never commit either secret.

## Routes

Every route requires the `X-AARVI-SERVICE-KEY` header.

- `GET /health`
- `GET /api/messages?chatId=CHAT_ID&limit=100`
- `GET /api/messages?chatId=CHAT_ID&before=ISO_TIMESTAMP&limit=100`
- `POST /api/messages` with JSON `{ "chatId": "...", "senderId": "...", "body": "..." }`
- `POST /api/messages/read` with JSON `{ "chatId": "...", "readerId": "..." }`
- `GET /api/chats/unread?readerId=USER_ID`

The limit is clamped to 1–100. Existing Aarvi messages are not migrated automatically.

## Production integration checklist

- Verify chat membership in the main Worker before every message/read operation.
- Replace the current main Worker message reads/writes with authenticated server-to-server requests to this Worker.
- Restrict CORS to the exact app origin if browser access is ever needed. Do not expose the service key to the browser.
- Add pagination and appropriate authorization rules for each route.
