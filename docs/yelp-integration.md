# Yelp Leads Integration

## Architecture Overview

This integration adds a minimal Yelp Leads backend to a Next.js App Router app:

- `src/app/api/yelp/webhook/route.ts`: receives Yelp webhook events, supports verification, validates payloads, returns `200` quickly, and schedules lead processing.
- `src/app/api/yelp/oauth/callback/route.ts`: exchanges the Yelp OAuth authorization code for tokens and persists them without exposing secrets.
- `src/lib/yelp/client.ts`: all Yelp HTTP calls using `fetch`.
- `src/lib/yelp/tokens.ts`: token storage, expiry checks, refresh flow, and automatic retry after `401`.
- `src/lib/yelp/processLead.ts`: dedupe, allowed-business validation, lead fetch, normalization, and snapshot persistence.
- `src/lib/yelp/reply.ts`: `replyToLead(leadId, message)` helper for `POST /v3/leads/{lead_id}/events`.
- `src/lib/yelp/storage.ts`: storage abstraction with a local file adapter for development and a clean seam for a production adapter.

Local development stores files in:

- `.data/yelp/tokens.json`
- `.data/yelp/processed-events.json`
- `.data/yelp/leads/{leadId}.json`

## Why This Replaces `webhook.site`

`webhook.site` is useful for manual verification, but it is not an application backend. It cannot safely own OAuth tokens, dedupe events, refresh access tokens, or persist lead state for your app. Yelp webhook traffic needs to land on your production app so the same system that receives events can authorize, fetch lead details, normalize them, and store them durably.

## Environment Variables

Add these to `.env.local` for local development and to your deployment environment for production:

```bash
YELP_CLIENT_ID=your_yelp_client_id
YELP_CLIENT_SECRET=your_yelp_client_secret
YELP_API_KEY=your_yelp_api_key
YELP_REDIRECT_URI=http://localhost:3000/api/yelp/oauth/callback
YELP_ALLOWED_BUSINESS_IDS=1T1qXHt8mdTiXkPUpKn21A,ys4FVTHxbSepIkvCLHYxCA
```

Optional server-side settings:

```bash
YELP_DATA_DIR=.data/yelp
YELP_TOKEN_REFRESH_BUFFER_SECONDS=300
```

`YELP_API_KEY` is not used by the webhook processing code itself. It is still worth setting because it is needed for operational commands such as checking active Yelp webhook subscriptions.

## Local Setup

1. Configure the environment variables above.
2. Install dependencies with `pnpm install`.
3. Run the app locally with `pnpm dev`.
4. Complete the Yelp OAuth authorization flow so Yelp redirects to `/api/yelp/oauth/callback`.
5. Confirm that `.data/yelp/tokens.json` exists after the callback succeeds.
6. Send the local verification and webhook test requests listed below.

The default local adapter is file-based. That is appropriate for development because it makes the token file, processed event log, and lead snapshots visible and easy to inspect.

## Production Setup

Primary recommendation: deploy on Vercel if the rest of the app already runs on Vercel.

Important constraint: durable local file storage is not reliable on serverless platforms. On Vercel, the local filesystem is ephemeral and cannot be treated as a durable source of truth for tokens, processed event IDs, or lead snapshots.

The simplest production path is:

1. Deploy the Next.js app on Vercel.
2. Replace the default file adapter in `src/lib/yelp/storage.ts` with a durable `YelpStorageAdapter`.
3. Store Yelp tokens, processed event IDs, and lead snapshots in PostgreSQL or another durable store.

Recommended production storage shape:

- `yelp_oauth_tokens`: one row for the current Yelp OAuth token set.
- `yelp_processed_events`: unique `event_id` for deduplication and retry-safe replay.
- `yelp_lead_snapshots`: one row per `lead_id`, updated as new events arrive.

PostgreSQL is the cleanest single-store production option because it handles durable token storage, unique constraints on `event_id`, and lead snapshot history in one place. A Redis-compatible store is fine if you already run one, but make sure lead snapshots still land in durable storage and not just volatile cache.

The current code is already structured for that switch. `src/lib/yelp/storage.ts` exposes the `YelpStorageAdapter` interface and `setYelpStorageAdapter(...)`. In production, replace the file-backed default with your PostgreSQL or Redis-backed implementation and keep the rest of the Yelp code unchanged.

## How OAuth Works

1. Yelp redirects the business admin to `/api/yelp/oauth/callback?code=...&state=...`.
2. The callback route exchanges `code` at Yelp’s OAuth token endpoint.
3. The route stores:
   - `accessToken`
   - `refreshToken`
   - `expiresOn`
4. Later requests resolve the stored token through `src/lib/yelp/tokens.ts`.
5. If the token is near expiry, the code refreshes it automatically before the Yelp API call.
6. If Yelp still returns `401`, the code refreshes once and retries the request.

There is no manual terminal token handling after setup. The callback route becomes the entry point for initial token capture, and refresh happens automatically after that.

## How Webhook Processing Works

1. `GET /api/yelp/webhook?verification=abc` returns `{ "verification": "abc" }`.
2. `POST /api/yelp/webhook` parses the Yelp payload and returns `200` quickly.
3. The processor validates `data.id` against `YELP_ALLOWED_BUSINESS_IDS`.
4. Each webhook update is deduplicated by `event_id`.
5. For each new event, the service resolves a valid access token.
6. The service fetches the lead from Yelp.
7. The lead is normalized and stored.
8. The event ID is marked as processed.

Unknown business IDs are ignored rather than retried. Invalid payloads return a safe `400`.

## Exact `curl` Commands

### A. Local webhook verification test

```bash
curl "http://localhost:3000/api/yelp/webhook?verification=test123"
```

### B. Local webhook POST test

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

### C. Local OAuth callback example

```bash
curl "http://localhost:3000/api/yelp/oauth/callback?code=TEST_CODE&state=test123"
```

This proves the route wiring. It will only succeed with a real Yelp authorization code.

### D. Production verification test

```bash
curl "https://YOUR_DOMAIN/api/yelp/webhook?verification=test123"
```

### E. Production webhook POST test

```bash
curl --request POST \
  --url https://YOUR_DOMAIN/api/yelp/webhook \
  --header 'content-type: application/json' \
  --data '{
    "time": "2026-03-17T15:00:00+00:00",
    "object": "business",
    "data": {
      "id": "1T1qXHt8mdTiXkPUpKn21A",
      "updates": [
        {
          "event_type": "NEW_EVENT",
          "event_id": "evt_test_prod_001",
          "lead_id": "29HeLueoGE2vvD8tEVJYMQ",
          "interaction_time": "2026-03-17T15:00:00+00:00"
        }
      ]
    }
  }'
```

### F. Example subscription verification reminder

```bash
curl --request GET \
  --url 'https://api.yelp.com/v3/businesses/subscriptions?subscription_type=WEBHOOK' \
  --header 'Authorization: Bearer ${YELP_API_KEY}' \
  --header 'accept: application/json'
```

## Troubleshooting Notes

- `Missing required Yelp environment variable`: one of the required server env vars is unset.
- `Failed to exchange Yelp OAuth code`: the authorization code is missing, expired, already used, or does not match `YELP_REDIRECT_URI`.
- Repeated duplicate webhooks: expected when Yelp retries delivery. `event_id` dedupe prevents reprocessing.
- Webhooks are accepted but nothing is persisted: confirm the incoming `data.id` is included in `YELP_ALLOWED_BUSINESS_IDS`.
- Local tests work but production loses tokens or processed events: that is the expected failure mode of filesystem storage on serverless. Move to PostgreSQL or another durable adapter.
- Reply failures after long uptime: verify the stored refresh token is valid and that the OAuth app still has the required Yelp scopes.
