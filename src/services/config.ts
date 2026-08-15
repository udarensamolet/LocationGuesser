import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  dataDir: string;
  devAuthBypass: boolean;
  devUserId: string;
  devUserEmail: string;
  devUserName: string;
  adminEmails: string[];
}

const splitAdminEmails = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
};

export const getAppConfig = (): AppConfig => {
  const nodeEnv = (process.env.NODE_ENV ?? "development").toLowerCase();
  const devAuthBypass = (process.env.DEV_AUTH_BYPASS ?? "").toLowerCase() === "true";
  const requestedPort = parseInt(process.env.PORT ?? "3000", 10);
  const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 3000;

  if (nodeEnv === "production" && devAuthBypass) {
    throw new Error(
      "DEV_AUTH_BYPASS cannot be enabled when NODE_ENV=production.",
    );
  }

  return {
    port,
    nodeEnv,
    dataDir: path.resolve(process.cwd(), process.env.DATA_DIR ?? "./data"),
    devAuthBypass,
    devUserId: process.env.DEV_USER_ID ?? "dev-user",
    devUserEmail: process.env.DEV_USER_EMAIL ?? "employee@company.local",
    devUserName: process.env.DEV_USER_NAME ?? "Development User",
    adminEmails: splitAdminEmails(process.env.ADMIN_EMAILS),
  };
};
