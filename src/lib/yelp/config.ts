import path from "path";

const DEFAULT_DATA_DIR = ".data/yelp";
const DEFAULT_REFRESH_BUFFER_SECONDS = 300;

export interface YelpConfig {
  clientId: string;
  clientSecret: string;
  apiKey: string | null;
  redirectUri: string;
  allowedBusinessIds: ReadonlySet<string>;
  allowedBusinessIdList: string[];
  apiBaseUrl: string;
  oauthTokenUrl: string;
  dataDir: string;
  accessTokenRefreshBufferMs: number;
}

let cachedConfig: YelpConfig | null = null;

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

function resolveDataDir(dataDir: string): string {
  return path.isAbsolute(dataDir)
    ? dataDir
    : path.join(process.cwd(), dataDir);
}

export function getYelpConfig(): YelpConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const allowedBusinessIdList = parseAllowedBusinessIds(
    readRequiredEnv("YELP_ALLOWED_BUSINESS_IDS"),
  );

  cachedConfig = {
    clientId: readRequiredEnv("YELP_CLIENT_ID"),
    clientSecret: readRequiredEnv("YELP_CLIENT_SECRET"),
    apiKey: readOptionalEnv("YELP_API_KEY"),
    redirectUri: readRequiredEnv("YELP_REDIRECT_URI"),
    allowedBusinessIds: new Set(allowedBusinessIdList),
    allowedBusinessIdList,
    apiBaseUrl: "https://api.yelp.com",
    oauthTokenUrl: "https://api.yelp.com/oauth2/tokens",
    dataDir: resolveDataDir(readOptionalEnv("YELP_DATA_DIR") ?? DEFAULT_DATA_DIR),
    accessTokenRefreshBufferMs: parseRefreshBufferMs(
      readOptionalEnv("YELP_TOKEN_REFRESH_BUFFER_SECONDS"),
    ),
  };

  return cachedConfig;
}

export function isAllowedBusinessId(businessId: string): boolean {
  return getYelpConfig().allowedBusinessIds.has(businessId);
}
