import express from "express";
import path from "node:path";
import compression from "compression";
import helmet from "helmet";

import { AppConfig, getAppConfig } from "./services/config.js";
import { createCurrentUserMiddleware } from "./middleware/auth.js";
import { createCoreRoutes } from "./routes/index.js";
import { initializeDataStore } from "./services/dataStore.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { GameService } from "./services/gameService.js";
import { createGameRoutes } from "./routes/game.js";
import { AdminService } from "./services/adminService.js";
import { createAdminRoutes, createPublicRoutes } from "./routes/admin.js";

export const createApp = async (config: AppConfig = getAppConfig()) => {
  const app = express();
  const store = await initializeDataStore(config.dataDir);
  const gameService = new GameService(store);
  const adminService = new AdminService(store);

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "views"));

  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(express.static(path.join(process.cwd(), "public")));

  app.use(createCurrentUserMiddleware(config));

  app.use(createCoreRoutes(gameService));
  app.use(createPublicRoutes(adminService));
  app.use(createGameRoutes(gameService));
  app.use(createAdminRoutes(adminService));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
