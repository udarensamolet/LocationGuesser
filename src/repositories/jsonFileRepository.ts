import { readJsonFile, writeJsonFile } from "../utils/jsonFile.js";

export class JsonFileRepository<T> {
  private operation: Promise<void>;

  constructor(
    private readonly filePath: string,
    private readonly fallback: T,
  ) {
    this.operation = Promise.resolve();
  }

  read(): Promise<T> {
    return readJsonFile(this.filePath, this.fallback);
  }

  write(value: T): Promise<void> {
    return writeJsonFile(this.filePath, value);
  }

  update(mutator: (current: T) => Promise<T> | T): Promise<T> {
    const next = (this.operation.catch(() => {})).then(async () => {
      const current = await this.read();
      const updated = await mutator(current);
      await this.write(updated);
      return updated;
    });

    this.operation = next.then(() => undefined);

    return next;
  }
}
