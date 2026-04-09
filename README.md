# Yelp Leads Next.js App

Minimal Next.js App Router project for:

- Yelp webhook intake and forwarding into the main platform
- Yelp OAuth callback
- secure token persistence
- automatic token refresh
- local OAuth token storage
- reply-to-lead helper

## Start

Create `.env.local`:

```bash
YELP_CLIENT_ID=your_yelp_client_id
YELP_CLIENT_SECRET=your_yelp_client_secret
YELP_API_KEY=your_yelp_api_key
YELP_INTERNAL_API_SECRET=your_internal_secret
YELP_REDIRECT_URI=http://localhost:3000/api/yelp/oauth/callback
YELP_ALLOWED_BUSINESS_IDS=1T1qXHt8mdTiXkPUpKn21A,ys4FVTHxbSepIkvCLHYxCA
MAIN_PLATFORM_WEBHOOK_URL=https://YOUR_MAIN_APP/api/webhooks/yelp/leads
MAIN_PLATFORM_WEBHOOK_SHARED_SECRET=your_shared_secret
MAIN_PLATFORM_WEBHOOK_TIMEOUT_MS=10000
```

Install and run:

```bash
pnpm install
pnpm dev
```

Useful scripts:

```bash
pnpm typecheck
pnpm build
pnpm start
```

## Quick Tests

Verification:

```bash
curl "http://localhost:3000/api/webhooks/yelp/leads?verification=test123"
```

Webhook POST:

```bash
curl --request POST \
  --url http://localhost:3000/api/webhooks/yelp/leads \
  --header 'content-type: application/json' \
  --data '{
    "time": "2026-03-17T15:00:00+00:00",
    "object": "business",
    "data": {
      "id": "1T1qXHt8mdTiXkPUpKn21A",
      "updates": [
        {
          "event_type": "NEW_EVENT",
          "event_id": "evt_test_001",
          "lead_id": "29HeLueoGE2vvD8tEVJYMQ",
          "interaction_time": "2026-03-17T15:00:00+00:00"
        }
      ]
    }
  }'
```

Expected webhook behavior:

- `GET /api/webhooks/yelp/leads?verification=...` echoes the token as plain text
- `POST /api/webhooks/yelp/leads` validates the Yelp payload and forwards accepted deliveries to `MAIN_PLATFORM_WEBHOOK_URL`
- local filesystem storage is no longer the live webhook ingestion path

OAuth callback route:

```bash
curl "http://localhost:3000/api/yelp/oauth/callback?code=TEST_CODE&state=test123"
```

Protected access-token route:

```bash
curl \
  --header "Authorization: Bearer $YELP_INTERNAL_API_SECRET" \
  http://localhost:3000/api/yelp/token
```

## Docs

Detailed setup, production architecture, storage guidance, and production curl
commands are in `docs/yelp-integration.md`.

Legacy compatibility: `/api/yelp/webhook` remains mounted, but the canonical
public Yelp webhook URL is `/api/webhooks/yelp/leads`.
