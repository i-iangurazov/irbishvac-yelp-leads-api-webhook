import { NextResponse } from "next/server";

import {
  getYelpBusinessMetadata,
  isAllowedBusinessId,
} from "./config";
import {
  forwardYelpWebhookToMainPlatform,
  YelpWebhookForwardError,
} from "./forwardWebhook";
import { createYelpLogger } from "./logger";
import { parseYelpWebhookPayload } from "./processLead";

const logger = createYelpLogger({
  module: "webhookRoute",
});

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
} as const;

function jsonResponse(
  body: unknown,
  init?: {
    status?: number;
  },
): Response {
  return NextResponse.json(body, {
    status: init?.status,
    headers: NO_STORE_HEADERS,
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function getVerificationValue(request: Request): string | null {
  return new URL(request.url).searchParams.get("verification")?.trim() ?? null;
}

export async function handleYelpWebhookGet(
  request: Request,
): Promise<Response> {
  const verification = getVerificationValue(request);

  if (verification) {
    logger.info("webhook.verification_echoed");
    return textResponse(verification);
  }

  return jsonResponse({
    ok: true,
    message: "Yelp webhook endpoint is live",
  });
}

export async function handleYelpWebhookPost(
  request: Request,
): Promise<Response> {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch (error) {
    logger.warn("webhook.validation_failed", {
      reason: "Invalid JSON body.",
      error,
    });

    return jsonResponse(
      {
        ok: false,
        error: "Invalid JSON body.",
      },
      {
        status: 400,
      },
    );
  }

  let payload;

  try {
    payload = parseYelpWebhookPayload(rawBody);
  } catch (error) {
    logger.warn("webhook.validation_failed", {
      reason:
        error instanceof Error ? error.message : "Invalid Yelp webhook payload.",
      error,
    });

    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Invalid Yelp webhook payload.",
      },
      {
        status: 400,
      },
    );
  }

  const business = getYelpBusinessMetadata(payload.data.id);

  logger.info("webhook.request_received", {
    businessId: business.businessId,
    businessName: business.businessName,
    updateCount: payload.data.updates.length,
    updates: payload.data.updates.map((update) => ({
      eventId: update.event_id,
      leadId: update.lead_id,
      eventType: update.event_type,
      interactionTime: update.interaction_time,
    })),
  });

  let businessAllowed: boolean;

  try {
    businessAllowed = isAllowedBusinessId(payload.data.id);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Yelp business allowlist is not configured.";

    logger.error("webhook.business_allowlist_failed", {
      businessId: business.businessId,
      businessName: business.businessName,
      message,
      error,
    });

    return jsonResponse(
      {
        ok: false,
        forwarded: false,
        businessId: business.businessId,
        businessName: business.businessName,
        updateCount: payload.data.updates.length,
        error: message,
      },
      {
        status: 503,
      },
    );
  }

  if (!businessAllowed) {
    logger.warn("webhook.business_rejected", {
      businessId: business.businessId,
      businessName: business.businessName,
    });

    return jsonResponse(
      {
        ok: false,
        businessId: business.businessId,
        businessName: business.businessName,
        forwarded: false,
        updateCount: payload.data.updates.length,
        error: "Unsupported Yelp business ID.",
      },
      {
        status: 403,
      },
    );
  }

  try {
    const result = await forwardYelpWebhookToMainPlatform({
      payload,
      inboundHeaders: new Headers(request.headers),
    });

    logger.info("webhook.forward_succeeded", {
      businessId: result.businessId,
      businessName: result.businessName,
      updateCount: result.updateCount,
      upstreamStatus: result.upstreamStatus,
    });

    return jsonResponse(
      {
        ok: true,
        forwarded: true,
        businessId: result.businessId,
        businessName: result.businessName,
        updateCount: result.updateCount,
        upstreamStatus: result.upstreamStatus,
      },
      {
        status: result.upstreamStatus,
      },
    );
  } catch (error) {
    const status =
      error instanceof YelpWebhookForwardError ? error.status : 502;
    const upstreamStatus =
      error instanceof YelpWebhookForwardError ? error.upstreamStatus : null;
    const message =
      error instanceof Error
        ? error.message
        : "Failed to forward Yelp webhook.";

    logger.error("webhook.forward_failed", {
      businessId: business.businessId,
      businessName: business.businessName,
      updateCount: payload.data.updates.length,
      upstreamStatus,
      message,
      ...(error instanceof YelpWebhookForwardError && error.details
        ? {
            details: error.details,
          }
        : {}),
    });

    return jsonResponse(
      {
        ok: false,
        forwarded: false,
        businessId: business.businessId,
        businessName: business.businessName,
        updateCount: payload.data.updates.length,
        upstreamStatus,
        error: message,
      },
      {
        status,
      },
    );
  }
}
