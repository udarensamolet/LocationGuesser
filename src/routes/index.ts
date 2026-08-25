import { Router } from "express";
import {
  clearSessionCookie,
  createSessionCookie,
  isValidLoginName,
  normalizeLoginName,
} from "../middleware/auth.js";
import { GameService } from "../services/gameService.js";

export const createCoreRoutes = (gameService: GameService) => {
  const router = Router();

  router.get("/login", (req, res) => {
    if (req.currentUser.id !== "anonymous") {
      res.redirect("/");
      return;
    }

    res.render("layouts/base", {
      title: "Log in",
      pageTitle: "Log in to the game",
      content: "pages/login",
      currentUser: req.currentUser,
    });
  });

  router.post("/login", (req, res) => {
    const name = normalizeLoginName(req.body?.name);

    if (!isValidLoginName(name)) {
      res.status(400).render("layouts/base", {
        title: "Log in",
        pageTitle: "Log in to the game",
        content: "pages/login",
        currentUser: req.currentUser,
        message: "Please enter a valid email address.",
      });
      return;
    }

    res.setHeader("Set-Cookie", createSessionCookie(name));
    res.redirect("/");
  });

  router.get("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.redirect("/login");
  });

  router.get("/profile", (req, res) => {
    res.render("layouts/base", {
      title: "My Profile",
      pageTitle: "My Profile",
      content: "pages/profile",
      currentUser: req.currentUser,
    });
  });

  router.get("/", async (req, res) => {
    if (req.currentUser.id === "anonymous") {
      res.render("layouts/base", {
        title: "Log in",
        pageTitle: "Log in to the game",
        content: "pages/login",
        currentUser: req.currentUser,
      });
      return;
    }

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
