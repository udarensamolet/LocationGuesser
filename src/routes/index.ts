import { Router } from "express";
import { GameService } from "../services/gameService.js";

export const createCoreRoutes = (gameService: GameService) => {
  const router = Router();

  router.get("/", async (req, res) => {
    const [progress, gameConfig] = await Promise.all([
      gameService.getProgressPayload(req.currentUser),
      gameService.getGameConfig(),
    ]);

    res.render("layouts/base", {
      title: "Welcome",
      pageTitle: "Location Guessing Game",
      intro: gameConfig.introduction,
      rules: gameConfig.rules,
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
