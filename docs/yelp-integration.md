# Yelp Leads Integration

## Architecture Overview

This project is a minimal Next.js App Router backend for Yelp Leads:

- `src/app/api/webhooks/yelp/leads/route.ts`: canonical Yelp webhook verification and forwarding endpoint.
- `src/app/api/yelp/webhook/route.ts`: compatibility alias that mounts the same webhook handler as the canonical route.
- `src/app/api/yelp/oauth/callback/route.ts`: OAuth authorization-code callback and token persistence.
- `src/lib/yelp/forwardWebhook.ts`: forwarding client for the main platform webhook endpoint.
- `src/lib/yelp/tokens.ts`: OAuth access-token resolution, refresh flow, and retry on `401`.
- `src/lib/yelp/storage.ts`: file-based adapter that still backs local OAuth token storage and helper workflows.

Local development stores files in:

- `.data/yelp/tokens.json`
- `.data/yelp/processed-events.json`
- `.data/yelp/leads/{leadId}.json`

Temporary serverless fallback writes to:

- `/tmp/.data/yelp/tokens.json`
- `/tmp/.data/yelp/processed-events.json`
- `/tmp/.data/yelp/leads/{leadId}.json`

That `/tmp` fallback is no longer the live webhook ingestion path. It is only a stopgap for OAuth/helper storage on Vercel/serverless.

## Why This Replaces `webhook.site`

`webhook.site` is fine for manual inspection, but it is not an application backend. Yelp webhook traffic needs to land on your controlled app surface so you can verify setup, allowlist businesses, and forward accepted deliveries into the main platform that owns `YelpWebhookEvent`, `SyncRun`, and autoresponder processing.

## Live IRBIS Businesses

These are the live IRBIS businesses that should be accepted in production:

- `1T1qXHt8mdTiXkPUpKn21A` -> `IRBIS San Jose`
- `ys4FVTHxbSepIkvCLHYxCA` -> `IRBIS Redwood City`

Set production `YELP_ALLOWED_BUSINESS_IDS` to exactly:

```bash
YELP_ALLOWED_BUSINESS_IDS=1T1qXHt8mdTiXkPUpKn21A,ys4FVTHxbSepIkvCLHYxCA
```

## Environment Variables

Required for the public webhook route:

```bash
YELP_ALLOWED_BUSINESS_IDS=1T1qXHt8mdTiXkPUpKn21A,ys4FVTHxbSepIkvCLHYxCA
MAIN_PLATFORM_WEBHOOK_URL=https://YOUR_MAIN_APP/api/webhooks/yelp/leads
```

Optional for forwarded webhook auth and timeout:

```bash
MAIN_PLATFORM_WEBHOOK_SHARED_SECRET=your_shared_secret
MAIN_PLATFORM_WEBHOOK_TIMEOUT_MS=10000
```

Required for OAuth callback and internal token retrieval:

```bash
YELP_CLIENT_ID=your_yelp_client_id
YELP_CLIENT_SECRET=your_yelp_client_secret
YELP_REDIRECT_URI=http://localhost:3000/api/yelp/oauth/callback
YELP_INTERNAL_API_SECRET=your_internal_secret
```

Optional for OAuth/helper workflows:

```bash
YELP_API_KEY=your_yelp_api_key
YELP_DATA_DIR=.data/yelp
YELP_TOKEN_REFRESH_BUFFER_SECONDS=300
```

`MAIN_PLATFORM_WEBHOOK_SHARED_SECRET` is sent as the `x-irbis-forward-secret` header when configured.
The current main platform route does not enforce that header yet, so forwarding works without it. Add validation on the main platform when you want to lock the route down.
`YELP_API_KEY` is not used by forwarding itself, but it is useful for operational subscription checks.
`YELP_INTERNAL_API_SECRET` protects the token retrieval endpoint and should be a long random secret.

## Local Setup

1. Configure the environment variables above.
2. Install dependencies with `pnpm install`.
3. Run the app locally with `pnpm dev`.
4. Complete the Yelp OAuth authorization flow so Yelp redirects to `/api/yelp/oauth/callback`.
5. Confirm that `.data/yelp/tokens.json` exists after the callback succeeds.
6. Run the curl checks below.

## Production Setup

Primary recommendation: deploy on Vercel if the rest of the app already runs on Vercel.

Important constraint: local filesystem storage is not durable on serverless. This app should not use `/tmp` as the live webhook integration path.

The intended production path is:

1. Deploy the app on Vercel.
2. Point Yelp at `https://YOUR_WEBHOOK_APP/api/webhooks/yelp/leads`.
3. Set `MAIN_PLATFORM_WEBHOOK_URL` to the main platform route, for example `https://YOUR_MAIN_APP/api/webhooks/yelp/leads`.
4. Let the main platform persist `YelpWebhookEvent`, `SyncRun`, and downstream lead records.
5. Treat this repo’s local storage only as support for OAuth/helper flows, not as the production lead sink.

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

## Access Token Retrieval

If another internal system needs the current Yelp access token, call the
protected route below with your internal secret:

```bash
curl \
  --header "Authorization: Bearer ${YELP_INTERNAL_API_SECRET}" \
  http://localhost:3000/api/yelp/token
```

Successful responses include:

- `accessToken`
- `tokenType`
- `expiresOn`
- `scope`

This route does not return the refresh token.

If the OAuth exchange returns `404 NOT_FOUND`, the token endpoint URL is wrong. Yelp token exchange and token refresh must both use:

```text
https://api.yelp.com/oauth2/token
```

## Webhook Verification and Health

- `GET /api/webhooks/yelp/leads?verification=abc` returns the verification token as plain text.

```text
abc
```

- `GET /api/webhooks/yelp/leads` returns:

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
6. Accepted payloads are forwarded to `MAIN_PLATFORM_WEBHOOK_URL`.
7. The forwarding request preserves useful delivery headers such as `x-yelp-delivery-id`, `x-request-id`, and `x-correlation-id`.
8. The main platform route is responsible for creating `YelpWebhookEvent`, `SyncRun`, and the later Yelp lead refresh workflow.

Malformed payloads return `400`. Business allowlist rejections return `403`. Missing forward config returns `503`. Upstream forwarding failures return `502` or `504` with a concise operational error.

## Business Identification

Every valid POST is tagged in logs and responses with:

- `businessId`
- `businessName`

That makes it obvious whether the webhook came from:

- `IRBIS San Jose`
- `IRBIS Redwood City`

## POST Response Meaning

Successful forwarding returns a body like:

```json
{
  "ok": true,
  "forwarded": true,
  "businessId": "1T1qXHt8mdTiXkPUpKn21A",
  "businessName": "IRBIS San Jose",
  "updateCount": 1,
  "upstreamStatus": 202
}
```

Forwarding failure returns a body like:

```json
{
  "ok": false,
  "forwarded": false,
  "businessId": "1T1qXHt8mdTiXkPUpKn21A",
  "businessName": "IRBIS San Jose",
  "updateCount": 1,
  "upstreamStatus": 500,
  "error": "Main platform webhook endpoint rejected the forward."
}
```

The main platform is the place that should report duplicate-safe `SyncRun` / `YelpWebhookEvent` state after the forward succeeds.

## Expected Log Events

The webhook path emits structured events such as:

- `webhook.request_received`
- `webhook.validation_failed`
- `webhook.business_rejected`
- `webhook.forward_succeeded`
- `webhook.forward_failed`

## Exact `curl` Commands

### A. Local webhook verification test

```bash
curl "http://localhost:3000/api/webhooks/yelp/leads?verification=test123"
```

### B. Local webhook POST test

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

### C. Local OAuth callback example

```bash
curl "http://localhost:3000/api/yelp/oauth/callback?code=TEST_CODE&state=test123"
```

This proves the route wiring. It will only succeed with a real Yelp authorization code.

### D. Production verification test

```bash
curl "https://YOUR_DOMAIN/api/webhooks/yelp/leads?verification=test123"
```

### E. Production webhook POST test

```bash
curl --request POST \
  --url https://YOUR_DOMAIN/api/webhooks/yelp/leads \
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

Expected result:

- webhook app returns `202` if the main platform accepted the forward
- main platform stores the raw delivery and queues its own lead refresh workflow

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
- `503` from the webhook route: `MAIN_PLATFORM_WEBHOOK_URL` is missing or invalid.
- `403` from the webhook route: the incoming `data.id` is not one of the accepted IRBIS business IDs.
- `502` or `504` from the webhook route: forwarding to the main platform failed or timed out. Inspect `webhook.forward_failed` logs and the main platform deployment health.
- Local tests work but production does not create `YelpWebhookEvent` / `SyncRun`: verify `MAIN_PLATFORM_WEBHOOK_URL` points at the real main app route and that the main app deployment is healthy.
- Local tests work but production loses OAuth tokens: the current file adapter is still not durable storage. Move OAuth/helper storage to PostgreSQL or another durable adapter if this app must retain tokens long-term.
- Reply failures after long uptime: verify the stored refresh token is valid and that the OAuth app still has the required Yelp scopes.
