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
  const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";
  const configuredDataDir = (process.env.DATA_DIR ?? "").trim();
  const isReadOnlyDataDir = configuredDataDir === "" || configuredDataDir.startsWith("/var/task");
  const resolvedDataDir =
    isVercel && (isReadOnlyDataDir || !path.isAbsolute(configuredDataDir))
      ? "/tmp/data"
      : configuredDataDir || (isVercel ? "/tmp/data" : "./data");
  const safeDevAuthBypass =
    nodeEnv === "production" && devAuthBypass
      ? false
      : devAuthBypass;

  if (safeDevAuthBypass !== devAuthBypass) {
    console.warn("DEV_AUTH_BYPASS is ignored in production.");
  }

  return {
    port,
    nodeEnv,
    dataDir: path.resolve(process.cwd(), resolvedDataDir),
    devAuthBypass: safeDevAuthBypass,
    devUserId: process.env.DEV_USER_ID ?? "dev-user",
    devUserEmail: process.env.DEV_USER_EMAIL ?? "employee@company.local",
    devUserName: process.env.DEV_USER_NAME ?? "Development User",
    adminEmails: splitAdminEmails(process.env.ADMIN_EMAILS),
  };
};
