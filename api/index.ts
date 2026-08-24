import { createApp } from "../src/app.js";

let appPromise: ReturnType<typeof createApp> | null = null;

const getApp = () => {
  if (!appPromise) {
    appPromise = createApp();
  }
  return appPromise;
};

export default async function handler(request: unknown, response: unknown): Promise<void> {
  const app = await getApp();
  return app(request as never, response as never);
}
