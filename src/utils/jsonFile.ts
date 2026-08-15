import { promises as fs } from "node:fs";
import path from "node:path";

const writeLocks = new Map<string, Promise<void>>();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const ensureDirectoryExists = async (directory: string): Promise<void> => {
  await fs.mkdir(directory, { recursive: true });
};

export const readJsonFile = async <T>(
  filePath: string,
  fallback: T,
): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      await writeJsonFile(filePath, fallback);
      return clone(fallback);
    }
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      await ensureDirectoryExists(path.dirname(filePath));
      await writeJsonFile(filePath, fallback);
      return clone(fallback);
    }

    console.error(`Failed to read JSON file: ${filePath}`, error);
    throw error;
  }
};

export const writeJsonFile = async <T>(filePath: string, payload: T): Promise<void> => {
  const writeOperation = async () => {
    await ensureDirectoryExists(path.dirname(filePath));
    const tempFile = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const formatted = JSON.stringify(payload, null, 2) + "\n";
    await fs.writeFile(tempFile, formatted, "utf8");
    await fs.rename(tempFile, filePath);
  };

  const current = writeLocks.get(filePath) ?? Promise.resolve();
  const next = current.catch(() => {}).then(writeOperation);
  writeLocks.set(filePath, next);

  try {
    await next;
  } finally {
    if (writeLocks.get(filePath) === next) {
      writeLocks.delete(filePath);
    }
  }
};
