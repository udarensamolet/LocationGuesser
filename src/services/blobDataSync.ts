import { get, list, put } from "@vercel/blob";
import fs from "node:fs/promises";
import path from "node:path";

const normalizePrefix = (value: string): string => {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
};

const blobPrefix = normalizePrefix(process.env.BLOB_DATA_PREFIX ?? "location-guesser/data");

export const isBlobStorageEnabled = (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const isJsonFile = (fileName: string): boolean => fileName.toLowerCase().endsWith(".json");

const localJsonFiles = async (dataDir: string): Promise<string[]> => {
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isJsonFile(entry.name))
    .map((entry) => entry.name);
};

export const hydrateDataDirectoryFromBlob = async (dataDir: string): Promise<void> => {
  if (!isBlobStorageEnabled()) return;

  await fs.mkdir(dataDir, { recursive: true });
  const { blobs } = await list({ prefix: blobPrefix });

  for (const blob of blobs) {
    if (!blob.pathname.startsWith(blobPrefix)) continue;

    const fileName = blob.pathname.slice(blobPrefix.length);
    if (!fileName || fileName.includes("/") || !isJsonFile(fileName)) continue;

    const stored = await get(blob.url, { access: "private", useCache: false });
    if (!stored || stored.statusCode !== 200) continue;

    const content = await new Response(stored.stream).text();
    JSON.parse(content);
    await fs.writeFile(path.join(dataDir, fileName), content, "utf8");
  }
};

export const syncDataDirectoryToBlob = async (dataDir: string): Promise<void> => {
  if (!isBlobStorageEnabled()) return;

  const fileNames = await localJsonFiles(dataDir);

  await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(path.join(dataDir, fileName), "utf8");
      JSON.parse(content);

      await put(`${blobPrefix}${fileName}`, content, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
    }),
  );
};
