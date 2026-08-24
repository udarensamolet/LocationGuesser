import { NextFunction, Request, Response, RequestHandler } from "express";
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

const isAdminEmail = (email: string, adminEmails: string[]): boolean =>
  adminEmails.includes(email.trim().toLowerCase());

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
  if (config.devAuthBypass) {
    return () => {
      const email = config.devUserEmail;
      return {
        id: config.devUserId,
        email,
        displayName: config.devUserName,
        isAdmin: isAdminEmail(email, config.adminEmails),
      };
    };
  }

  return (req: Request): AppUser => {
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
