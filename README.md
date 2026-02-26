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

## Local testing (without Discord)

Add `LOCAL_DEV=1` to `.dev.vars`, then run `pnpm dev`:

- **Trigger scheduler** — `curl http://localhost:8787/__dev/trigger-scheduler`
- **Wrangler cron** — `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`
- **Test slash commands** — POST JSON to `/__dev/slash`:

  ```bash
  # /settings view
  curl -X POST http://localhost:8787/__dev/slash -H "Content-Type: application/json" -d '{"type":2,"data":{"name":"settings","options":[{"name":"view"}]}}'

  # /settings set time-start=19 time-end=22
  curl -X POST http://localhost:8787/__dev/slash -H "Content-Type: application/json" -d '{"type":2,"data":{"name":"settings","options":[{"name":"set","options":[{"name":"time-start","value":19},{"name":"time-end","value":22}]}]}}'

  # /booked
  curl -X POST http://localhost:8787/__dev/slash -H "Content-Type: application/json" -d '{"type":2,"data":{"name":"booked"}}'

  # /cancel
  curl -X POST http://localhost:8787/__dev/slash -H "Content-Type: application/json" -d '{"type":2,"data":{"name":"cancel"}}'

  # /check (manual availability lookup, bypasses cooldown)
  curl -X POST http://localhost:8787/__dev/slash -H "Content-Type: application/json" -d '{"type":2,"data":{"name":"check"}}'
  ```

## Commands

- `/check` — Check court availability now (bypasses cooldown, returns times directly)
- `/booked` — Pause notifications for the current week
- `/cancel` — Resume notifications
- `/settings view` — Show current time range, min block, and timezone
- `/settings set` — Update `time-start` (0–23), `time-end` (0–23), `min-block` (1–8), `timezone` (e.g. Australia/Perth)
