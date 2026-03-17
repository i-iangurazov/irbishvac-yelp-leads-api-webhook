import { getLeadById } from "./client";
import { isAllowedBusinessId } from "./config";
import { createYelpLogger } from "./logger";
import { getYelpStorage } from "./storage";
import { withYelpAccessToken } from "./tokens";
import type {
  JsonObject,
  YelpLead,
  YelpNormalizedLead,
  YelpNormalizedSurveyAnswer,
  YelpProcessResult,
  YelpProcessedEventRecord,
  YelpStorageAdapter,
  YelpWebhookPayload,
  YelpWebhookUpdate,
} from "./types";

const logger = createYelpLogger({
  module: "processLead",
});

const inFlightEventIds = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = readString(value);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function pickFirstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const candidate = readStringArray(value);

    if (candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function participantDisplayName(value: unknown): string | null {
  const participant = asRecord(value);

  if (!participant) {
    return null;
  }

  const displayName = readString(participant.display_name);

  if (displayName) {
    return displayName;
  }

  const firstName = readString(participant.first_name);
  const lastName = readString(participant.last_name);
  const joined = [firstName, lastName].filter(Boolean).join(" ").trim();

  return joined || null;
}

function firstArray<T>(...values: unknown[]): T[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value as T[];
    }
  }

  return [];
}

function normalizeSurveyAnswer(value: unknown): YelpNormalizedSurveyAnswer | null {
  const answer = asRecord(value);

  if (!answer) {
    return null;
  }

  const directAnswerList = readStringArray(answer.answers);
  const responseValue =
    pickFirstString(answer.answer, answer.value, answer.response) ??
    undefined;
  const responseList =
    directAnswerList.length > 0
      ? directAnswerList
      : readStringArray(answer.selected_options);

  return {
    question:
      pickFirstString(answer.question, answer.prompt, answer.label) ??
      "Unknown question",
    answer:
      responseList.length > 0 ? responseList : responseValue ?? null,
    raw: answer as JsonObject,
  };
}

function normalizeSurveyAnswers(rawLead: YelpLead): YelpNormalizedSurveyAnswer[] {
  const answers = firstArray<unknown>(
    rawLead.survey_answers,
    rawLead.service_info?.survey_answers,
    rawLead.project?.survey_answers,
    rawLead.request?.survey_answers,
  );

  return answers
    .map((answer) => normalizeSurveyAnswer(answer))
    .filter((answer): answer is YelpNormalizedSurveyAnswer => Boolean(answer));
}

export function normalizeYelpLead(options: {
  businessId: string;
  leadId: string;
  rawLead: YelpLead;
  interactionTime?: string | null;
}): YelpNormalizedLead {
  const { businessId, leadId, rawLead, interactionTime } = options;

  const serviceInfo = rawLead.service_info ?? null;
  const project = rawLead.project ?? null;
  const request = rawLead.request ?? null;
  const location =
    serviceInfo?.location ?? project?.location ?? request?.location ?? null;

  const jobNames = dedupeStrings([
    ...pickFirstStringArray(rawLead.job_names),
    ...pickFirstStringArray(serviceInfo?.job_names),
    ...pickFirstStringArray(project?.job_names),
    ...pickFirstStringArray(request?.job_names),
  ]);

  return {
    source: "yelp",
    businessId,
    leadId,
    conversationId: pickFirstString(rawLead.conversation_id),
    customerDisplayName:
      pickFirstString(rawLead.customer_display_name, rawLead.display_name) ??
      participantDisplayName(rawLead.customer) ??
      participantDisplayName(rawLead.consumer) ??
      participantDisplayName(rawLead.user),
    temporaryEmailAddress: pickFirstString(rawLead.temporary_email_address),
    temporaryEmailExpiry: pickFirstString(
      rawLead.temporary_email_address_expiration,
      rawLead.temporary_email_expiration,
      rawLead.temporary_email_expiry,
    ),
    timeCreated: pickFirstString(rawLead.time_created, rawLead.created_at),
    lastEventTime: pickFirstString(rawLead.last_event_time, interactionTime),
    postalCode: pickFirstString(
      rawLead.postal_code,
      serviceInfo?.postal_code,
      project?.postal_code,
      request?.postal_code,
      location?.postal_code,
      location?.zip_code,
      location?.zipcode,
    ),
    additionalInfo: pickFirstString(
      rawLead.additional_info,
      serviceInfo?.additional_info,
      project?.additional_info,
      request?.additional_info,
    ),
    availabilityStatus: pickFirstString(
      rawLead.availability_status,
      serviceInfo?.availability_status,
      project?.availability_status,
      request?.availability_status,
    ),
    jobNames,
    surveyAnswers: normalizeSurveyAnswers(rawLead),
    rawLead,
  };
}

function parseWebhookUpdate(value: unknown): YelpWebhookUpdate {
  const update = asRecord(value);

  if (!update) {
    throw new Error("Each Yelp webhook update must be an object.");
  }

  const eventType = readString(update.event_type);
  const eventId = readString(update.event_id);
  const leadId = readString(update.lead_id);

  if (!eventType || !eventId || !leadId) {
    throw new Error(
      "Each Yelp webhook update must include event_type, event_id, and lead_id.",
    );
  }

  return {
    event_type: eventType,
    event_id: eventId,
    lead_id: leadId,
    interaction_time: pickFirstString(update.interaction_time),
  };
}

export function parseYelpWebhookPayload(value: unknown): YelpWebhookPayload {
  const payload = asRecord(value);

  if (!payload) {
    throw new Error("Yelp webhook payload must be a JSON object.");
  }

  const time = readString(payload.time);
  const object = readString(payload.object);
  const data = asRecord(payload.data);

  if (!time || !object || !data) {
    throw new Error("Yelp webhook payload must include time, object, and data.");
  }

  const businessId = readString(data.id);

  if (!businessId) {
    throw new Error("Yelp webhook payload must include data.id.");
  }

  if (!Array.isArray(data.updates)) {
    throw new Error("Yelp webhook payload must include data.updates.");
  }

  return {
    time,
    object,
    data: {
      id: businessId,
      updates: data.updates.map((update) => parseWebhookUpdate(update)),
    },
  };
}

async function processSingleWebhookUpdate(
  payload: YelpWebhookPayload,
  update: YelpWebhookUpdate,
  storage: YelpStorageAdapter,
): Promise<"processed" | "skipped"> {
  const eventLogger = logger.child({
    businessId: payload.data.id,
    eventId: update.event_id,
    leadId: update.lead_id,
  });

  const alreadyProcessed = await storage.getProcessedEvent(update.event_id);

  if (alreadyProcessed) {
    eventLogger.info("lead_event.duplicate", {
      processedAt: alreadyProcessed.processedAt,
    });
    return "skipped";
  }

  if (inFlightEventIds.has(update.event_id)) {
    eventLogger.info("lead_event.already_in_flight");
    return "skipped";
  }

  inFlightEventIds.add(update.event_id);

  try {
    const rawLead = await withYelpAccessToken(
      (accessToken) => getLeadById(update.lead_id, accessToken),
      storage,
    );

    const normalizedLead = normalizeYelpLead({
      businessId: payload.data.id,
      leadId: update.lead_id,
      rawLead,
      interactionTime: update.interaction_time,
    });

    const processedRecord: YelpProcessedEventRecord = {
      eventId: update.event_id,
      businessId: payload.data.id,
      leadId: update.lead_id,
      eventType: update.event_type,
      interactionTime: update.interaction_time ?? null,
      webhookTime: payload.time,
      processedAt: new Date().toISOString(),
      payload: update,
    };

    await storage.saveLeadSnapshot(normalizedLead);
    await storage.markProcessedEvent(update.event_id, processedRecord);

    eventLogger.info("lead_event.processed", {
      eventType: update.event_type,
    });

    return "processed";
  } finally {
    inFlightEventIds.delete(update.event_id);
  }
}

export async function processYelpWebhookPayload(
  payload: YelpWebhookPayload,
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<YelpProcessResult> {
  if (payload.object !== "business") {
    logger.warn("webhook.unsupported_object", {
      object: payload.object,
    });

    return {
      accepted: false,
      processed: 0,
      skipped: payload.data.updates.length,
    };
  }

  if (!isAllowedBusinessId(payload.data.id)) {
    logger.warn("webhook.unallowed_business_id", {
      businessId: payload.data.id,
    });

    return {
      accepted: false,
      processed: 0,
      skipped: payload.data.updates.length,
    };
  }

  let processed = 0;
  let skipped = 0;

  for (const update of payload.data.updates) {
    try {
      const outcome = await processSingleWebhookUpdate(payload, update, storage);

      if (outcome === "processed") {
        processed += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;

      logger.error("lead_event.processing_failed", {
        businessId: payload.data.id,
        eventId: update.event_id,
        leadId: update.lead_id,
        error,
      });
    }
  }

  return {
    accepted: true,
    processed,
    skipped,
  };
}
