import { getYelpWebhookForwardingConfig } from "./config";
import type { YelpStoredTokens } from "./types";

const TOKEN_SYNC_PATH = "/api/internal/yelp/oauth-token-sync";
const TOKEN_SYNC_USER_AGENT = "irbishvac-yelp-oauth-sync/1.0";
const MAX_ATTEMPTS = 3;

export class YelpTokenSyncError extends Error {
  readonly upstreamStatus: number | null;

  constructor(message: string, upstreamStatus: number | null = null) {
    super(message);
    this.name = "YelpTokenSyncError";
    this.upstreamStatus = upstreamStatus;
  }
}

export interface YelpTokenSyncResult {
  upstreamStatus: number;
}

function resolveTokenSyncUrl(mainPlatformWebhookUrl: string): URL {
  const webhookUrl = new URL(mainPlatformWebhookUrl);
  return new URL(TOKEN_SYNC_PATH, webhookUrl.origin);
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function sleep(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function syncYelpTokensToMainPlatform(
  tokens: YelpStoredTokens,
): Promise<YelpTokenSyncResult> {
  const config = getYelpWebhookForwardingConfig();

  if (!config.mainPlatformWebhookUrl) {
    throw new YelpTokenSyncError(
      "MAIN_PLATFORM_WEBHOOK_URL is not configured for OAuth token sync.",
    );
  }

  if (!config.mainPlatformWebhookSharedSecret) {
    throw new YelpTokenSyncError(
      "MAIN_PLATFORM_WEBHOOK_SHARED_SECRET is not configured for OAuth token sync.",
    );
  }

  let targetUrl: URL;

  try {
    targetUrl = resolveTokenSyncUrl(config.mainPlatformWebhookUrl);
  } catch {
    throw new YelpTokenSyncError(
      "MAIN_PLATFORM_WEBHOOK_URL is invalid for OAuth token sync.",
    );
  }

  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.mainPlatformWebhookTimeoutMs,
    );

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": TOKEN_SYNC_USER_AGENT,
          "x-irbis-forward-secret": config.mainPlatformWebhookSharedSecret,
        },
        body: JSON.stringify({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenType: tokens.tokenType,
          expiresOn: tokens.expiresOn,
          scope: tokens.scope ?? null,
        }),
        cache: "no-store",
        signal: controller.signal,
      });

      lastStatus = response.status;

      if (response.ok) {
        return { upstreamStatus: response.status };
      }

      if (!isRetryableStatus(response.status)) {
        throw new YelpTokenSyncError(
          "Main platform rejected the OAuth token sync.",
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof YelpTokenSyncError) {
        throw error;
      }

      if (attempt === MAX_ATTEMPTS) {
        throw new YelpTokenSyncError(
          error instanceof Error && error.name === "AbortError"
            ? "OAuth token sync timed out."
            : "Failed to reach the main platform OAuth token sync endpoint.",
          lastStatus,
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(250 * attempt);
  }

  throw new YelpTokenSyncError(
    "Main platform OAuth token sync failed after retries.",
    lastStatus,
  );
}
