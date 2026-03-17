import { NextResponse } from "next/server";

import {
  getYelpBusinessMetadata,
  isAllowedBusinessId,
} from "../../../../lib/yelp/config";
import { createYelpLogger } from "../../../../lib/yelp/logger";
import {
  parseYelpWebhookPayload,
  processYelpWebhookPayload,
} from "../../../../lib/yelp/processLead";

export const runtime = "nodejs";

const logger = createYelpLogger({
  module: "webhookRoute",
});

function getVerificationValue(request: Request): string | null {
  return new URL(request.url).searchParams.get("verification");
}

export async function GET(request: Request): Promise<Response> {
  const verification = getVerificationValue(request);

  if (verification) {
    return NextResponse.json({
      verification,
    });
  }

  return NextResponse.json({
    ok: true,
    message: "Yelp webhook endpoint is live",
  });
}

export async function POST(request: Request): Promise<Response> {
  const verification = getVerificationValue(request);

  if (verification) {
    return NextResponse.json({
      verification,
    });
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch (error) {
    logger.warn("webhook.validation_failed", {
      reason: "Invalid JSON body.",
      error,
    });

    return NextResponse.json(
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

    return NextResponse.json(
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

    return NextResponse.json(
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

  return NextResponse.json(responseBody, {
    status: result.ok ? 200 : 500,
  });
}
