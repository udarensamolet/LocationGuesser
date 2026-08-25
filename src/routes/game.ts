import { Router } from "express";
import { GameService } from "../services/gameService.js";

const asError = (error: unknown, fallback: string): Error & { status?: number } => {
  if (error instanceof Error) {
    return error as Error & { status?: number };
  }
  const base = new Error(fallback) as Error & { status?: number };
  base.status = 500;
  return base;
};

export const createGameRoutes = (gameService: GameService) => {
  const router = Router();

  router.post("/game/start", async (req, res, next) => {
    try {
      const currentUser = req.currentUser;
      await gameService.startGameForUser(currentUser);
      res.redirect(303, "/game");
    } catch (error) {
      next(asError(error, "Failed to start the game."));
    }
  });

  router.get("/game", async (req, res, next) => {
    try {
      const currentUser = req.currentUser;
      const progress = await gameService.getProgressPayload(currentUser);
      const question = await gameService.getCurrentQuestion(currentUser);
      const totalQuestions = await gameService.getQuestionCount();

      res.status(200).render("layouts/base", {
        title: "Mission",
        pageTitle: "Location Guessing Game",
        content: "pages/game",
        currentUser,
        progress,
        question,
        totalQuestions,
      });
    } catch (error) {
      next(asError(error, "Unable to load the mission."));
    }
  });

  router.get("/api/game/progress", async (req, res, next) => {
    try {
      const payload = await gameService.getProgressPayload(req.currentUser);
      if (!payload) {
        const defaultPayload = {
          hasStarted: false,
          startedAt: null,
          completedAt: null,
          currentQuestionId: null,
          solvedQuestionIds: [],
          attemptsByQuestion: {},
          wrongAnswersByQuestion: {},
          hintsUsed: {},
          unlockedClues: [],
          finalAnswerAttempts: 0,
          finalCorrectAt: null,
          totalQuestions: await gameService.getQuestionCount(),
          solvedQuestionsCount: 0,
        };
        res.json(defaultPayload);
        return;
      }

      res.json(payload);
    } catch (error) {
      next(asError(error, "Unable to read progress."));
    }
  });

  router.get("/api/game/question", async (req, res, next) => {
    try {
      const question = await gameService.getCurrentQuestion(req.currentUser);
      const progress = await gameService.getProgressPayload(req.currentUser);

      if (!question) {
        res.json({
          question: null,
          hasCompleted:
            Boolean(progress?.completedAt) || progress?.solvedQuestionsCount === progress?.totalQuestions,
          solvedQuestionsCount: progress?.solvedQuestionsCount ?? 0,
          totalQuestions: progress?.totalQuestions ?? 0,
          finalStage: Boolean(progress?.completedAt || progress?.solvedQuestionsCount === progress?.totalQuestions),
        });
        return;
      }

      res.json({
        question,
        hasCompleted: false,
        solvedQuestionsCount: progress?.solvedQuestionsCount ?? 0,
        totalQuestions: progress?.totalQuestions ?? 0,
        finalStage: false,
      });
    } catch (error) {
      next(asError(error, "Unable to load a question."));
    }
  });

  router.post("/api/game/question/:id/answer", async (req, res, next) => {
    try {
      const { id } = req.params;
      const { answer } = req.body ?? {};
      const payload = await gameService.submitAnswer(req.currentUser, id, answer);

      const progress = await gameService.getProgressPayload(req.currentUser);
      res.json({ ...payload, progress });
    } catch (error) {
      next(asError(error, "Error while submitting answer."));
    }
  });

  router.post("/api/game/question/:id/hint", async (req, res, next) => {
    try {
      const { id } = req.params;
      const payload = await gameService.useHint(req.currentUser, id);
      res.json(payload);
    } catch (error) {
      next(asError(error, "Error while opening hint."));
    }
  });

  router.post("/api/game/final-answer", async (req, res, next) => {
    try {
      const { answer } = req.body ?? {};
      const payload = await gameService.submitFinalAnswer(req.currentUser, answer);
      const progress = await gameService.getProgressPayload(req.currentUser);
      res.json({ ...payload, progress });
    } catch (error) {
      next(asError(error, "Error while submitting final answer."));
    }
  });

  return router;
};
