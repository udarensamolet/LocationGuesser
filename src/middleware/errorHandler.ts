import { NextFunction, Request, Response } from "express";
import { ANONYMOUS_USER } from "../models/user.js";

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).render("layouts/base", {
    title: "Page not found",
    pageTitle: "Page not found",
    content: "pages/404",
    currentUser: req.currentUser ?? ANONYMOUS_USER,
    statusCode: 404,
    message: "The requested page was not found.",
  });
};

export const errorHandler = (
  err: Error & { statusCode?: number; status?: number },
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const statusCode = err.statusCode ?? err.status ?? 500;
  if (req.path.startsWith("/api/")) {
    res.status(statusCode).json({ error: err.message });
    return;
  }

  res.status(statusCode).render("layouts/base", {
    title: "Error",
    pageTitle: "An unexpected error occurred",
    content: "pages/error",
    currentUser: req.currentUser ?? ANONYMOUS_USER,
    statusCode,
    message: err.message || "Unknown error.",
  });
};
