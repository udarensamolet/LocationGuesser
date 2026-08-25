import { NextFunction, Request, Response, RequestHandler } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppUser, ANONYMOUS_USER } from "../models/user.js";
import { AppConfig } from "../services/config.js";

type IdentityFromHeaders = {
  id: string;
  email: string;
  displayName: string;
};

type ClaimLike = { typ?: string; val?: string };

type MsClientPrincipalPayload = {
  userId?: string;
  user_details?: string;
  userDetails?: string;
  claims?: ClaimLike[];
};

type JwtPayload = {
  email?: string | string[];
  upn?: string;
  preferred_username?: string;
  name?: string;
  oid?: string;
  sub?: string;
  emails?: string | string[];
  unique_name?: string;
  [key: string]: unknown;
};

const AUTH_COOKIE_NAME = "location_guesser_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const sessionSecret = process.env.AUTH_SESSION_SECRET ?? "location-guesser-local-session-secret";

if ((process.env.NODE_ENV ?? "").toLowerCase() === "production" && !process.env.AUTH_SESSION_SECRET) {
  console.warn("AUTH_SESSION_SECRET is not configured; using the built-in fallback secret.");
}

export const normalizeLoginName = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isValidLoginName = (name: string): boolean =>
  /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .'-]{1,79}$/u.test(name);

const signSessionValue = (value: string): string =>
  createHmac("sha256", sessionSecret).update(value).digest("base64url");

const isSecureRequest = (): boolean =>
  (process.env.NODE_ENV ?? "").toLowerCase() === "production" || process.env.VERCEL === "1";

export const createSessionCookie = (name: string): string => {
  const encodedName = Buffer.from(name, "utf8").toString("base64url");
  const value = `${encodedName}.${signSessionValue(encodedName)}`;
  const secureFlag = isSecureRequest() ? "; Secure" : "";

  return `${AUTH_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`;
};

export const clearSessionCookie = (): string => {
  const secureFlag = isSecureRequest() ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
};

const readCookie = (req: Request, cookieName: string): string => {
  const cookieHeader = req.header("cookie") ?? "";

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    if (name === cookieName) {
      return part.slice(separator + 1).trim();
    }
  }

  return "";
};

const getSessionName = (req: Request): string => {
  const rawValue = readCookie(req, AUTH_COOKIE_NAME);
  const separator = rawValue.indexOf(".");
  if (separator === -1) return "";

  const encodedName = rawValue.slice(0, separator);
  const providedSignature = rawValue.slice(separator + 1);
  const expectedSignature = signSessionValue(encodedName);
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return "";
  }

  try {
    const name = normalizeLoginName(Buffer.from(encodedName, "base64url").toString("utf8"));
    return isValidLoginName(name) ? name : "";
  } catch (_error) {
    return "";
  }
};

const isAdminEmail = (email: string, adminEmails: string[]): boolean =>
  adminEmails.includes(email.trim().toLowerCase());

const createNameUser = (name: string, adminEmails: string[]): AppUser => ({
  id: name,
  email: name,
  displayName: name,
  isAdmin: isAdminEmail(name, adminEmails),
});

const toText = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

const firstHeader = (req: Request, names: string[]): string => {
  for (const name of names) {
    const value = toText(req.header(name));
    if (value) {
      return value;
    }
  }
  return "";
};

const decodeBase64Url = (value: string): string => {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(normalized, "base64").toString("utf8");
};

const firstNonEmpty = (...values: Array<string | undefined | null>): string => {
  for (const value of values) {
    const normalized = toText(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
};

const asPayload = (value: unknown): JwtPayload | null => {
  if (!value || typeof value !== "object") return null;
  return value as JwtPayload;
};

const claimToText = (raw: unknown): string => {
  if (typeof raw === "string") {
    return raw.trim();
  }

  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
    return raw[0].trim();
  }

  return "";
};

const identityFromJwt = (token: string): IdentityFromHeaders | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = asPayload(JSON.parse(decodeBase64Url(parts[1])));
    if (!payload) return null;

    const email = firstNonEmpty(
      claimToText(payload.email),
      claimToText(payload.upn),
      claimToText(payload.preferred_username),
      claimToText(payload.emails),
      claimToText(payload.unique_name),
    );

    const displayName = firstNonEmpty(
      claimToText(payload.name),
      claimToText(payload.unique_name),
      email,
    );

    const id = firstNonEmpty(
      claimToText(payload.oid),
      claimToText(payload.sub),
      email,
    );

    if (!email && !id) return null;

    return {
      id: id || email,
      email,
      displayName: displayName || "User",
    };
  } catch (_error) {
    return null;
  }
};

const parseMsClientPrincipal = (req: Request): IdentityFromHeaders | null => {
  const encoded = toText(req.header("x-ms-client-principal"));
  if (!encoded) return null;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const payload = JSON.parse(decoded) as MsClientPrincipalPayload;

    const claims = Array.isArray(payload.claims) ? payload.claims : [];
    const claimValue = (type: string) =>
      toText(claims.find((entry) => toText(entry.typ) === type)?.val);

    const email = firstNonEmpty(
      claimValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"),
      claimValue("email"),
      claimValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"),
      claimValue("preferred_username"),
      claimValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"),
      toText(payload.user_details),
      toText(payload.userDetails),
    );

    const displayName = firstNonEmpty(
      claimValue("name"),
      claimValue("http://schemas.microsoft.com/identity/claims/displayname"),
      claimValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"),
      email,
    );

    const id = firstNonEmpty(
      toText(payload.userId),
      claimValue("http://schemas.microsoft.com/identity/claims/objectidentifier"),
      claimValue("sub"),
      email,
    );

    if (!email && !id) return null;

    return {
      id: id || email,
      email: email || "",
      displayName: displayName || email || "User",
    };
  } catch (_error) {
    return null;
  }
};

const resolveHeaderPrincipal = (req: Request, adminEmailList: string[]): AppUser | null => {
  const azureEmail = firstHeader(req, [
    "x-ms-client-principal-email",
    "x-ms-client-principal-name",
  ]);
  const azureId = firstHeader(req, [
    "x-ms-client-principal-id",
    "x-ms-client-principal-object-id",
  ]);
  const azureName = firstHeader(req, [
    "x-ms-client-principal-name",
  ]);

  if (azureEmail || azureId || azureName) {
    const email = azureEmail || azureId;
    return {
      id: azureId || email,
      email: email || "",
      displayName: azureName || email || "User",
      isAdmin: email ? isAdminEmail(email, adminEmailList) : false,
    };
  }

  const msClientPrincipal = parseMsClientPrincipal(req);
  if (msClientPrincipal) {
    return {
      ...msClientPrincipal,
      isAdmin: isAdminEmail(msClientPrincipal.email, adminEmailList),
    };
  }

  const tokenFromHeader = firstHeader(req, [
    "x-ms-token-aad-id-token",
    "x-ms-client-principal-token",
    "authorization",
  ]);
  const token = tokenFromHeader.startsWith("Bearer ")
    ? tokenFromHeader.slice(7)
    : tokenFromHeader;
  const tokenIdentity = token ? identityFromJwt(token) : null;
  if (tokenIdentity) {
    return {
      ...tokenIdentity,
      isAdmin: isAdminEmail(tokenIdentity.email, adminEmailList),
    };
  }

  const trustProxyHeaders = (process.env.TRUST_PROXY_IDENTITY_HEADERS ?? "").toLowerCase() === "true";
  if (!trustProxyHeaders) return null;

  const proxyEmail = firstHeader(req, [
    "x-vercel-user-email",
    "x-vercel-auth-user-email",
    "x-azure-user-email",
    "x-forwarded-email",
    "x-forwarded-user-email",
    "x-auth-user-email",
  ]);
  const proxyId = firstHeader(req, [
    "x-vercel-user-id",
    "x-vercel-auth-user-id",
    "x-azure-user-id",
    "x-forwarded-user-id",
    "x-forwarded-user",
    "x-auth-user-id",
  ]);
  const proxyName = firstHeader(req, [
    "x-vercel-user-name",
    "x-vercel-auth-user-name",
    "x-azure-user-name",
    "x-forwarded-user-name",
    "x-auth-user-name",
  ]);

  if (!proxyEmail && !proxyId && !proxyName) {
    return null;
  }

  const email = proxyEmail || proxyId;
  const id = proxyId || proxyEmail;

  return {
    id,
    email: email || "",
    displayName: proxyName || email || "User",
    isAdmin: email ? isAdminEmail(email, adminEmailList) : false,
  };
};

const resolveAuthenticatedUser = (config: AppConfig): ((req: Request) => AppUser) => {
  return (req: Request): AppUser => {
    const sessionName = getSessionName(req);
    if (sessionName) {
      return createNameUser(sessionName, config.adminEmails);
    }

    if (config.devAuthBypass) {
      const email = config.devUserEmail;
      return {
        id: config.devUserId,
        email,
        displayName: config.devUserName,
        isAdmin: isAdminEmail(email, config.adminEmails),
      };
    }

    const principal = resolveHeaderPrincipal(req, config.adminEmails);
    if (!principal || (!principal.id && !principal.email)) {
      return ANONYMOUS_USER;
    }

    return {
      ...principal,
      id: principal.id || principal.email,
      email: principal.email || principal.id,
    };
  };
};

export const createCurrentUserMiddleware = (config: AppConfig): RequestHandler => {
  const userFactory = resolveAuthenticatedUser(config);

  return (req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = userFactory(req);
    next();
  };
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.currentUser || !req.currentUser.isAdmin) {
    res.status(403).render("layouts/base", {
      title: "Access denied",
      statusCode: 403,
      message: "This route requires administrator permissions.",
      currentUser: req.currentUser,
      content: "pages/error",
      pageTitle: "Access denied",
    });
    return;
  }

  next();
};
