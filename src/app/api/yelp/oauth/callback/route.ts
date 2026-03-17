import { NextResponse } from "next/server";

import { getYelpConfig } from "../../../../../lib/yelp/config";
import { createYelpLogger } from "../../../../../lib/yelp/logger";
import { exchangeAndStoreAuthCode } from "../../../../../lib/yelp/tokens";

export const runtime = "nodejs";

const logger = createYelpLogger({
  module: "oauthCallbackRoute",
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim() ?? null;

  if (!code) {
    return NextResponse.json(
      {
        error: "Missing code query parameter.",
      },
      {
        status: 400,
      },
    );
  }

  try {
    const config = getYelpConfig();

    logger.info("oauth.callback_debug_config", {
      redirectUri: config.redirectUri,
      tokenEndpointUrl: config.oauthTokenUrl,
      credentialPresence: `client_id=${Boolean(config.clientId)} client_secret=${Boolean(config.clientSecret)}`,
      statePresent: Boolean(state),
    });

    const tokens = await exchangeAndStoreAuthCode(code);

    logger.info("oauth.callback_completed", {
      statePresent: Boolean(state),
      expiresOn: tokens.expiresOn,
    });

    return NextResponse.json({
      ok: true,
      state,
      expiresOn: tokens.expiresOn,
      tokenType: tokens.tokenType,
      scope: tokens.scope ?? null,
    });
  } catch (error) {
    logger.error("oauth.callback_failed", {
      statePresent: Boolean(state),
      error,
    });

    return NextResponse.json(
      {
        error: "Failed to exchange Yelp OAuth code.",
      },
      {
        status: 500,
      },
    );
  }
}
