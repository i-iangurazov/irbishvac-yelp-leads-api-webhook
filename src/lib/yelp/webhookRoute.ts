import { NextResponse } from "next/server";

import {
  getYelpBusinessMetadata,
  isAllowedBusinessId,
} from "./config";
import { createYelpLogger } from "./logger";
import {
  parseYelpWebhookPayload,
  processYelpWebhookPayload,
} from "./processLead";

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

  if (!isAllowedBusinessId(payload.data.id)) {
    logger.warn("webhook.business_rejected", {
      businessId: business.businessId,
      businessName: business.businessName,
    });

    return jsonResponse(
      {
        ok: false,
        businessId: business.businessId,
        businessName: business.businessName,
        processed: 0,
        skippedDuplicates: 0,
        failed: payload.data.updates.length,
        errors: ["Unsupported Yelp business ID."],
      },
      {
        status: 403,
      },
    );
  }

  const result = await processYelpWebhookPayload(payload);
  const responseBody = {
    ok: result.ok,
    businessId: result.businessId,
    businessName: result.businessName,
    processed: result.processed,
    skippedDuplicates: result.skippedDuplicates,
    failed: result.failed,
    ...(result.errors.length > 0
      ? {
          errors: result.errors.map((error) => ({
            eventId: error.eventId,
            leadId: error.leadId,
            eventType: error.eventType,
            interactionTime: error.interactionTime,
            stage: error.stage,
            message: error.message,
          })),
        }
      : {}),
  };

  return jsonResponse(responseBody, {
    status: result.ok ? 200 : 500,
  });
}
