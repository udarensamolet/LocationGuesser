import { NextFunction, Request, Response, RequestHandler } from "express";
import { AppUser, ANONYMOUS_USER } from "../models/user.js";
import { AppConfig } from "../services/config.js";

const isAdminEmail = (email: string, adminEmails: string[]): boolean =>
  adminEmails.includes(email.trim().toLowerCase());

type IdentityFromHeaders = {
  id: string;
  email: string;
  displayName: string;
};

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

const parseMsClientPrincipal = (req: Request): IdentityFromHeaders | null => {
  const encoded = toText(req.header("x-ms-client-principal"));
  if (!encoded) return null;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const payload = JSON.parse(decoded) as {
      userId?: string;
      user_details?: string;
      userDetails?: string;
      claims?: Array<{ typ?: string; val?: string }>;
    };

    const claims = Array.isArray(payload.claims) ? payload.claims : [];
    const claimValue = (type: string) =>
      toText(claims.find((entry) => toText(entry.typ) === type)?.val);

    const email =
      claimValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") ||
      claimValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
      claimValue("preferred_username") ||
      toText(payload.user_details) ||
      toText(payload.userDetails);

    const displayName =
      claimValue("name") ||
      claimValue("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname") ||
      email;

    const id =
      toText(payload.userId) ||
      claimValue("http://schemas.microsoft.com/identity/claims/objectidentifier") ||
      claimValue("sub");

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

  const trustProxyHeaders = (process.env.TRUST_PROXY_IDENTITY_HEADERS ?? "").toLowerCase() === "true";
  if (!trustProxyHeaders) return null;

  const proxyEmail = firstHeader(req, [
    "x-vercel-user-email",
    "x-azure-user-email",
    "x-forwarded-email",
  ]);
  const proxyId = firstHeader(req, [
    "x-vercel-user-id",
    "x-azure-user-id",
    "x-forwarded-user-id",
  ]);
  const proxyName = firstHeader(req, [
    "x-vercel-user-name",
    "x-azure-user-name",
    "x-forwarded-user-name",
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
    if (!principal || !principal.email) {
      return ANONYMOUS_USER;
    }

    return principal;
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
