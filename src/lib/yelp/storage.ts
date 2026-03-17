import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import { getYelpConfig, resolveYelpDataDir } from "./config";
import { createYelpLogger } from "./logger";
import type {
  YelpNormalizedLead,
  YelpProcessedEventRecord,
  YelpStorageAdapter,
  YelpStoredTokens,
} from "./types";

type ProcessedEventsFile = Record<string, YelpProcessedEventRecord>;

const logger = createYelpLogger({
  module: "storage",
});

const fileWriteQueues = new Map<string, Promise<void>>();

let configuredStorageAdapter: YelpStorageAdapter | null = null;
let defaultFileAdapter: YelpStorageAdapter | null = null;
let hasWarnedAboutFileStorageInProduction = false;

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function queueFileWrite(
  filePath: string,
  writer: () => Promise<void>,
): Promise<void> {
  const current = fileWriteQueues.get(filePath) ?? Promise.resolve();
  const next = current.catch(() => undefined).then(writer);
  const tracked = next.finally(() => {
    if (fileWriteQueues.get(filePath) === tracked) {
      fileWriteQueues.delete(filePath);
    }
  });

  fileWriteQueues.set(filePath, tracked);

  return next;
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), {
    recursive: true,
  });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await queueFileWrite(filePath, async () => {
    await ensureParentDir(filePath);

    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, filePath);
  });
}

async function updateJsonFile<T>(
  filePath: string,
  defaultValue: T,
  update: (current: T) => T | Promise<T>,
): Promise<void> {
  await queueFileWrite(filePath, async () => {
    await ensureParentDir(filePath);

    const current = (await readJsonFile<T>(filePath)) ?? defaultValue;
    const next = await update(current);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    await writeFile(
      temporaryPath,
      `${JSON.stringify(next, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, filePath);
  });
}

export class FileYelpStorageAdapter implements YelpStorageAdapter {
  private readonly baseDir: string;
  private readonly tokensPath: string;
  private readonly processedEventsPath: string;
  private readonly leadsDir: string;

  constructor(baseDir = getYelpConfig().dataDir) {
    this.baseDir = resolveYelpDataDir(baseDir);
    this.tokensPath = path.join(this.baseDir, "tokens.json");
    this.processedEventsPath = path.join(
      this.baseDir,
      "processed-events.json",
    );
    this.leadsDir = path.join(this.baseDir, "leads");
  }

  async getTokens(): Promise<YelpStoredTokens | null> {
    return readJsonFile<YelpStoredTokens>(this.tokensPath);
  }

  async saveTokens(tokens: YelpStoredTokens): Promise<void> {
    await writeJsonFile(this.tokensPath, tokens);
  }

  async getProcessedEvent(
    eventId: string,
  ): Promise<YelpProcessedEventRecord | null> {
    const events = await readJsonFile<ProcessedEventsFile>(
      this.processedEventsPath,
    );

    return events?.[eventId] ?? null;
  }

  async markProcessedEvent(
    eventId: string,
    payload: YelpProcessedEventRecord,
  ): Promise<void> {
    await updateJsonFile<ProcessedEventsFile>(
      this.processedEventsPath,
      {},
      (current) => ({
        ...current,
        [eventId]: payload,
      }),
    );
  }

  async saveLeadSnapshot(lead: YelpNormalizedLead): Promise<void> {
    const filePath = path.join(
      this.leadsDir,
      `${sanitizeFileSegment(lead.leadId)}.json`,
    );

    await writeJsonFile(filePath, lead);
  }
}

export function createFileYelpStorageAdapter(
  baseDir = getYelpConfig().dataDir,
): YelpStorageAdapter {
  return new FileYelpStorageAdapter(baseDir);
}

export function setYelpStorageAdapter(adapter: YelpStorageAdapter): void {
  configuredStorageAdapter = adapter;
}

export function clearYelpStorageAdapter(): void {
  configuredStorageAdapter = null;
}

export function getYelpStorage(): YelpStorageAdapter {
  if (configuredStorageAdapter) {
    return configuredStorageAdapter;
  }

  if (!defaultFileAdapter) {
    defaultFileAdapter = createFileYelpStorageAdapter();
  }

  if (
    process.env.NODE_ENV === "production" &&
    !hasWarnedAboutFileStorageInProduction
  ) {
    hasWarnedAboutFileStorageInProduction = true;

    logger.warn("storage.file_adapter_in_production", {
      dataDir: getYelpConfig().dataDir,
      message:
        "Local filesystem storage is only safe for development. Replace the default adapter with durable storage in production.",
    });
  }

  return defaultFileAdapter;
}
