import { Router } from "express";
import { GameService } from "../services/gameService.js";

export const createCoreRoutes = (gameService: GameService) => {
  const router = Router();

  router.get("/", async (req, res) => {
    const progress = await gameService.getProgressPayload(req.currentUser);

    res.render("layouts/base", {
      title: "Welcome",
      pageTitle: "Location Guessing Game",
      intro:
        "Answer each challenge and uncover the secret location as soon as possible.",
      content: "pages/home",
      currentUser: req.currentUser,
      hasStarted: progress?.hasStarted ?? false,
    });
  });

  router.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/api/me", (req, res) => {
    res.status(200).json(req.currentUser);
  });

  return router;
};
