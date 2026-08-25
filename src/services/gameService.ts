import { randomUUID } from "node:crypto";
import {
  AuditLogFile,
  GameDocument,
  GameResult,
  MultipleChoiceQuestion,
  ParticipantProgress,
  ProgressFile,
  QuestionsFile,
  ResultsFile,
  Question,
  SingleChoiceQuestion,
  TextQuestion,
} from "../models/data.js";
import { AppUser } from "../models/user.js";
import { DataStore } from "./dataStore.js";
import { normalizeTextInput } from "../utils/text.js";
type AuditDetails = Record<string, unknown>;

export interface QuestionView {
  id: string;
  type: Question["type"];
  question: string;
  options: string[] | undefined;
  hintAvailable: boolean;
  hint: string | undefined;
  attemptsUsed: number;
  maxAttempts: number;
  attemptsLeft: number;
  hintUsed: boolean;
}

export interface GameProgressPayload {
  hasStarted: boolean;
  startedAt: string | null;
  completedAt: string | null;
  currentQuestionId: string | null;
  solvedQuestionIds: string[];
  attemptsByQuestion: Record<string, number>;
  wrongAnswersByQuestion: Record<string, string[]>;
  hintsUsed: Record<string, boolean>;
  unlockedClues: string[];
  finalAnswerAttempts: number;
  finalCorrectAt: string | null;
  totalQuestions: number;
  solvedQuestionsCount: number;
}

export interface AnswerResult {
  correct: boolean;
  duplicate: boolean;
  maxAttemptsReached: boolean;
  attemptsUsed: number;
  attemptsLeft: number;
  newlyUnlockedClue: string | null;
  message: string;
}

export interface FinalAnswerResult {
  correct: boolean;
  maxAttemptsReached?: boolean;
  attemptsLeft?: number;
  message: string;
  finalTimeMs?: number;
}

const nowIso = () => new Date().toISOString();
const MAX_FINAL_ANSWER_ATTEMPTS = 10;

const normalizeText = (value: unknown): string =>
  normalizeTextInput(typeof value === "string" ? value : "");

const normalizeAnswerList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  return [];
};

const evaluateSingleChoice = (question: SingleChoiceQuestion, answer: unknown): boolean =>
  normalizeText(question.correctAnswer) === normalizeText(answer);

const evaluateMultipleChoice = (
  question: MultipleChoiceQuestion,
  answer: unknown,
): boolean => {
  const submitted = new Set(normalizeAnswerList(answer));
  const expected = new Set(question.correctAnswers.map((value) => normalizeText(value)));

  if (submitted.size !== expected.size) {
    return false;
  }

  for (const value of submitted) {
    if (!expected.has(value)) {
      return false;
    }
  }

  return true;
};

const evaluateText = (question: TextQuestion, answer: unknown): boolean => {
  const expected = question.acceptedAnswers.map((value) => normalizeText(value));
  const submitted = normalizeText(answer);
  return expected.includes(submitted);
};

const isQuestionActive = (question: Question): boolean => question.active;

const sortQuestions = (questions: Question[]): Question[] =>
  [...questions].sort((a, b) => a.order - b.order);

const createFreshProgress = (user: AppUser, firstQuestionId: string | null): ParticipantProgress => ({
  userId: user.id,
  displayName: user.displayName,
  email: user.email.toLowerCase(),
  startedAt: nowIso(),
  currentQuestionId: firstQuestionId,
  solvedQuestions: [],
  attemptsByQuestion: {},
  wrongAnswersByQuestion: {},
  hintsUsed: {},
  unlockedClues: [],
  completedAt: null,
  finalAnswerAttempts: 0,
  finalCorrectAt: null,
});

export class GameService {
  constructor(private readonly store: DataStore) {}

  async getGameConfig(): Promise<GameDocument> {
    return this.store.game.read();
  }

  async getQuestionsFile(): Promise<QuestionsFile> {
    return this.store.questions.read();
  }

  private async readQuestions(): Promise<Question[]> {
    const source = await this.store.questions.read();
    return sortQuestions(source.questions.filter(isQuestionActive));
  }

  async getQuestionCount(): Promise<number> {
    const questions = await this.readQuestions();
    return questions.length;
  }

  private async updateAudit(
    userId: string,
    userEmail: string,
    action: string,
    details: AuditDetails,
  ) {
    await this.store.auditLog.update((file: AuditLogFile): AuditLogFile => ({
      ...file,
      entries: [
        ...file.entries,
        {
          at: nowIso(),
          adminId: userId,
          adminEmail: userEmail,
          action,
          details,
        },
      ],
    }));
  }

  private async upsertUserRecord(user: AppUser) {
    await this.store.users.update((file) => {
      const existingIndex = file.users.findIndex((entry) => entry.id === user.id);
      if (existingIndex >= 0) {
        file.users[existingIndex] = {
          ...file.users[existingIndex],
          id: user.id,
          displayName: user.displayName,
          email: user.email.toLowerCase(),
          joinedAt: file.users[existingIndex].joinedAt ?? nowIso(),
        };
        return file;
      }

      file.users.push({
        id: user.id,
        displayName: user.displayName,
        email: user.email.toLowerCase(),
        joinedAt: nowIso(),
      });
      return file;
    });
  }

  private getOrThrowProgress(file: ProgressFile, userId: string): ParticipantProgress {
    const progress = file.users[userId];
    if (!progress) {
      throw Object.assign(
        new Error("The player has not started the game."),
        { status: 400 },
      );
    }
    return progress;
  }

  private resolveCurrentQuestion(progress: ParticipantProgress, questions: Question[]): Question | null {
    if (progress.currentQuestionId) {
      const explicit = questions.find((question) => question.id === progress.currentQuestionId);
      if (explicit && !progress.solvedQuestions.includes(explicit.id)) {
        return explicit;
      }
    }

    return questions.find((question) => !progress.solvedQuestions.includes(question.id)) ?? null;
  }

  private resolveNextQuestionId(progress: ParticipantProgress, questions: Question[]): string | null {
    const next = questions.find((question) => !progress.solvedQuestions.includes(question.id));
    return next?.id ?? null;
  }

  async startGameForUser(user: AppUser): Promise<ParticipantProgress> {
    await this.upsertUserRecord(user);
    const questions = await this.readQuestions();
    let created = false;

    const state = await this.store.progress.update((file: ProgressFile): ProgressFile => {
      if (file.users[user.id]) {
        return file;
      }

      file.users[user.id] = createFreshProgress(user, questions[0]?.id ?? null);
      created = true;
      return file;
    });

    if (created) {
      await this.updateAudit(
        user.id,
        user.email,
        "game_started",
        { questionCount: questions.length },
      );
    }

    return state.users[user.id];
  }

  async getProgressPayload(user: AppUser): Promise<GameProgressPayload | null> {
    const store = await this.store.progress.read();
    const userProgress = store.users[user.id];
    if (!userProgress) {
      return {
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
        totalQuestions: await this.getQuestionCount(),
        solvedQuestionsCount: 0,
      };
    }

    return {
      hasStarted: true,
      startedAt: userProgress.startedAt,
      completedAt: userProgress.completedAt,
      currentQuestionId: userProgress.currentQuestionId,
      solvedQuestionIds: userProgress.solvedQuestions,
      attemptsByQuestion: userProgress.attemptsByQuestion,
      wrongAnswersByQuestion: userProgress.wrongAnswersByQuestion,
      hintsUsed: userProgress.hintsUsed,
      unlockedClues: userProgress.unlockedClues,
      finalAnswerAttempts: userProgress.finalAnswerAttempts,
      finalCorrectAt: userProgress.finalCorrectAt,
      totalQuestions: await this.getQuestionCount(),
      solvedQuestionsCount: userProgress.solvedQuestions.length,
    };
  }

  async getCurrentQuestion(user: AppUser): Promise<QuestionView | null> {
    const progress = await this.store.progress.read();
    const userProgress = progress.users[user.id];
    if (!userProgress) {
      return null;
    }

    const questions = await this.readQuestions();

    if (
      !userProgress.currentQuestionId &&
      userProgress.solvedQuestions.length === questions.length
    ) {
      return null;
    }

    const current = this.resolveCurrentQuestion(userProgress, questions);
    if (!current) {
      return null;
    }

    const attemptsUsed = userProgress.attemptsByQuestion[current.id] ?? 0;
    const hintUsed = userProgress.hintsUsed[current.id] ?? false;

    return {
      id: current.id,
      type: current.type,
      question: current.question,
      options: current.options,
      hintAvailable: typeof current.hint === "string",
      hint: hintUsed ? current.hint : undefined,
      attemptsUsed,
      maxAttempts: current.maxAttempts,
      attemptsLeft: Math.max(0, current.maxAttempts - attemptsUsed),
      hintUsed,
    };
  }

  async submitAnswer(
    user: AppUser,
    questionId: string,
    answer: unknown,
  ): Promise<AnswerResult> {
    const questions = await this.readQuestions();
    let response: AnswerResult = {
      correct: false,
      duplicate: false,
      maxAttemptsReached: false,
      attemptsUsed: 0,
      attemptsLeft: 0,
      newlyUnlockedClue: null,
      message: "Question not found.",
    };

    await this.store.progress.update((file: ProgressFile): ProgressFile => {
      const progress = this.getOrThrowProgress(file, user.id);
      const target = questions.find((entry) => entry.id === questionId);
      const current = this.resolveCurrentQuestion(progress, questions);

      if (target && progress.solvedQuestions.includes(questionId)) {
        const attemptsUsed = progress.attemptsByQuestion[questionId] ?? 0;
        const maxAttempts = target.maxAttempts;
        response = {
          correct: true,
          duplicate: true,
          maxAttemptsReached: attemptsUsed >= maxAttempts,
          attemptsUsed,
          attemptsLeft: Math.max(0, maxAttempts - attemptsUsed),
          newlyUnlockedClue: null,
          message: "This question is already solved.",
        };
        return file;
      }

      if (!current) {
        response = {
          correct: false,
          duplicate: false,
          maxAttemptsReached: false,
          attemptsUsed: 0,
          attemptsLeft: 0,
          newlyUnlockedClue: null,
          message: "All questions are already solved.",
        };
        return file;
      }

      if (!target || current.id !== questionId) {
        response = {
          correct: false,
          duplicate: false,
          maxAttemptsReached: false,
          attemptsUsed: 0,
          attemptsLeft: 0,
          newlyUnlockedClue: null,
          message: "You do not have access to this question yet.",
        };
        return file;
      }

      const previousAttempts = progress.attemptsByQuestion[questionId] ?? 0;
      const maxAttempts = current.maxAttempts;

      if (progress.solvedQuestions.includes(questionId)) {
        response = {
          correct: true,
          duplicate: true,
          maxAttemptsReached: previousAttempts >= maxAttempts,
          attemptsUsed: previousAttempts,
          attemptsLeft: Math.max(0, maxAttempts - previousAttempts),
          newlyUnlockedClue: null,
          message: "This question is already solved.",
        };
        return file;
      }

      if (previousAttempts >= maxAttempts) {
        response = {
          correct: false,
          duplicate: false,
          maxAttemptsReached: true,
          attemptsUsed: previousAttempts,
          attemptsLeft: 0,
          newlyUnlockedClue: null,
          message: "You have exhausted attempts for this question.",
        };
        return file;
      }

      const attemptsUsed = previousAttempts + 1;
      progress.attemptsByQuestion[questionId] = attemptsUsed;

      let isCorrect = false;
      if (current.type === "singleChoice") {
        isCorrect = evaluateSingleChoice(current, answer);
      } else if (current.type === "multipleChoice") {
        isCorrect = evaluateMultipleChoice(current, answer);
      } else {
        isCorrect = evaluateText(current, answer);
      }

      if (!isCorrect) {
        const normalized = normalizeText(answer);
        progress.wrongAnswersByQuestion[questionId] = [
          ...(progress.wrongAnswersByQuestion[questionId] ?? []),
          normalized || JSON.stringify(answer ?? ""),
        ];
        response = {
          correct: false,
          duplicate: false,
          maxAttemptsReached: attemptsUsed >= maxAttempts,
          attemptsUsed,
          attemptsLeft: Math.max(0, maxAttempts - attemptsUsed),
          newlyUnlockedClue: null,
          message:
            attemptsUsed >= maxAttempts
              ? "Incorrect answer. You have exhausted your attempts."
              : "Incorrect answer. Try again.",
        };
        return file;
      }

      progress.solvedQuestions = [...progress.solvedQuestions, questionId];
      if (current.unlock && !progress.unlockedClues.includes(current.unlock)) {
        progress.unlockedClues = [...progress.unlockedClues, current.unlock];
      }

      progress.currentQuestionId = this.resolveNextQuestionId(progress, questions);

      response = {
        correct: true,
        duplicate: false,
        maxAttemptsReached: false,
        attemptsUsed,
        attemptsLeft: Math.max(0, maxAttempts - attemptsUsed),
        newlyUnlockedClue: current.unlock,
        message: "Correct! Your answer is accepted and you unlocked a new fragment.",
      };
      return file;
    });

    await this.updateAudit(
      user.id,
      user.email,
      "question_answer",
      {
        questionId,
        questionType: "question",
        correct: response.correct,
        duplicate: response.duplicate,
        maxAttemptsReached: response.maxAttemptsReached,
      },
    );

    return response;
  }

  async useHint(user: AppUser, questionId: string): Promise<{ hint: string | null; alreadyUsed: boolean }> {
    const questions = await this.readQuestions();
    let alreadyUsed = false;
    let hint: string | null = null;
    let error: Error | null = null;

    await this.store.progress.update((file: ProgressFile): ProgressFile => {
      try {
        const progress = this.getOrThrowProgress(file, user.id);
        const current = this.resolveCurrentQuestion(progress, questions);

        if (!current) {
          error = new Error("All questions are already solved.");
          return file;
        }

        if (current.id !== questionId) {
          error = new Error("You do not have access to this question.");
          return file;
        }

        if (!current.hint) {
          hint = null;
          return file;
        }

        alreadyUsed = progress.hintsUsed[questionId] ?? false;
        progress.hintsUsed[questionId] = true;
        hint = current.hint;
        return file;
      } catch (err) {
        error = err as Error;
        return file;
      }
    });

    if (error) {
      throw error;
    }

    if (!hint) {
      return { hint: null, alreadyUsed };
    }

    await this.updateAudit(user.id, user.email, "question_hint", { questionId });

    return { hint, alreadyUsed };
  }

  async submitFinalAnswer(user: AppUser, finalAnswer: unknown): Promise<FinalAnswerResult> {
    const game = await this.store.game.read();
    const expected = game.acceptedLocationAnswers.map(normalizeText);
    const normalized = normalizeText(finalAnswer);
    const questions = await this.readQuestions();
    const totalQuestions = questions.length;

    const source = await this.store.progress.read();
    const progress = source.users[user.id];
    if (!progress) {
      return {
        correct: false,
        message: "Please solve all questions first.",
      };
    }

    const unsolved = questions.filter((question) => !progress.solvedQuestions.includes(question.id));
    if (unsolved.length > 0) {
      const error: Error & { status?: number } = Object.assign(
        new Error("Please solve all questions first."),
        { status: 409 },
      );
      throw error;
    }

    let finalCorrect = false;
    let alreadyCompleted = false;
    let maxAttemptsReached = false;
    let finalTimeMs: number | undefined;

    await this.store.progress.update((file: ProgressFile): ProgressFile => {
      const currentProgress = this.getOrThrowProgress(file, user.id);
      if (currentProgress.finalCorrectAt) {
        finalCorrect = true;
        alreadyCompleted = true;
        return file;
      }

      if (currentProgress.finalAnswerAttempts >= MAX_FINAL_ANSWER_ATTEMPTS) {
        maxAttemptsReached = true;
        return file;
      }

      currentProgress.finalAnswerAttempts += 1;

      if (!expected.includes(normalized)) {
        finalCorrect = false;
        return file;
      }

      const now = nowIso();
      currentProgress.finalCorrectAt = now;
      currentProgress.completedAt = now;
      finalCorrect = true;
      finalTimeMs = new Date(now).getTime() - new Date(currentProgress.startedAt).getTime();
      return file;
    });

    if (!finalCorrect) {
      if (alreadyCompleted) {
        return {
          correct: false,
          maxAttemptsReached: false,
          attemptsLeft: 0,
          message: "This mission has already been completed.",
        };
      }

      if (maxAttemptsReached) {
        return {
          correct: false,
          maxAttemptsReached: true,
          attemptsLeft: 0,
          message: `You have reached the maximum number of final attempts (${MAX_FINAL_ANSWER_ATTEMPTS}).`,
        };
      }

      const currentProgress = await this.store.progress.read();
      return {
        correct: false,
        attemptsLeft: Math.max(
          0,
          MAX_FINAL_ANSWER_ATTEMPTS - (currentProgress.users[user.id]?.finalAnswerAttempts ?? 0),
        ),
        message: "That is not the correct answer for the location.",
      };
    }

    const resultSnapshot = await this.store.progress.read();
    const finalProgress = resultSnapshot.users[user.id];
    if (!finalProgress) {
      throw new Error("No active progress was found.");
    }

    if (!alreadyCompleted) {
      const results = await this.store.results.read();
      const exists = results.results.some((entry) => entry.userId === user.id);
      if (!exists) {
        await this.store.results.update((resultsFile: ResultsFile): ResultsFile => ({
          ...resultsFile,
          results: [
            ...resultsFile.results,
            {
              id: randomUUID(),
              userId: user.id,
              displayName: user.displayName,
              email: user.email,
              finalGuess: normalized,
              completedAt: finalProgress.completedAt ?? nowIso(),
              startedAt: finalProgress.startedAt,
              finalAnswerAttempts: finalProgress.finalAnswerAttempts,
              totalSolved: finalProgress.solvedQuestions.length,
              totalClues: finalProgress.unlockedClues.length,
            } satisfies GameResult,
          ],
        }));
      }
    } else if (finalTimeMs === undefined) {
      const results = await this.store.results.read();
      const existing = results.results.find((entry) => entry.userId === user.id);
      if (existing) {
        finalTimeMs =
          new Date(existing.completedAt).getTime() - new Date(existing.startedAt).getTime();
      }
    }

    if (finalTimeMs === undefined) {
      const completedAt = finalProgress.completedAt ?? nowIso();
      finalTimeMs =
        new Date(completedAt).getTime() - new Date(finalProgress.startedAt).getTime();
    }

    await this.updateAudit(user.id, user.email, "final_answer", {
      accepted: finalCorrect,
      attempts: finalProgress?.finalAnswerAttempts ?? 0,
    });

    return {
      correct: true,
      message: "Congratulations — the location has been revealed.",
      finalTimeMs,
    };
  }
}
