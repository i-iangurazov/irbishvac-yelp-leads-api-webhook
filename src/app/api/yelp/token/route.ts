import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { getYelpConfig } from "../../../../lib/yelp/config";
import { createYelpLogger } from "../../../../lib/yelp/logger";
import { resolveYelpTokens } from "../../../../lib/yelp/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createYelpLogger({
  module: "tokenRoute",
});
const NO_STORE_HEADERS = {
  "cache-control": "no-store",
};

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice("bearer ".length).trim();
  return token || null;
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function GET(request: Request): Promise<Response> {
  const config = getYelpConfig();

  if (!config.internalApiSecret) {
    logger.error("token.secret_missing");

    return NextResponse.json(
      {
        ok: false,
        error: "YELP_INTERNAL_API_SECRET is not configured.",
      },
      {
        status: 503,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const providedSecret = readBearerToken(request);

  if (
    !providedSecret ||
    !secretsMatch(providedSecret, config.internalApiSecret)
  ) {
    logger.warn("token.unauthorized");

    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized.",
      },
      {
        status: 401,
        headers: {
          ...NO_STORE_HEADERS,
          "www-authenticate": 'Bearer realm="internal"',
        },
      },
    );
  }

  try {
    const tokens = await resolveYelpTokens();

    logger.info("token.served", {
      expiresOn: tokens.expiresOn,
    });

    return NextResponse.json({
      ok: true,
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresOn: tokens.expiresOn,
      scope: tokens.scope ?? null,
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    logger.error("token.read_failed", {
      error,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to resolve Yelp access token.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
