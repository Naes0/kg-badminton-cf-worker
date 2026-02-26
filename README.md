# Badminton Court Availability Notifier

Cloudflare Worker that polls the AFA Sports booking API every 5 minutes and sends Discord notifications when badminton court slots open up in your configured time window.

## Setup

1. **Copy env template**
   ```bash
   cp .env.local.example .env.local
   ```
   Fill in `.env.local`. For local Worker dev, also copy to `.dev.vars`.

2. **Create KV namespace**
   ```bash
   pnpm exec wrangler kv namespace create BADMINTON_KV
   ```
   Paste the ID into `wrangler.jsonc` → `kv_namespaces[0].id`.

3. **Set secrets** (production)
   ```bash
   pnpm exec wrangler secret put DISCORD_WEBHOOK_URL
   pnpm exec wrangler secret put DISCORD_PUBLIC_KEY
   ```

4. **Register slash commands** (loads from `.env.local`)
   ```bash
   pnpm run register-commands
   ```

5. **Set Discord Interactions Endpoint**  
   In Discord Developer Portal → Your App → General Information → Interactions Endpoint URL:  
   `https://your-worker.workers.dev`

6. **Deploy**
   ```bash
   pnpm deploy
   ```

## Commands

- `/booked` — Pause notifications for the current week
- `/cancel` — Resume notifications
- `/settings view` — Show current time range, min block, and timezone
- `/settings set` — Update `time-start` (0–23), `time-end` (0–23), `min-block` (1–8), `timezone` (e.g. Australia/Perth)
