type LogLevel = "info" | "warn" | "error";
type LogMetadata = Record<string, unknown>;

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(access[_-]?token|refresh[_-]?token|token|secret|authorization|password|api[_-]?key)/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[MaxDepth]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? REDACTED_VALUE
          : sanitizeValue(entry, depth + 1),
      ]),
    );
  }

  return value;
}

function writeLog(
  level: LogLevel,
  event: string,
  context: LogMetadata,
  details?: LogMetadata,
): void {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    scope: "yelp",
    level,
    event,
    context: sanitizeValue(context),
  };

  if (details && Object.keys(details).length > 0) {
    payload.details = sanitizeValue(details);
  }

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export interface YelpLogger {
  child(context: LogMetadata): YelpLogger;
  info(event: string, details?: LogMetadata): void;
  warn(event: string, details?: LogMetadata): void;
  error(event: string, details?: LogMetadata): void;
}

export function createYelpLogger(context: LogMetadata = {}): YelpLogger {
  return {
    child(childContext: LogMetadata): YelpLogger {
      return createYelpLogger({
        ...context,
        ...childContext,
      });
    },
    info(event: string, details?: LogMetadata): void {
      writeLog("info", event, context, details);
    },
    warn(event: string, details?: LogMetadata): void {
      writeLog("warn", event, context, details);
    },
    error(event: string, details?: LogMetadata): void {
      writeLog("error", event, context, details);
    },
  };
}

export const yelpLogger = createYelpLogger();
