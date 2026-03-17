# Yelp Leads Next.js App

Minimal Next.js App Router project for:

- Yelp webhook intake
- Yelp OAuth callback
- secure token persistence
- automatic token refresh
- lead fetch and normalization
- reply-to-lead helper

## Start

Create `.env.local`:

```bash
YELP_CLIENT_ID=your_yelp_client_id
YELP_CLIENT_SECRET=your_yelp_client_secret
YELP_API_KEY=your_yelp_api_key
YELP_REDIRECT_URI=http://localhost:3000/api/yelp/oauth/callback
YELP_ALLOWED_BUSINESS_IDS=1T1qXHt8mdTiXkPUpKn21A,ys4FVTHxbSepIkvCLHYxCA
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
curl "http://localhost:3000/api/yelp/webhook?verification=test123"
```

Webhook POST:

```bash
curl --request POST \
  --url http://localhost:3000/api/yelp/webhook \
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

OAuth callback route:

```bash
curl "http://localhost:3000/api/yelp/oauth/callback?code=TEST_CODE&state=test123"
```

## Docs

Detailed setup, production architecture, storage guidance, and production curl
commands are in `docs/yelp-integration.md`.
