import * as NextServer from "next/server";
import { NextResponse } from "next/server";

import { createYelpLogger } from "../../../../lib/yelp/logger";
import {
  parseYelpWebhookPayload,
  processYelpWebhookPayload,
} from "../../../../lib/yelp/processLead";

export const runtime = "nodejs";

const logger = createYelpLogger({
  module: "webhookRoute",
});

function getVerificationResponse(request: Request): Response | null {
  const verification = new URL(request.url).searchParams.get("verification");

  if (!verification) {
    return null;
  }

  return NextResponse.json({
    verification,
  });
}

function scheduleBackgroundTask(task: () => Promise<void>): void {
  const maybeAfter = (NextServer as Record<string, unknown>).after;

  if (typeof maybeAfter === "function") {
    (maybeAfter as (callback: () => void) => void)(() => {
      void task();
    });
    return;
  }

  void task();
}

export async function GET(request: Request): Promise<Response> {
  return (
    getVerificationResponse(request) ??
    NextResponse.json(
      {
        error: "Missing verification query parameter.",
      },
      {
        status: 400,
      },
    )
  );
}

export async function POST(request: Request): Promise<Response> {
  const verificationResponse = getVerificationResponse(request);

  if (verificationResponse) {
    return verificationResponse;
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch (error) {
    logger.warn("webhook.invalid_json", {
      error,
    });

    return NextResponse.json(
      {
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
    logger.warn("webhook.invalid_payload", {
      error,
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid Yelp webhook payload.",
      },
      {
        status: 400,
      },
    );
  }

  logger.info("webhook.received", {
    businessId: payload.data.id,
    updates: payload.data.updates.length,
    object: payload.object,
  });

  scheduleBackgroundTask(async () => {
    try {
      const result = await processYelpWebhookPayload(payload);

      logger.info("webhook.processing_complete", {
        businessId: payload.data.id,
        accepted: result.accepted,
        processed: result.processed,
        skipped: result.skipped,
      });
    } catch (error) {
      logger.error("webhook.processing_crashed", {
        businessId: payload.data.id,
        error,
      });
    }
  });

  return NextResponse.json({
    ok: true,
  });
}
