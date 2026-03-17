import { getLeadById } from "./client";
import {
  getYelpBusinessMetadata,
  isAllowedBusinessId,
} from "./config";
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
  YelpWebhookProcessError,
  YelpWebhookUpdate,
  YelpWebhookUpdateResult,
} from "./types";

const logger = createYelpLogger({
  module: "processLead",
});

const inFlightEventIds = new Set<string>();

type UpdateOutcome =
  | {
      status: "processed";
      result: YelpWebhookUpdateResult;
    }
  | {
      status: "duplicate";
      result: YelpWebhookUpdateResult;
    }
  | {
      status: "failed";
      result: YelpWebhookUpdateResult;
      error: YelpWebhookProcessError;
    };

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

function createUpdateResult(
  update: YelpWebhookUpdate,
  status: YelpWebhookUpdateResult["status"],
): YelpWebhookUpdateResult {
  return {
    eventId: update.event_id,
    leadId: update.lead_id,
    eventType: update.event_type,
    interactionTime: update.interaction_time,
    status,
  };
}

function createProcessError(
  update: YelpWebhookUpdate,
  stage: YelpWebhookProcessError["stage"],
  message: string,
): YelpWebhookProcessError {
  return {
    eventId: update.event_id,
    leadId: update.lead_id,
    eventType: update.event_type,
    interactionTime: update.interaction_time,
    stage,
    message,
  };
}

function isWebhookProcessError(
  value: unknown,
): value is YelpWebhookProcessError {
  const error = asRecord(value);

  return Boolean(
    error &&
      readString(error.eventId) &&
      readString(error.leadId) &&
      readString(error.eventType) &&
      readString(error.interactionTime) &&
      readString(error.stage) &&
      readString(error.message),
  );
}

export function normalizeYelpLead(options: {
  businessId: string;
  leadId: string;
  rawLead: YelpLead;
  interactionTime: string;
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
  const interactionTime = readString(update.interaction_time);

  if (!eventType || !eventId || !leadId || !interactionTime) {
    throw new Error(
      "Each Yelp webhook update must include event_type, event_id, lead_id, and interaction_time.",
    );
  }

  return {
    event_type: eventType,
    event_id: eventId,
    lead_id: leadId,
    interaction_time: interactionTime,
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

  if (object !== "business") {
    throw new Error('Yelp webhook payload object must be "business".');
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
): Promise<UpdateOutcome> {
  const business = getYelpBusinessMetadata(payload.data.id);
  const eventLogger = logger.child({
    businessId: business.businessId,
    businessName: business.businessName,
    eventId: update.event_id,
    leadId: update.lead_id,
    eventType: update.event_type,
    interactionTime: update.interaction_time,
  });

  eventLogger.info("webhook.update_processing_started");

  const duplicateResult = createUpdateResult(update, "duplicate");

  const alreadyProcessed = await storage.getProcessedEvent(update.event_id);

  if (alreadyProcessed) {
    eventLogger.info("webhook.update_duplicate_skipped", {
      reason: "already_processed",
      processedAt: alreadyProcessed.processedAt,
    });

    return {
      status: "duplicate",
      result: duplicateResult,
    };
  }

  if (inFlightEventIds.has(update.event_id)) {
    eventLogger.info("webhook.update_duplicate_skipped", {
      reason: "in_flight",
    });

    return {
      status: "duplicate",
      result: duplicateResult,
    };
  }

  inFlightEventIds.add(update.event_id);

  try {
    const rawLead = await withYelpAccessToken(
      (accessToken) => getLeadById(update.lead_id, accessToken),
      storage,
    )
      .then((lead) => {
        eventLogger.info("webhook.lead_fetch_succeeded");
        return lead;
      })
      .catch((error: unknown) => {
        eventLogger.error("webhook.lead_fetch_failed", {
          error,
        });

        return Promise.reject(
          createProcessError(
            update,
            "lead_fetch",
            "Failed to fetch Yelp lead details.",
          ),
        );
      });

    const normalizedLead = normalizeYelpLead({
      businessId: business.businessId,
      leadId: update.lead_id,
      rawLead,
      interactionTime: update.interaction_time,
    });

    const processedRecord: YelpProcessedEventRecord = {
      eventId: update.event_id,
      businessId: business.businessId,
      leadId: update.lead_id,
      eventType: update.event_type,
      interactionTime: update.interaction_time,
      webhookTime: payload.time,
      processedAt: new Date().toISOString(),
      payload: update,
    };

    try {
      await storage.saveLeadSnapshot(normalizedLead);
      await storage.markProcessedEvent(update.event_id, processedRecord);

      eventLogger.info("webhook.persistence_succeeded");

      return {
        status: "processed",
        result: createUpdateResult(update, "processed"),
      };
    } catch (error) {
      eventLogger.error("webhook.persistence_failed", {
        error,
      });

      return {
        status: "failed",
        result: createUpdateResult(update, "failed"),
        error: createProcessError(
          update,
          "persistence",
          "Failed to persist Yelp lead data.",
        ),
      };
    }
  } catch (error) {
    if (isWebhookProcessError(error)) {
      return {
        status: "failed",
        result: createUpdateResult(update, "failed"),
        error,
      };
    }

    eventLogger.error("webhook.update_processing_failed", {
      error,
    });

    return {
      status: "failed",
      result: createUpdateResult(update, "failed"),
      error: createProcessError(
        update,
        "processing",
        "Failed to process Yelp webhook update.",
      ),
    };
  } finally {
    inFlightEventIds.delete(update.event_id);
  }
}

export async function processYelpWebhookPayload(
  payload: YelpWebhookPayload,
  storage: YelpStorageAdapter = getYelpStorage(),
): Promise<YelpProcessResult> {
  const business = getYelpBusinessMetadata(payload.data.id);

  if (payload.object !== "business") {
    logger.warn("webhook.validation_failed", {
      businessId: business.businessId,
      businessName: business.businessName,
      reason: 'Unsupported payload.object. Expected "business".',
      object: payload.object,
    });

    return {
      ok: false,
      businessId: business.businessId,
      businessName: business.businessName,
      processed: 0,
      skippedDuplicates: 0,
      failed: payload.data.updates.length,
      errors: [],
      updates: [],
    };
  }

  if (!isAllowedBusinessId(payload.data.id)) {
    logger.warn("webhook.business_rejected", {
      businessId: business.businessId,
      businessName: business.businessName,
    });

    return {
      ok: false,
      businessId: business.businessId,
      businessName: business.businessName,
      processed: 0,
      skippedDuplicates: 0,
      failed: payload.data.updates.length,
      errors: [],
      updates: [],
    };
  }

  const result: YelpProcessResult = {
    ok: true,
    businessId: business.businessId,
    businessName: business.businessName,
    processed: 0,
    skippedDuplicates: 0,
    failed: 0,
    errors: [],
    updates: [],
  };

  for (const update of payload.data.updates) {
    const outcome = await processSingleWebhookUpdate(payload, update, storage);

    result.updates.push(outcome.result);

    switch (outcome.status) {
      case "processed":
        result.processed += 1;
        break;
      case "duplicate":
        result.skippedDuplicates += 1;
        break;
      case "failed":
        result.failed += 1;
        result.errors.push(outcome.error);
        break;
    }
  }

  result.ok = result.failed === 0;

  const logDetails = {
    businessId: result.businessId,
    businessName: result.businessName,
    processed: result.processed,
    skippedDuplicates: result.skippedDuplicates,
    failed: result.failed,
    errorCount: result.errors.length,
  };

  if (result.ok) {
    logger.info("webhook.request_completed", logDetails);
  } else {
    logger.warn("webhook.request_completed", logDetails);
  }

  return result;
}
