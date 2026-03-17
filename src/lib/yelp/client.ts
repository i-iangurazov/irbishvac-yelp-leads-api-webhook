import { getYelpConfig } from "./config";
import { createYelpLogger } from "./logger";
import type {
  YelpLead,
  YelpLeadReplyRequest,
  YelpLeadReplyResponse,
  YelpOAuthTokenResponse,
} from "./types";

const logger = createYelpLogger({
  module: "client",
});

const REQUEST_TIMEOUT_MS = 15_000;

export class YelpApiError extends Error {
  readonly status: number;
  readonly operation: string;
  readonly responseBody: string | null;

  constructor(
    message: string,
    options: {
      status: number;
      operation: string;
      responseBody: string | null;
    },
  ) {
    super(message);
    this.name = "YelpApiError";
    this.status = options.status;
    this.operation = options.operation;
    this.responseBody = options.responseBody;
  }
}

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    logger.warn("http.request_failed", {
      operation,
      status: response.status,
    });

    throw new YelpApiError(
      `Yelp ${operation} failed with status ${response.status}.`,
      {
        status: response.status,
        operation,
        responseBody: text || null,
      },
    );
  }

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `Yelp ${operation} returned a non-JSON response: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
    );
  }
}

function parseJsonText<T>(text: string, operation: string): T {
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `Yelp ${operation} returned a non-JSON response: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
    );
  }
}

function parseResponseBodyForLog(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
}

function buildBearerHeaders(
  accessToken: string,
  contentType?: string,
): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${accessToken}`,
  };

  if (contentType) {
    headers["content-type"] = contentType;
  }

  return headers;
}

async function postTokenRequest(
  operation: string,
  body: URLSearchParams,
): Promise<YelpOAuthTokenResponse> {
  const config = getYelpConfig();
  const tokenEndpointUrl = config.oauthTokenUrl;

  logger.info("oauth.token_endpoint_request", {
    operation,
    tokenEndpointUrl,
  });

  const response = await fetchWithTimeout(tokenEndpointUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  const responseBody = parseResponseBodyForLog(text);

  logger.info("oauth.token_endpoint_response", {
    operation,
    tokenEndpointUrl,
    status: response.status,
    responseBody,
  });

  if (!response.ok) {
    throw new YelpApiError(
      `Yelp ${operation} failed with status ${response.status}.`,
      {
        status: response.status,
        operation,
        responseBody: text || null,
      },
    );
  }

  return parseJsonText<YelpOAuthTokenResponse>(text, operation);
}

export async function exchangeAuthCode(
  code: string,
): Promise<YelpOAuthTokenResponse> {
  const config = getYelpConfig();

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: assertNonEmpty(code, "OAuth code"),
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  return postTokenRequest("exchange_auth_code", body);
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<YelpOAuthTokenResponse> {
  const config = getYelpConfig();

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: assertNonEmpty(refreshToken, "Refresh token"),
    grant_type: "refresh_token",
  });

  return postTokenRequest("refresh_access_token", body);
}

export async function getLeadById(
  leadId: string,
  accessToken: string,
): Promise<YelpLead> {
  const config = getYelpConfig();

  const response = await fetchWithTimeout(
    `${config.apiBaseUrl}/v3/leads/${encodeURIComponent(
      assertNonEmpty(leadId, "Lead ID"),
    )}`,
    {
      method: "GET",
      headers: buildBearerHeaders(assertNonEmpty(accessToken, "Access token")),
    },
  );

  return parseJsonResponse<YelpLead>(response, "get_lead_by_id");
}

export async function sendLeadReply(
  leadId: string,
  message: string,
  accessToken: string,
): Promise<YelpLeadReplyResponse> {
  const config = getYelpConfig();

  const payload: YelpLeadReplyRequest = {
    request_content: assertNonEmpty(message, "Reply message"),
    request_type: "TEXT",
  };

  const response = await fetchWithTimeout(
    `${config.apiBaseUrl}/v3/leads/${encodeURIComponent(
      assertNonEmpty(leadId, "Lead ID"),
    )}/events`,
    {
      method: "POST",
      headers: buildBearerHeaders(
        assertNonEmpty(accessToken, "Access token"),
        "application/json",
      ),
      body: JSON.stringify(payload),
    },
  );

  return parseJsonResponse<YelpLeadReplyResponse>(
    response,
    "send_lead_reply",
  );
}
