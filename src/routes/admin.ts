import { Router } from "express";
import { ANONYMOUS_USER } from "../models/user.js";
import { requireAdmin } from "../middleware/auth.js";
import { AdminService, parseDateForInput } from "../services/adminService.js";

type HttpError = Error & { status: number };

const ensureHttpError = (error: unknown, fallback: string, status = 400): HttpError => {
  if (error instanceof Error) {
    const result = error as HttpError;
    result.status = status;
    return result;
  }
  const result = new Error(fallback) as HttpError;
  result.status = status;
  return result;
};

const createAdminRoutes = (adminService: AdminService): Router => {
  const router = Router();
  router.use("/admin", requireAdmin);

  router.get("/admin", async (req, res, next) => {
    try {
      const [stats, config] = await Promise.all([
        adminService.getDashboardStats(),
        adminService.getGameConfig(),
      ]);

      res.render("layouts/base", {
        title: "Admin dashboard",
        pageTitle: "Admin dashboard",
        content: "pages/admin-dashboard",
        currentUser: req.currentUser,
        stats,
        gameStatus: config.status,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/questions", async (req, res, next) => {
    try {
      const questions = await adminService.listQuestions();
      res.render("layouts/base", {
        title: "Questions",
        pageTitle: "Questions",
        content: "pages/admin-questions",
        currentUser: req.currentUser,
        questions,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/questions/new", (req, res) => {
    res.render("layouts/base", {
      title: "New question",
      pageTitle: "Add question",
      content: "pages/admin-question-form",
      currentUser: req.currentUser,
      question: null,
      questionTypes: ["singleChoice", "multipleChoice", "text"],
      submitAction: "/admin/questions/new",
    });
  });

  router.get("/admin/questions/:id/edit", async (req, res, next) => {
    try {
      const questions = await adminService.listQuestions();
      const question = questions.find((entry) => entry.id === req.params.id);
      if (!question) {
        const error = new Error("Question not found.") as HttpError;
        error.status = 404;
        throw error;
      }

      res.render("layouts/base", {
        title: "Edit question",
        pageTitle: "Edit question",
        content: "pages/admin-question-form",
        currentUser: req.currentUser,
        question,
        questionTypes: ["singleChoice", "multipleChoice", "text"],
        submitAction: `/admin/questions/${question.id}/edit`,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/questions/new", async (req, res, next) => {
    try {
      await adminService.createQuestion(req.currentUser, req.body ?? {});
      res.redirect(303, "/admin/questions");
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/questions/:id/edit", async (req, res, next) => {
    try {
      await adminService.updateQuestion(req.currentUser, req.params.id, req.body ?? {});
      res.redirect(303, `/admin/questions/${req.params.id}/edit`);
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/questions/:id/toggle", async (req, res, next) => {
    try {
      const active = req.body?.active === "false" ? false : true;
      await adminService.toggleQuestionActive(req.currentUser, req.params.id, active);
      res.redirect(303, "/admin/questions");
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/questions/:id/delete", async (req, res, next) => {
    try {
      await adminService.deleteQuestion(req.currentUser, req.params.id, req.body?.confirm);
      res.redirect(303, "/admin/questions");
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/questions/reorder", async (req, res, next) => {
    try {
      await adminService.reorderQuestions(req.currentUser, req.body ?? {});
      res.redirect(303, "/admin/questions");
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/settings", async (req, res, next) => {
    try {
      const config = await adminService.getGameConfig();
      res.render("layouts/base", {
        title: "Settings",
        pageTitle: "Settings",
        content: "pages/admin-settings",
        currentUser: req.currentUser,
        config,
        startDateValue: parseDateForInput(config.startDateTime),
        endDateValue: parseDateForInput(config.endDateTime),
        statuses: ["draft", "active", "closed", "revealed"],
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/settings", async (req, res, next) => {
    try {
      await adminService.updateGameSettings(req.currentUser, req.body ?? {});
      res.redirect(303, "/admin/settings");
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/participants", async (req, res, next) => {
    try {
      const participants = await adminService.listParticipants();
      res.render("layouts/base", {
        title: "Participants",
        pageTitle: "Participants",
        content: "pages/admin-participants",
        currentUser: req.currentUser,
        participants,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/participants/:id", async (req, res, next) => {
    try {
      const participant = await adminService.getParticipantById(req.params.id);
      res.render("layouts/base", {
        title: "Participant detail",
        pageTitle: "Participant detail",
        content: "pages/admin-participant-detail",
        currentUser: req.currentUser,
        participant,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/participants/:id/reset", async (req, res, next) => {
    try {
      await adminService.resetParticipant(req.currentUser, req.params.id, req.body?.confirm);
      res.redirect(303, `/admin/participants/${req.params.id}`);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/leaderboard", async (req, res, next) => {
    try {
      const leaderboard = await adminService.getLeaderboard();
      res.render("layouts/base", {
        title: "Leaderboard",
        pageTitle: "Leaderboard",
        content: "pages/admin-leaderboard",
        currentUser: req.currentUser,
        leaderboard,
        isPublic: false,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/api/leaderboard", async (req, res, next) => {
    try {
      const leaderboard = await adminService.getLeaderboard();
      res.json({ leaderboard });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/leaderboard-public", async (req, res, next) => {
    try {
      const visible = await adminService.getLeaderboardVisible();
      if (!visible) {
        const error = new Error("Leaderboard is not published.") as HttpError;
        error.status = 403;
        throw error;
      }
      const config = await adminService.getGameConfig();
      const leaderboard = await adminService.getLeaderboard();
      res.render("layouts/base", {
        title: config.title,
        pageTitle: "Leaderboard",
        content: "pages/leaderboard",
        currentUser: req.currentUser ?? ANONYMOUS_USER,
        leaderboard,
        isPublic: true,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/archive", async (req, res, next) => {
    try {
      const questions = await adminService.exportQuestions();
      const audit = await adminService.listAuditLog(25);
      res.render("layouts/base", {
        title: "Archive / Export",
        pageTitle: "Archive / Export",
        content: "pages/admin-archive",
        currentUser: req.currentUser,
        questions,
        auditsCount: audit.length,
        audits: audit,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/archive/export/questions", async (req, res, next) => {
    try {
      const questions = await adminService.exportQuestions();
      const fileName = `questions-${new Date().toISOString()}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(questions, null, 2));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/archive/import/questions", async (req, res, next) => {
    try {
      const source = req.body?.payload ?? req.body;
      const parsed = typeof source === "string" ? JSON.parse(source) : source;
      await adminService.importQuestions(req.currentUser, parsed);
      res.redirect(303, "/admin/archive");
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        const validation = ensureHttpError(error, "Invalid JSON.", 400);
        return next(validation);
      }
      next(error as Error);
    }
  });

  router.get("/admin/archive/results.csv", async (req, res, next) => {
    try {
      const csv = await adminService.exportResultsCsv();
      const fileName = `results-${Date.now()}.csv`;
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.send(csv);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/backup", async (req, res, next) => {
    try {
      const payload = await adminService.getBackupPayload();
      const fileName = `game-backup-${Date.now()}.json`;
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/game-reset", async (req, res, next) => {
    try {
      await adminService.resetGame(req.currentUser, req.body?.confirm);
      res.redirect(303, "/admin");
    } catch (error) {
      next(error);
    }
  });

  return router;
};

const createPublicRoutes = (adminService: AdminService): Router => {
  const router = Router();

  router.get("/leaderboard", async (req, res, next) => {
    try {
      const visible = await adminService.getLeaderboardVisible();
      if (!visible) {
        const error = new Error("Leaderboard is not available yet.") as HttpError;
        error.status = 403;
        throw error;
      }

      const config = await adminService.getGameConfig();
      const leaderboard = await adminService.getLeaderboard();
      res.render("layouts/base", {
        title: config.title,
        pageTitle: "Leaderboard",
        content: "pages/leaderboard",
        currentUser: req.currentUser ?? ANONYMOUS_USER,
        leaderboard,
        isPublic: true,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

export { createAdminRoutes, createPublicRoutes, parseDateForInput };
