import { createApp } from "./app.js";
import { getAppConfig } from "./services/config.js";

const bootstrap = async () => {
  const config = getAppConfig();
  const app = await createApp(config);

  app.listen(config.port, () => {
    console.log(`Server is running on port ${config.port}`);
  });
};

bootstrap().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
