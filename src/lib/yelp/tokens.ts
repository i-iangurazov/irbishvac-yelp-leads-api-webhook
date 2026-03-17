import { exchangeAuthCode, refreshAccessToken, YelpApiError } from "./client";
import { getYelpConfig } from "./config";
import { createYelpLogger } from "./logger";
import { getYelpStorage } from "./storage";
import type {
  YelpOAuthTokenResponse,
  YelpStorageAdapter,
  YelpStoredTokens,
} from "./types";

const logger = createYelpLogger({
  module: "tokens",
});

let inFlightRefresh: Promise<YelpStoredTokens> | null = null;

function buildStoredTokens(
  tokenResponse: YelpOAuthTokenResponse,
  previousTokens: YelpStoredTokens | null,
): YelpStoredTokens {
  const now = new Date();
  const refreshToken =
    tokenResponse.refresh_token ?? previousTokens?.refreshToken ?? "";

  if (!refreshToken) {
    throw new Error(
      "Yelp token response did not include a refresh token and no stored refresh token exists.",
    );
  }

  if (
    !Number.isFinite(tokenResponse.expires_in) ||
    tokenResponse.expires_in <= 0
  ) {
    throw new Error("Yelp token response included an invalid expires_in value.");
  }

  return {
    accessToken: tokenResponse.access_token,
    refreshToken,
    tokenType: tokenResponse.token_type || previousTokens?.tokenType || "Bearer",
    expiresOn: new Date(
      now.getTime() + tokenResponse.expires_in * 1000,
    ).toISOString(),
    scope: tokenResponse.scope ?? previousTokens?.scope,
    createdAt: previousTokens?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function tokenNeedsRefresh(tokens: YelpStoredTokens): boolean {
  const expiresAt = Date.parse(tokens.expiresOn);

  return (
    Number.isNaN(expiresAt) ||
    expiresAt <= Date.now() + getYelpConfig().accessTokenRefreshBufferMs
  );
}

async function refreshStoredTokens(
  storage: YelpStorageAdapter,
  currentTokens?: YelpStoredTokens | null,
): Promise<YelpStoredTokens> {
  const existingTokens = currentTokens ?? (await storage.getTokens());

  if (!existingTokens) {
    throw new Error(
      "Yelp OAuth tokens are not stored yet. Complete the Yelp OAuth callback first.",
    );
  }

  const response = await refreshAccessToken(existingTokens.refreshToken);
  const nextTokens = buildStoredTokens(response, existingTokens);

  await storage.saveTokens(nextTokens);

  logger.info("tokens.refreshed", {
    expiresOn: nextTokens.expiresOn,
  });

  return nextTokens;
}

async function runSharedRefresh(
  storage: YelpStorageAdapter,
  currentTokens?: YelpStoredTokens | null,
): Promise<YelpStoredTokens> {
  if (!inFlightRefresh) {
    inFlightRefresh = refreshStoredTokens(storage, currentTokens).finally(() => {
      inFlightRefresh = null;
    });
  }

  return inFlightRefresh;
}

export async function exchangeAndStoreAuthCode(
  code: string,
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<YelpStoredTokens> {
  const previousTokens = await storage.getTokens();
  const response = await exchangeAuthCode(code);
  const nextTokens = buildStoredTokens(response, previousTokens);

  await storage.saveTokens(nextTokens);

  logger.info("tokens.exchanged", {
    expiresOn: nextTokens.expiresOn,
  });

  return nextTokens;
}

export async function resolveYelpTokens(
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<YelpStoredTokens> {
  const storedTokens = await storage.getTokens();

  if (!storedTokens) {
    throw new Error(
      "Yelp OAuth tokens are not stored yet. Complete the Yelp OAuth callback first.",
    );
  }

  if (!tokenNeedsRefresh(storedTokens)) {
    return storedTokens;
  }

  return runSharedRefresh(storage, storedTokens);
}

export async function forceRefreshYelpTokens(
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<YelpStoredTokens> {
  return runSharedRefresh(storage, await storage.getTokens());
}

export async function getValidYelpAccessToken(
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<string> {
  const tokens = await resolveYelpTokens(storage);
  return tokens.accessToken;
}

export async function withYelpAccessToken<T>(
  operation: (accessToken: string) => Promise<T>,
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<T> {
  const accessToken = await getValidYelpAccessToken(storage);

  try {
    return await operation(accessToken);
  } catch (error) {
    if (error instanceof YelpApiError && error.status === 401) {
      logger.warn("tokens.retry_after_unauthorized", {
        operation: error.operation,
      });

      const refreshedTokens = await forceRefreshYelpTokens(storage);
      return operation(refreshedTokens.accessToken);
    }

    throw error;
  }
}
