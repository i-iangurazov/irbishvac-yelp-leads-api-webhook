import { sendLeadReply } from "./client";
import { createYelpLogger } from "./logger";
import { getYelpStorage } from "./storage";
import { withYelpAccessToken } from "./tokens";
import type { YelpLeadReplyResponse, YelpStorageAdapter } from "./types";

const logger = createYelpLogger({
  module: "reply",
});

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

export async function replyToLead(
  leadId: string,
  message: string,
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<YelpLeadReplyResponse> {
  const normalizedLeadId = assertNonEmpty(leadId, "Lead ID");
  const normalizedMessage = assertNonEmpty(message, "Reply message");

  const response = await withYelpAccessToken(
    (accessToken) =>
      sendLeadReply(normalizedLeadId, normalizedMessage, accessToken),
    storage,
  );

  logger.info("lead.reply_sent", {
    leadId: normalizedLeadId,
    messageLength: normalizedMessage.length,
  });

  return response;
}
