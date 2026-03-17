# Yelp Leads Integration

## Architecture Overview

This project is a minimal Next.js App Router backend for Yelp Leads:

- `src/app/api/yelp/webhook/route.ts`: Yelp webhook verification, health response, payload validation, business rejection, and honest request summaries.
- `src/app/api/yelp/oauth/callback/route.ts`: OAuth authorization-code callback and token persistence.
- `src/lib/yelp/client.ts`: all Yelp HTTP calls using `fetch`.
- `src/lib/yelp/tokens.ts`: access-token resolution, refresh flow, and retry on `401`.
- `src/lib/yelp/processLead.ts`: per-update orchestration, dedupe, lead fetch, normalization, persistence, counters, and structured error aggregation.
- `src/lib/yelp/storage.ts`: file-based dev adapter plus the adapter seam for real durable production storage.

Local development stores files in:

- `.data/yelp/tokens.json`
- `.data/yelp/processed-events.json`
- `.data/yelp/leads/{leadId}.json`

Temporary serverless fallback writes to:

- `/tmp/.data/yelp/tokens.json`
- `/tmp/.data/yelp/processed-events.json`
- `/tmp/.data/yelp/leads/{leadId}.json`

That `/tmp` fallback is only a stopgap for Vercel/serverless. Durable storage is still required for real production.

## Why This Replaces `webhook.site`

`webhook.site` is fine for manual inspection, but it is not an application backend. It cannot own OAuth tokens safely, dedupe events, normalize leads, or persist webhook processing state for your app. Yelp webhook traffic needs to land on your app so the same system can authorize, fetch, process, and store leads.

## Live IRBIS Businesses

These are the live IRBIS businesses that should be accepted in production:

- `1T1qXHt8mdTiXkPUpKn21A` -> `IRBIS San Jose`
- `ys4FVTHxbSepIkvCLHYxCA` -> `IRBIS Redwood City`

Set production `YELP_ALLOWED_BUSINESS_IDS` to exactly:

```bash
YELP_ALLOWED_BUSINESS_IDS=1T1qXHt8mdTiXkPUpKn21A,ys4FVTHxbSepIkvCLHYxCA
```

## Environment Variables

Required:

```bash
YELP_CLIENT_ID=your_yelp_client_id
YELP_CLIENT_SECRET=your_yelp_client_secret
YELP_API_KEY=your_yelp_api_key
YELP_REDIRECT_URI=http://localhost:3000/api/yelp/oauth/callback
YELP_ALLOWED_BUSINESS_IDS=1T1qXHt8mdTiXkPUpKn21A,ys4FVTHxbSepIkvCLHYxCA
```

Optional:

```bash
YELP_DATA_DIR=.data/yelp
YELP_TOKEN_REFRESH_BUFFER_SECONDS=300
```

`YELP_API_KEY` is not used by webhook processing itself, but it is useful for operational subscription checks.

## Local Setup

1. Configure the environment variables above.
2. Install dependencies with `pnpm install`.
3. Run the app locally with `pnpm dev`.
4. Complete the Yelp OAuth authorization flow so Yelp redirects to `/api/yelp/oauth/callback`.
5. Confirm that `.data/yelp/tokens.json` exists after the callback succeeds.
6. Run the curl checks below.

## Production Setup

Primary recommendation: deploy on Vercel if the rest of the app already runs on Vercel.

Important constraint: local filesystem storage is not durable on serverless. The current file adapter can use `/tmp/.data/yelp` as a temporary write location, but `/tmp` is ephemeral and not a real production datastore.

The simplest durable production path is:

1. Deploy the app on Vercel.
2. Replace the default file adapter in `src/lib/yelp/storage.ts` with a durable `YelpStorageAdapter`.
3. Store Yelp tokens, processed event IDs, and lead snapshots in PostgreSQL or another durable store.

Recommended production storage shape:

- `yelp_oauth_tokens`: one row for the current Yelp OAuth token set
- `yelp_processed_events`: unique `event_id`
- `yelp_lead_snapshots`: one row per `lead_id`

## How OAuth Works

1. Yelp redirects the business admin to `/api/yelp/oauth/callback?code=...&state=...`.
2. The callback route exchanges `code` at `https://api.yelp.com/oauth2/token`.
3. The route stores:
   - `accessToken`
   - `refreshToken`
   - `expiresOn`
4. Later requests resolve the stored token through `src/lib/yelp/tokens.ts`.
5. If the token is near expiry, it is refreshed automatically.
6. If Yelp still returns `401`, the request is retried once after refresh.

If the OAuth exchange returns `404 NOT_FOUND`, the token endpoint URL is wrong. Yelp token exchange and token refresh must both use:

```text
https://api.yelp.com/oauth2/token
```

## Webhook Verification and Health

- `GET /api/yelp/webhook?verification=abc` returns:

```json
{ "verification": "abc" }
```

- `GET /api/yelp/webhook` returns:

```json
{ "ok": true, "message": "Yelp webhook endpoint is live" }
```

## How Webhook Processing Works

1. The route validates the payload shape.
2. The route requires `payload.object === "business"`.
3. The route requires `data.id` and `data.updates`.
4. Every update must include:
   - `event_id`
   - `lead_id`
   - `event_type`
   - `interaction_time`
5. Unsupported business IDs are rejected with `403`.
6. Duplicate `event_id` values are skipped explicitly and counted.
7. Non-duplicate events fetch a valid access token.
8. The service fetches the Yelp lead by `lead_id`.
9. The lead is normalized and persisted.
10. The processed `event_id` is stored for deduplication.

Malformed payloads return `400`. Processing failures return `500` with a sanitized, structured summary.

## Business Identification

Every valid POST is tagged in logs and responses with:

- `businessId`
- `businessName`

That makes it obvious whether the webhook came from:

- `IRBIS San Jose`
- `IRBIS Redwood City`

## POST Response Meaning

Successful or duplicate-only processing returns a body like:

```json
{
  "ok": true,
  "businessId": "1T1qXHt8mdTiXkPUpKn21A",
  "businessName": "IRBIS San Jose",
  "processed": 1,
  "skippedDuplicates": 0,
  "failed": 0
}
```

Partial or full processing failure returns a body like:

```json
{
  "ok": false,
  "businessId": "1T1qXHt8mdTiXkPUpKn21A",
  "businessName": "IRBIS San Jose",
  "processed": 0,
  "skippedDuplicates": 0,
  "failed": 1,
  "errors": [
    {
      "eventId": "evt_test_001",
      "leadId": "29HeLueoGE2vvD8tEVJYMQ",
      "eventType": "NEW_EVENT",
      "interactionTime": "2026-03-17T15:00:00+00:00",
      "stage": "lead_fetch",
      "message": "Failed to fetch Yelp lead details."
    }
  ]
}
```

Meaning of the counters:

- `processed`: successfully fetched and persisted lead updates
- `skippedDuplicates`: duplicate or already-in-flight `event_id` values
- `failed`: updates that could not complete safely

## Expected Log Events

The webhook path emits structured events such as:

- `webhook.request_received`
- `webhook.validation_failed`
- `webhook.business_rejected`
- `webhook.update_processing_started`
- `webhook.update_duplicate_skipped`
- `webhook.lead_fetch_succeeded`
- `webhook.lead_fetch_failed`
- `webhook.persistence_succeeded`
- `webhook.persistence_failed`
- `webhook.request_completed`

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
- `404 NOT_FOUND` from the Yelp token exchange: the token endpoint URL is wrong. It must be `https://api.yelp.com/oauth2/token`.
- Repeated duplicate webhooks: expected when Yelp retries delivery. `event_id` dedupe prevents reprocessing.
- `403` from the webhook route: the incoming `data.id` is not one of the accepted IRBIS business IDs.
- `500` with webhook errors: at least one update failed lead fetch or persistence. Inspect structured log events for the failing stage.
- Local tests work but production loses tokens or processed events: the current file adapter is still not durable storage. Move to PostgreSQL or another durable adapter.
- Reply failures after long uptime: verify the stored refresh token is valid and that the OAuth app still has the required Yelp scopes.
