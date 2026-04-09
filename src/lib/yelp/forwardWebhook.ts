import {
  getYelpWebhookForwardingConfig,
  getYelpBusinessMetadata,
} from "./config";
import type { YelpWebhookPayload } from "./types";

const FORWARDER_USER_AGENT = "irbishvac-yelp-webhook-forwarder/1.0";
const FORWARD_SECRET_HEADER = "x-irbis-forward-secret";

function trimHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function getRequestHeader(headers: Headers, name: string): string | null {
  return trimHeaderValue(headers.get(name));
}

function buildForwardHeaders(
  inboundHeaders: Headers,
  sharedSecret: string | null,
): Headers {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": FORWARDER_USER_AGENT,
    "x-irbis-forwarded-by": "irbishvac-yelp-webhook",
    "x-irbis-forwarded-topic": "yelp-leads",
  });

  for (const name of [
    "x-yelp-delivery-id",
    "x-request-id",
    "x-correlation-id",
    "x-vercel-id",
  ]) {
    const value = getRequestHeader(inboundHeaders, name);

    if (value) {
      headers.set(name, value);
    }
  }

  const originalUserAgent = getRequestHeader(inboundHeaders, "user-agent");

  if (originalUserAgent) {
    headers.set("x-original-user-agent", originalUserAgent);
  }

  if (sharedSecret) {
    headers.set(FORWARD_SECRET_HEADER, sharedSecret);
  }

  return headers;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await response.text();
    return text || null;
  } catch {
    return null;
  }
}

export class YelpWebhookForwardError extends Error {
  readonly status: number;
  readonly upstreamStatus: number | null;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      status: number;
      upstreamStatus?: number | null;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "YelpWebhookForwardError";
    this.status = options.status;
    this.upstreamStatus = options.upstreamStatus ?? null;
    this.details = options.details;
  }
}

export interface YelpWebhookForwardResult {
  businessId: string;
  businessName: string;
  updateCount: number;
  upstreamStatus: number;
}

export async function forwardYelpWebhookToMainPlatform(options: {
  payload: YelpWebhookPayload;
  inboundHeaders: Headers;
}): Promise<YelpWebhookForwardResult> {
  const config = getYelpWebhookForwardingConfig();

  if (!config.mainPlatformWebhookUrl) {
    throw new YelpWebhookForwardError(
      "MAIN_PLATFORM_WEBHOOK_URL is not configured.",
      {
        status: 503,
      },
    );
  }

  let targetUrl: URL;

  try {
    targetUrl = new URL(config.mainPlatformWebhookUrl);
  } catch (error) {
    throw new YelpWebhookForwardError(
      "MAIN_PLATFORM_WEBHOOK_URL is invalid.",
      {
        status: 503,
        details: {
          error,
        },
      },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.mainPlatformWebhookTimeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: buildForwardHeaders(
        options.inboundHeaders,
        config.mainPlatformWebhookSharedSecret,
      ),
      body: JSON.stringify(options.payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const upstreamBody = await readResponseBody(response);

    if (!response.ok) {
      throw new YelpWebhookForwardError(
        "Main platform webhook endpoint rejected the forward.",
        {
          status: 502,
          upstreamStatus: response.status,
          details: {
            upstreamBody,
          },
        },
      );
    }

    const business = getYelpBusinessMetadata(options.payload.data.id);

    return {
      businessId: business.businessId,
      businessName: business.businessName,
      updateCount: options.payload.data.updates.length,
      upstreamStatus: response.status,
    };
  } catch (error) {
    if (error instanceof YelpWebhookForwardError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new YelpWebhookForwardError(
        "Forwarding to the main platform timed out.",
        {
          status: 504,
        },
      );
    }

    throw new YelpWebhookForwardError(
      "Failed to reach the main platform webhook endpoint.",
      {
        status: 502,
        details: {
          error,
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}
