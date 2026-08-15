import { NextFunction, Request, Response, RequestHandler } from "express";
import { AppUser, ANONYMOUS_USER } from "../models/user.js";
import { AppConfig } from "../services/config.js";

const isAdminEmail = (email: string, adminEmails: string[]): boolean =>
  adminEmails.includes(email.trim().toLowerCase());

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
    const principalEmail = () => {
      return (
        (req.header("x-ms-client-principal-email") as string | undefined) ??
        (req.header("x-ms-client-principal-name") as string | undefined) ??
        null
      );
    };

    const email = (principalEmail() ?? "").trim();
    if (!email) {
      return ANONYMOUS_USER;
    }

    const id =
      (req.header("x-ms-client-principal-id") as string | undefined) ??
      (req.header("x-ms-client-principal-object-id") as string | undefined) ??
      email;
    const displayName =
      (req.header("x-ms-client-principal-name") as string | undefined) ??
      email;

    return {
      id,
      email,
      displayName,
      isAdmin: isAdminEmail(email, config.adminEmails),
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
