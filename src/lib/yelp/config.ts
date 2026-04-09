import path from "path";

import type { YelpBusinessMetadata } from "./types";

const DEFAULT_DATA_DIR = ".data/yelp";
const DEFAULT_PRODUCTION_DATA_DIR = "/tmp/.data/yelp";
const DEFAULT_REFRESH_BUFFER_SECONDS = 300;
const DEFAULT_MAIN_PLATFORM_WEBHOOK_TIMEOUT_MS = 10000;
const YELP_BUSINESS_NAME_BY_ID = {
  "1T1qXHt8mdTiXkPUpKn21A": "IRBIS San Jose",
  ys4FVTHxbSepIkvCLHYxCA: "IRBIS Redwood City",
} as const;

export interface YelpConfig {
  clientId: string;
  clientSecret: string;
  apiKey: string | null;
  internalApiSecret: string | null;
  redirectUri: string;
  allowedBusinessIds: ReadonlySet<string>;
  allowedBusinessIdList: string[];
  apiBaseUrl: string;
  oauthTokenUrl: string;
  dataDir: string;
  accessTokenRefreshBufferMs: number;
}

export interface YelpWebhookForwardingConfig {
  allowedBusinessIds: ReadonlySet<string>;
  allowedBusinessIdList: string[];
  mainPlatformWebhookUrl: string | null;
  mainPlatformWebhookSharedSecret: string | null;
  mainPlatformWebhookTimeoutMs: number;
}

let cachedConfig: YelpConfig | null = null;
let cachedAllowedBusinessIdList: string[] | null = null;
let cachedWebhookForwardingConfig: YelpWebhookForwardingConfig | null = null;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required Yelp environment variable: ${name}`);
  }

  return value;
}

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseAllowedBusinessIds(value: string): string[] {
  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    throw new Error(
      "YELP_ALLOWED_BUSINESS_IDS must include at least one business ID.",
    );
  }

  return ids;
}

function getAllowedBusinessIdList(): string[] {
  if (cachedAllowedBusinessIdList) {
    return cachedAllowedBusinessIdList;
  }

  cachedAllowedBusinessIdList = parseAllowedBusinessIds(
    readRequiredEnv("YELP_ALLOWED_BUSINESS_IDS"),
  );

  return cachedAllowedBusinessIdList;
}

function parseRefreshBufferMs(value: string | null): number {
  if (!value) {
    return DEFAULT_REFRESH_BUFFER_SECONDS * 1000;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      "YELP_TOKEN_REFRESH_BUFFER_SECONDS must be a non-negative integer.",
    );
  }

  return parsed * 1000;
}

function parseTimeoutMs(value: string | null): number {
  if (!value) {
    return DEFAULT_MAIN_PLATFORM_WEBHOOK_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      "MAIN_PLATFORM_WEBHOOK_TIMEOUT_MS must be a positive integer.",
    );
  }

  return parsed;
}

function resolveDataDir(dataDir: string): string {
  if (path.isAbsolute(dataDir)) {
    return dataDir;
  }

  return process.env.NODE_ENV === "production"
    ? path.join("/tmp", dataDir)
    : path.join(process.cwd(), dataDir);
}

export function getDefaultYelpDataDir(): string {
  return process.env.NODE_ENV === "production"
    ? DEFAULT_PRODUCTION_DATA_DIR
    : path.join(process.cwd(), DEFAULT_DATA_DIR);
}

export function resolveYelpDataDir(dataDir: string | null): string {
  if (!dataDir) {
    return getDefaultYelpDataDir();
  }

  return resolveDataDir(dataDir);
}

export function getYelpConfig(): YelpConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const allowedBusinessIdList = getAllowedBusinessIdList();

  cachedConfig = {
    clientId: readRequiredEnv("YELP_CLIENT_ID"),
    clientSecret: readRequiredEnv("YELP_CLIENT_SECRET"),
    apiKey: readOptionalEnv("YELP_API_KEY"),
    internalApiSecret: readOptionalEnv("YELP_INTERNAL_API_SECRET"),
    redirectUri: readRequiredEnv("YELP_REDIRECT_URI"),
    allowedBusinessIds: new Set(allowedBusinessIdList),
    allowedBusinessIdList,
    apiBaseUrl: "https://api.yelp.com",
    oauthTokenUrl: "https://api.yelp.com/oauth2/token",
    dataDir: resolveYelpDataDir(readOptionalEnv("YELP_DATA_DIR")),
    accessTokenRefreshBufferMs: parseRefreshBufferMs(
      readOptionalEnv("YELP_TOKEN_REFRESH_BUFFER_SECONDS"),
    ),
  };

  return cachedConfig;
}

export function getYelpWebhookForwardingConfig(): YelpWebhookForwardingConfig {
  if (cachedWebhookForwardingConfig) {
    return cachedWebhookForwardingConfig;
  }

  const allowedBusinessIdList = getAllowedBusinessIdList();

  cachedWebhookForwardingConfig = {
    allowedBusinessIds: new Set(allowedBusinessIdList),
    allowedBusinessIdList,
    mainPlatformWebhookUrl: readOptionalEnv("MAIN_PLATFORM_WEBHOOK_URL"),
    mainPlatformWebhookSharedSecret: readOptionalEnv(
      "MAIN_PLATFORM_WEBHOOK_SHARED_SECRET",
    ),
    mainPlatformWebhookTimeoutMs: parseTimeoutMs(
      readOptionalEnv("MAIN_PLATFORM_WEBHOOK_TIMEOUT_MS"),
    ),
  };

  return cachedWebhookForwardingConfig;
}

export function isAllowedBusinessId(businessId: string): boolean {
  return getAllowedBusinessIdList().includes(businessId);
}

export function getYelpBusinessName(businessId: string): string {
  return YELP_BUSINESS_NAME_BY_ID[
    businessId as keyof typeof YELP_BUSINESS_NAME_BY_ID
  ] ?? "Unknown Yelp business";
}

export function getYelpBusinessMetadata(
  businessId: string,
): YelpBusinessMetadata {
  return {
    businessId,
    businessName: getYelpBusinessName(businessId),
  };
}

export function getKnownYelpBusinesses(): YelpBusinessMetadata[] {
  return Object.entries(YELP_BUSINESS_NAME_BY_ID).map(
    ([businessId, businessName]) => ({
      businessId,
      businessName,
    }),
  );
}
