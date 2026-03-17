export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface YelpWebhookUpdate {
  event_type: string;
  event_id: string;
  lead_id: string;
  interaction_time?: string | null;
}

export interface YelpWebhookPayload {
  time: string;
  object: string;
  data: {
    id: string;
    updates: YelpWebhookUpdate[];
  };
}

export interface YelpOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface YelpStoredTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresOn: string;
  scope?: string;
  createdAt: string;
  updatedAt: string;
}

export interface YelpProcessedEventRecord {
  eventId: string;
  businessId: string;
  leadId: string;
  eventType: string;
  interactionTime: string | null;
  webhookTime: string;
  processedAt: string;
  payload: YelpWebhookUpdate;
}

export interface YelpLeadParticipant extends JsonObject {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface YelpLeadLocation extends JsonObject {
  postal_code?: string | null;
  zip_code?: string | null;
  zipcode?: string | null;
}

export interface YelpLeadSurveyAnswer extends JsonObject {
  question?: string | null;
  prompt?: string | null;
  label?: string | null;
  answer?: string | null;
  answers?: string[];
  selected_options?: string[];
  value?: string | string[] | null;
  response?: string | string[] | null;
}

export interface YelpLeadDetails extends JsonObject {
  postal_code?: string | null;
  additional_info?: string | null;
  availability_status?: string | null;
  job_names?: string[];
  survey_answers?: YelpLeadSurveyAnswer[];
  location?: YelpLeadLocation | null;
}

export interface YelpLead extends JsonObject {
  id?: string;
  lead_id?: string;
  conversation_id?: string | null;
  display_name?: string | null;
  customer_display_name?: string | null;
  customer?: YelpLeadParticipant | null;
  consumer?: YelpLeadParticipant | null;
  user?: YelpLeadParticipant | null;
  temporary_email_address?: string | null;
  temporary_email_address_expiration?: string | null;
  temporary_email_expiration?: string | null;
  temporary_email_expiry?: string | null;
  time_created?: string | null;
  created_at?: string | null;
  last_event_time?: string | null;
  postal_code?: string | null;
  additional_info?: string | null;
  availability_status?: string | null;
  job_names?: string[];
  survey_answers?: YelpLeadSurveyAnswer[];
  service_info?: YelpLeadDetails | null;
  project?: YelpLeadDetails | null;
  request?: YelpLeadDetails | null;
}

export interface YelpNormalizedSurveyAnswer {
  question: string;
  answer: string | string[] | null;
  raw: JsonObject;
}

export interface YelpNormalizedLead {
  source: "yelp";
  businessId: string;
  leadId: string;
  conversationId: string | null;
  customerDisplayName: string | null;
  temporaryEmailAddress: string | null;
  temporaryEmailExpiry: string | null;
  timeCreated: string | null;
  lastEventTime: string | null;
  postalCode: string | null;
  additionalInfo: string | null;
  availabilityStatus: string | null;
  jobNames: string[];
  surveyAnswers: YelpNormalizedSurveyAnswer[];
  rawLead: YelpLead;
}

export interface YelpLeadReplyRequest {
  request_content: string;
  request_type: "TEXT";
}

export type YelpLeadReplyResponse = JsonObject;

export interface YelpStorageAdapter {
  getTokens(): Promise<YelpStoredTokens | null>;
  saveTokens(tokens: YelpStoredTokens): Promise<void>;
  getProcessedEvent(eventId: string): Promise<YelpProcessedEventRecord | null>;
  markProcessedEvent(
    eventId: string,
    payload: YelpProcessedEventRecord,
  ): Promise<void>;
  saveLeadSnapshot(lead: YelpNormalizedLead): Promise<void>;
}

export interface YelpProcessResult {
  accepted: boolean;
  processed: number;
  skipped: number;
}
