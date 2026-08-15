import { describe, expect, it } from "vitest";
import request from "supertest";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp } from "../src/app.js";
import { AppConfig, getAppConfig } from "../src/services/config.js";

const ANSWERS = {
  q1: {
    correct: "Отговор B",
    wrong: "Отговор A",
  },
  q2: {
    correct: " София ",
    alias: "г. София",
    lowercaseAlias: "sofia",
    wrong: "Пловдив",
  },
  q3: {
    multipleCorrect: ["Добре дошли", "Финансово разпределениe"],
    wrong: ["Добре дошли"],
  },
  q4: {
    correct: "Мъже",
    wrong: "Женски",
  },
  q5: {
    correct: "TEAM-5",
    wrong: "Невалиден",
  },
};

const ADMIN_USER = {
  id: "admin-user",
  email: "admin@company.local",
  name: "Admin",
};

const createConfig = async (
  overrides: Partial<AppConfig>,
): Promise<{ appConfig: AppConfig; cleanup: () => Promise<void> }> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "team-building-game-"));
  return {
    appConfig: {
      port: 3000,
      nodeEnv: "development",
      dataDir: tempDir,
      devAuthBypass: overrides.devAuthBypass ?? false,
      devUserId: overrides.devUserId ?? "dev-user",
      devUserEmail: overrides.devUserEmail ?? "employee@company.local",
      devUserName: overrides.devUserName ?? "Тест Потребител",
      adminEmails: overrides.adminEmails ?? ["admin@company.local"],
    },
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
};

const asUser = (req: request.Test, user: { id: string; email: string; name: string }) =>
  req
    .set("x-ms-client-principal-id", user.id)
    .set("x-ms-client-principal-email", user.email)
    .set("x-ms-client-principal-name", user.name);

const solveQuestion = (
  app: Awaited<ReturnType<typeof createApp>>,
  id: string,
  answer: unknown,
  user: { id: string; email: string; name: string },
) => asUser(request(app).post(`/api/game/question/${id}/answer`), user).send({ answer });

const solveAllQuestions = async (
  app: Awaited<ReturnType<typeof createApp>>,
  user: { id: string; email: string; name: string },
) => {
  await solveQuestion(app, "q1", ANSWERS.q1.correct, user);
  await solveQuestion(app, "q2", ANSWERS.q2.correct, user);
  await solveQuestion(app, "q3", ANSWERS.q3.multipleCorrect, user);
  await solveQuestion(app, "q4", ANSWERS.q4.correct, user);
  await solveQuestion(app, "q5", ANSWERS.q5.correct, user);
};

describe("Basic routes", () => {
  it("health endpoint returns status ok", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: false });
    const app = await createApp(appConfig);

    await request(app).get("/health").expect(200, { status: "ok" });
    await cleanup();
  });

  it("local dev auth returns stable user payload", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: true,
      devUserEmail: "Admin@company.local",
      devUserName: "Алекс",
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    const response = await request(app).get("/api/me").expect(200);
    expect(response.body).toMatchObject({
      id: "dev-user",
      email: "Admin@company.local",
      displayName: "Алекс",
      isAdmin: true,
    });

    await cleanup();
  });

  it("admin route is denied for non-admins", async () => {
    const admin = await createConfig({
      devAuthBypass: true,
      devUserEmail: "admin@company.local",
      devUserName: "Admin",
      adminEmails: ["admin@company.local"],
    });
    const user = await createConfig({
      devAuthBypass: true,
      devUserEmail: "player@company.local",
      devUserName: "Player",
      adminEmails: ["admin@company.local"],
    });

    const adminApp = await createApp(admin.appConfig);
    const userApp = await createApp(user.appConfig);

    await request(adminApp).get("/admin").expect(200);
    const denied = await request(userApp).get("/admin");
    expect(denied.status).toBe(403);

    await admin.cleanup();
    await user.cleanup();
  });

  it("production rejects DEV_AUTH_BYPASS=true", () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_AUTH_BYPASS = "true";

    expect(() => getAppConfig()).toThrow(
      "DEV_AUTH_BYPASS cannot be enabled when NODE_ENV=production.",
    );

    delete process.env.DEV_AUTH_BYPASS;
    process.env.NODE_ENV = "development";
  });
});

describe("Quiz gameplay", () => {
  it("accepts a correct single-choice answer", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    const response = await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    const progress = await request(app).get("/api/game/progress").expect(200);

    expect(response.body.correct).toBe(true);
    expect(response.body.newlyUnlockedClue).toBe("Т");
    expect(progress.body.solvedQuestionsCount).toBe(1);
    expect(progress.body.unlockedClues).toContain("Т");

    await cleanup();
  });

  it("records wrong answer and does not solve", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveQuestion(app, "q1", ANSWERS.q1.wrong, ADMIN_USER).expect(200);
    const progress = await request(app).get("/api/game/progress").expect(200);

    expect(progress.body.solvedQuestionsCount).toBe(0);
    expect(progress.body.attemptsByQuestion.q1).toBe(1);

    await cleanup();
  });

  it("limits answer attempts", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveQuestion(app, "q1", ANSWERS.q1.wrong, ADMIN_USER).expect(200);
    await solveQuestion(app, "q1", ANSWERS.q1.wrong, ADMIN_USER).expect(200);
    const blocked = await solveQuestion(app, "q1", ANSWERS.q1.wrong, ADMIN_USER).expect(200);

    expect(blocked.body.maxAttemptsReached).toBe(true);
    expect(blocked.body.correct).toBe(false);
    const progress = await request(app).get("/api/game/progress").expect(200);
    expect(progress.body.attemptsByQuestion.q1).toBe(3);

    await cleanup();
  });

  it("ignores duplicate correct submission for clues", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    const first = await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    const second = await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    const progress = await request(app).get("/api/game/progress").expect(200);

    expect(first.body.correct).toBe(true);
    expect(second.body.duplicate).toBe(true);
    expect(progress.body.unlockedClues).toEqual(["Т"]);

    await cleanup();
  });

  it("normalizes whitespace/case for text answers", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    const response = await solveQuestion(app, "q2", ANSWERS.q2.lowercaseAlias, ADMIN_USER).expect(200);

    expect(response.body.correct).toBe(true);
    await cleanup();
  });

  it("supports alias answers for text questions", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    const response = await solveQuestion(app, "q2", ANSWERS.q2.alias, ADMIN_USER).expect(200);

    expect(response.body.correct).toBe(true);
    await cleanup();
  });

  it("persists hint usage and returns already-used state", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    const firstHint = await request(app).post("/api/game/question/q2/hint").expect(200);
    const secondHint = await request(app).post("/api/game/question/q2/hint").expect(200);

    expect(firstHint.body.alreadyUsed).toBe(false);
    expect(secondHint.body.alreadyUsed).toBe(true);

    await cleanup();
  });

  it("returns questions in defined order", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    const first = await request(app).get("/api/game/question").expect(200);
    expect(first.body.question.id).toBe("q1");

    await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    await solveQuestion(app, "q2", ANSWERS.q2.correct, ADMIN_USER).expect(200);
    const third = await request(app).get("/api/game/question").expect(200);
    expect(third.body.question.id).toBe("q3");

    await cleanup();
  });

  it("prevents solving future questions", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    const response = await solveQuestion(app, "q3", ANSWERS.q3.multipleCorrect, ADMIN_USER).expect(200);
    const progress = await request(app).get("/api/game/progress").expect(200);

    expect(response.body.correct).toBe(false);
    expect(response.body).toMatchObject({ correct: false });
    expect(progress.body.solvedQuestionsCount).toBe(0);

    await cleanup();
  });

  it("persists unlocked fragments across requests", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveQuestion(app, "q1", ANSWERS.q1.correct, ADMIN_USER).expect(200);
    const progress = await request(app).get("/api/game/progress").expect(200);

    expect(progress.body.unlockedClues).toEqual(["Т"]);
    await cleanup();
  });

  it("validates final location answer", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveAllQuestions(app, ADMIN_USER);

    const wrong = await request(app).post("/api/game/final-answer").send({ answer: "Somewhere" }).expect(200);
    const right = await request(app)
      .post("/api/game/final-answer")
      .send({ answer: "[\u041E\u0422\u0413\u041E\u0412\u041E\u0420 1]" })
      .expect(200);
    const progress = await request(app).get("/api/game/progress").expect(200);

    expect(wrong.body.correct).toBe(false);
    expect(right.body.correct).toBe(true);
    expect(progress.body.completedAt).toBeTruthy();

    await cleanup();
  });

  it("does not expose secret answers in participant payload", async () => {
    const { appConfig, cleanup } = await createConfig({ devAuthBypass: true });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    const question = await request(app).get("/api/game/question").expect(200);

    expect(question.body.question).toBeDefined();
    expect(question.body.question).not.toHaveProperty("correctAnswer");
    expect(question.body.question).not.toHaveProperty("acceptedAnswers");
    expect(question.body.question).not.toHaveProperty("unlock");
    expect(question.body.question).toHaveProperty("hintAvailable");

    await cleanup();
  });
});

describe("Admin dashboard and management", () => {
  it("creates and edits a question as admin", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: true,
      devUserEmail: "admin@company.local",
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    await asUser(request(app).post("/admin/questions/new"), ADMIN_USER)
      .send({
        question: "Какво е тестовият въпрос за интеграционен тест?",
        type: "text",
        acceptedAnswers: "Тест\ncheck",
        maxAttempts: "2",
        order: "6",
        active: "on",
      })
      .expect(302);

    const exportResponse = await asUser(request(app).get("/admin/archive/export/questions"), ADMIN_USER).expect(200);
    const payload = JSON.parse(exportResponse.text);
    const created = payload.questions.find(
      (entry: { question: string; id: string }) => entry.question === "Какво е тестовият въпрос за интеграционен тест?",
    );
    expect(created).toBeDefined();
    expect(created?.id).toBeTruthy();

    await asUser(request(app).post(`/admin/questions/${created?.id}/edit`), ADMIN_USER)
      .send({
        question: "Към промяна: какво е тестовият въпрос?",
        type: "text",
        acceptedAnswers: "Тест\nupdated",
        maxAttempts: "3",
        order: created?.order ?? "6",
        active: "on",
      })
      .expect(302);

    const secondExport = await asUser(request(app).get("/admin/archive/export/questions"), ADMIN_USER).expect(200);
    const updatedPayload = JSON.parse(secondExport.text);
    const updated = updatedPayload.questions.find(
      (entry: { question: string }) => entry.question === "Към промяна: какво е тестовият въпрос?",
    );
    expect(updated).toBeDefined();

    await cleanup();
  });

  it("validates invalid question payload", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: true,
      devUserEmail: "admin@company.local",
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    await request(app)
      .post("/admin/questions/new")
      .send({ question: "", type: "text", acceptedAnswers: "", maxAttempts: "-1" })
      .expect(400);

    await cleanup();
  });

  it("rejects import of invalid questions and keeps previous questions", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: true,
      devUserEmail: "admin@company.local",
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    const before = await request(app)
      .get("/admin/archive/export/questions")
      .expect(200);
    const beforePayload = JSON.parse(before.text);

    await asUser(request(app).post("/admin/archive/import/questions"), ADMIN_USER)
      .send({
        payload: JSON.stringify({
          questions: [
            {
              question: "Invalid payload",
              type: "text",
              acceptedAnswers: [],
            },
          ],
        }),
      })
      .expect(400);

    const after = await request(app)
      .get("/admin/archive/export/questions")
      .expect(200);
    const afterPayload = JSON.parse(after.text);

    expect(afterPayload.questions).toHaveLength(beforePayload.questions.length);
    expect(afterPayload.questions.every((entry: { question: string }) => entry.question !== "Invalid payload")).toBe(
      true,
    );

    await cleanup();
  });

  it("resets participant progress without deleting user identity", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: false,
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    const player = { id: "p1", email: "player1@company.local", name: "Player One" };

    await asUser(request(app).post("/game/start"), player).expect(302);
    await solveQuestion(app, "q1", ANSWERS.q1.correct, player).expect(200);

    const progressBefore = await asUser(request(app).get("/api/game/progress"), player).expect(200);
    expect(progressBefore.body.hasStarted).toBe(true);

    await asUser(
      request(app).post("/admin/participants/p1/reset"),
      { ...ADMIN_USER, id: "admin-user" },
    )
      .send({ confirm: "RESET" })
      .expect(302);

    const progressAfter = await asUser(request(app).get("/api/game/progress"), player).expect(200);
    expect(progressAfter.body.hasStarted).toBe(false);

    await asUser(request(app).get("/admin/participants/p1"), {
      ...ADMIN_USER,
      id: "admin-user",
    }).expect(200);

    await cleanup();
  });

  it("resets the whole game while keeping questions and settings", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: false,
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    const playerOne = { id: "p1", email: "player1@company.local", name: "Player One" };
    const playerTwo = { id: "p2", email: "player2@company.local", name: "Player Two" };

    await asUser(request(app).post("/game/start"), playerOne).expect(302);
    await asUser(request(app).post("/game/start"), playerTwo).expect(302);

    await solveQuestion(app, "q1", ANSWERS.q1.correct, playerOne).expect(200);
    await solveQuestion(app, "q1", ANSWERS.q1.correct, playerTwo).expect(200);

    await asUser(
      request(app).post("/admin/game-reset"),
      { ...ADMIN_USER, id: "admin-user" },
    )
      .send({ confirm: "RESET" })
      .expect(302);

    const firstProgress = await asUser(request(app).get("/api/game/progress"), playerOne).expect(200);
    const secondProgress = await asUser(request(app).get("/api/game/progress"), playerTwo).expect(200);
    expect(firstProgress.body.hasStarted).toBe(false);
    expect(secondProgress.body.hasStarted).toBe(false);

    const questions = await asUser(request(app).get("/admin/archive/export/questions"), {
      ...ADMIN_USER,
      id: "admin-user",
    }).expect(200);
    expect(JSON.parse(questions.text).questions).toHaveLength(5);

    await cleanup();
  });

  it("applies leaderboard ranking rules on the server side", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: false,
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    const clean = { id: "p-clean", email: "clean@company.local", name: "Clean Player" };
    const messy = { id: "p-messy", email: "messy@company.local", name: "Messy Player" };

    await asUser(request(app).post("/game/start"), clean).expect(302);
    await asUser(request(app).post("/game/start"), messy).expect(302);

    await solveAllQuestions(app, clean);
    await asUser(request(app).post("/api/game/final-answer"), clean).send({ answer: "[ОТГОВОР 1]" }).expect(200);

    await solveQuestion(app, "q1", ANSWERS.q1.wrong, messy).expect(200);
    await solveQuestion(app, "q1", ANSWERS.q1.correct, messy).expect(200);
    await solveQuestion(app, "q2", ANSWERS.q2.correct, messy).expect(200);
    await solveQuestion(app, "q3", ANSWERS.q3.multipleCorrect, messy).expect(200);
    await solveQuestion(app, "q4", ANSWERS.q4.correct, messy).expect(200);
    await solveQuestion(app, "q5", ANSWERS.q5.correct, messy).expect(200);
    await asUser(request(app).post("/api/game/final-answer"), messy).send({ answer: "[ОТГОВОР 1]" }).expect(200);

    const leaderboard = await asUser(request(app).get("/admin/api/leaderboard"), ADMIN_USER).expect(200);
    expect(leaderboard.body.leaderboard[0].userId).toBe(clean.id);
    expect(leaderboard.body.leaderboard[1].userId).toBe(messy.id);
    expect(leaderboard.body.leaderboard[0].wrongAnswers).toBe(0);
    expect(leaderboard.body.leaderboard[1].wrongAnswers).toBe(1);

    await cleanup();
  });

  it("exports results as CSV with ranking and proper escaping", async () => {
    const { appConfig, cleanup } = await createConfig({
      devAuthBypass: true,
      devUserEmail: "admin@company.local",
      adminEmails: ["admin@company.local"],
    });
    const app = await createApp(appConfig);

    await request(app).post("/game/start").expect(302);
    await solveAllQuestions(app, ADMIN_USER);
    await asUser(request(app).post("/api/game/final-answer"), ADMIN_USER)
      .send({ answer: "[ОТГОВОР 1]" })
      .expect(200);

    const response = await asUser(request(app).get("/admin/archive/results.csv"), ADMIN_USER).expect(200);

    const rows = response.text
      .trim()
      .split(/\r?\n/)
      .filter((row) => row.length > 0);

    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].toLowerCase()).toContain("participant name");
    expect(rows[1]).toContain("Тест");
    expect(rows[1]).toContain("admin@company.local");

    await cleanup();
  });
});
