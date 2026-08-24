import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AuditLogFile,
  GameDocument,
  GameResult,
  GameStatus,
  MultipleChoiceQuestion,
  ParticipantProgress,
  QuestionsFile,
  ResultsFile,
  SingleChoiceQuestion,
  TextQuestion,
  UsersFile,
  Question,
  QuestionType,
} from "../models/data.js";
import { AppUser } from "../models/user.js";
import { DataStore } from "./dataStore.js";
import { writeJsonFile } from "../utils/jsonFile.js";

const BUSINESS_TIMEZONE = "Europe/Sofia";
const QUESTION_TYPES = ["singleChoice", "multipleChoice", "text"] as const;
const GAME_STATUSES = ["draft", "active", "closed", "revealed"] as const;
const CONFIRM_KEYWORDS = ["CONFIRM", "RESET"];
type QuestionTypeValue = (typeof QUESTION_TYPES)[number];
type GameStatusValue = (typeof GAME_STATUSES)[number];
type HttpError = Error & { status: number };

const toHttpError = (message: string, status: number): HttpError => {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
};

const trim = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "on" || normalized === "true";
  }
  return false;
};

const toPositiveInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const splitList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => trim(entry))
      .filter((entry) => entry.length > 0);
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .map((entry) => entry)
    .filter((entry) => entry.length > 0);
};

const unique = (entries: string[]): string[] => [...new Set(entries)];
const nowIso = () => new Date().toISOString();

const normalizeList = (entries: string[]): string[] =>
  unique(entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0));

const parseDateTimeInput = (value: string): string => {
  if (!value.trim()) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw toHttpError("Invalid date and time.", 400);
  }
  return parsed.toISOString();
};

interface ParsedQuestion {
  type: QuestionTypeValue;
  question: string;
  options: string[];
  acceptedAnswers: string[];
  correctAnswer: string;
  correctAnswers: string[];
  unlock: string;
  hint: string;
  explanation: string;
  maxAttempts: number;
  active: boolean;
  order: number;
}

const toQuestionPayload = (payload: unknown): ParsedQuestion => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw toHttpError("Invalid question data.", 400);
  }

  const values = payload as Record<string, unknown>;
  const rawType = trim(values.type);
  const errors: string[] = [];

  const type = (QUESTION_TYPES.includes(rawType as QuestionTypeValue)
    ? (rawType as QuestionTypeValue)
    : null);
  if (!type) {
    errors.push("Invalid question type.");
  }

  const question = trim(values.question);
  if (!question.length) {
    errors.push("Question text is required.");
  }

  const rawOrder = toPositiveInt(values.order);
  const order = Math.max(1, rawOrder ?? 1);
  const maxAttempts = toPositiveInt(values.maxAttempts) ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    errors.push("Maximum attempts must be a positive number.");
  }

  const options = normalizeList(splitList(values.options));
  const acceptedAnswers = normalizeList(splitList(values.acceptedAnswers));
  const correctAnswer = trim(values.correctAnswer);
  const correctAnswers = normalizeList(splitList(values.correctAnswers));
  const unlock = trim(values.unlock);
  const hint = trim(values.hint);
  const explanation = trim(values.explanation);
  const active = toBoolean(values.active);

  if (type === "singleChoice") {
    if (options.length < 2) {
      errors.push("Single-choice question needs at least 2 options.");
    }
    if (!correctAnswer.length) {
      errors.push("Please provide a correct answer for single-choice.");
    }
    if (correctAnswer.length > 0 && !options.includes(correctAnswer)) {
      errors.push("The selected correct answer must be one of the available options.");
    }
  }

  if (type === "multipleChoice") {
    if (options.length < 2) {
      errors.push("Multiple-choice question needs at least 2 options.");
    }
    if (correctAnswers.length === 0) {
      errors.push("Please provide at least one valid option for multiple-choice.");
    }
    if (correctAnswers.some((entry) => !options.includes(entry))) {
      errors.push("Each correct option must be included in the available options.");
    }
  }

  if (type === "text") {
    if (acceptedAnswers.length === 0) {
      errors.push("Please provide at least one valid answer alias.");
    }
  }

  if (type === null || !errors.length) {
    if (!type) {
      throw toHttpError(errors.join(" "), 400);
    }
  }

  if (type === "singleChoice" && errors.length > 0) {
    throw toHttpError(errors.join(" "), 400);
  }

  if (type === "multipleChoice" && errors.length > 0) {
    throw toHttpError(errors.join(" "), 400);
  }

  if (type === "text" && errors.length > 0) {
    throw toHttpError(errors.join(" "), 400);
  }

  if (errors.length > 0) {
    throw toHttpError(errors.join(" "), 400);
  }

  return {
    type,
    question,
    options,
    acceptedAnswers,
    correctAnswer,
    correctAnswers,
    unlock,
    hint,
    explanation,
    maxAttempts,
    active,
    order,
  };
};

const buildQuestion = (parsed: ParsedQuestion, id: string): Question => {
  if (parsed.type === "singleChoice") {
    return {
      id,
      type: "singleChoice",
      question: parsed.question,
      options: parsed.options,
      correctAnswer: parsed.correctAnswer,
      unlock: parsed.unlock,
      hint: parsed.hint || undefined,
      explanation: parsed.explanation || undefined,
      maxAttempts: parsed.maxAttempts,
      active: parsed.active,
      order: parsed.order,
    } satisfies SingleChoiceQuestion;
  }

  if (parsed.type === "multipleChoice") {
    return {
      id,
      type: "multipleChoice",
      question: parsed.question,
      options: parsed.options,
      correctAnswers: parsed.correctAnswers,
      unlock: parsed.unlock,
      hint: parsed.hint || undefined,
      explanation: parsed.explanation || undefined,
      maxAttempts: parsed.maxAttempts,
      active: parsed.active,
      order: parsed.order,
    } satisfies MultipleChoiceQuestion;
  }

  return {
    id,
    type: "text",
    question: parsed.question,
    acceptedAnswers: parsed.acceptedAnswers,
    unlock: parsed.unlock,
    hint: parsed.hint || undefined,
    explanation: parsed.explanation || undefined,
    maxAttempts: parsed.maxAttempts,
    active: parsed.active,
    order: parsed.order,
  } satisfies TextQuestion;
};

const reorderWithNormalize = (questions: Question[]): Question[] =>
  questions
    .slice()
    .sort((first, second) => first.order - second.order || first.id.localeCompare(second.id))
    .map((question, index) => ({ ...question, order: index + 1 }));

const normalizeDuration = (ms: number | null): string => {
  if (ms === null) {
    return "";
  }
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const toCsvField = (raw: string): string => {
  const safe = raw.replace(/\r?\n/g, " ");
  if (safe.includes(",") || safe.includes("\"") || safe.includes("\n") || safe.includes("\r")) {
    return `"${safe.replace(/"/g, "\"\"")}"`;
  }
  return safe;
};

const toElapsedText = (ms: number | null): string => {
  if (ms === null || Number.isNaN(ms)) {
    return "-";
  }
  return normalizeDuration(ms);
};

const countWrongAnswers = (progress: ParticipantProgress | undefined): number =>
  progress
    ? Object.values(progress.wrongAnswersByQuestion).reduce((sum, values) => sum + values.length, 0)
    : 0;

const countHintsUsed = (progress: ParticipantProgress | undefined): number =>
  progress
    ? Object.values(progress.hintsUsed).filter(Boolean).length
    : 0;

const validateProgress = (value: unknown): value is ParticipantProgress => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ParticipantProgress;
  return (
    typeof candidate.userId === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.startedAt === "string" &&
    Array.isArray(candidate.solvedQuestions)
  );
};

const toLeaderboardDuration = (ms: number | null): string => normalizeDuration(ms);

const normalizeForText = (value: string | null | undefined): string => value ?? "";

interface DashboardStats {
  totalParticipants: number;
  startedParticipants: number;
  completedParticipants: number;
  averageProgress: number;
  totalQuestions: number;
  currentStatus: string;
}

interface ParticipantSummary {
  userId: string;
  displayName: string;
  email: string;
  started: boolean;
  solvedQuestions: number;
  wrongAnswers: number;
  hintsUsed: number;
  completionStatus: "not_started" | "in_progress" | "completed";
  completionTimeMs: number | null;
  completionTime: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  email: string;
  solvedQuestions: number;
  wrongAnswers: number;
  hintsUsed: number;
  elapsedMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  completionStatus: "not_started" | "in_progress" | "completed";
  correctFinal: boolean;
  correctFinalAt: string | null;
  ranking: number;
}

const parseImportPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (
    payload &&
    typeof payload === "object" &&
    "questions" in payload &&
    Array.isArray((payload as { questions: unknown }).questions)
  ) {
    return (payload as { questions: unknown[] }).questions;
  }
  throw toHttpError("Invalid format for import.", 400);
};

export class AdminService {
  constructor(private readonly store: DataStore) {}

  async logAction(admin: AppUser, action: string, details: Record<string, unknown>): Promise<void> {
    await this.store.auditLog.update((file: AuditLogFile): AuditLogFile => ({
      ...file,
      entries: [
        ...file.entries,
        {
          at: nowIso(),
          adminId: admin.id,
          adminEmail: admin.email,
          action,
          details,
        },
      ],
    }));
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const [users, progress, questions, game] = await Promise.all([
      this.store.users.read(),
      this.store.progress.read(),
      this.store.questions.read(),
      this.store.game.read(),
    ]);

    const progressEntries = Object.values(progress.users);
    const total = users.users.length;
    const started = progressEntries.length;
    const completed = progressEntries.filter((entry) => Boolean(entry.completedAt)).length;
    const totalQuestions = questions.questions.length;
    const solvedSum = progressEntries.reduce((sum, entry) => sum + entry.solvedQuestions.length, 0);
    const averageProgress =
      total === 0 || totalQuestions === 0
        ? 0
        : Number((solvedSum / (total * totalQuestions)) * 100).toFixed(2);

    return {
      totalParticipants: total,
      startedParticipants: started,
      completedParticipants: completed,
      averageProgress: Number(averageProgress),
      totalQuestions,
      currentStatus: game.status,
    };
  }

  async listQuestions(): Promise<Question[]> {
    const questions = await this.store.questions.read();
    return reorderWithNormalize(questions.questions);
  }

  async getGameConfig(): Promise<GameDocument> {
    return this.store.game.read();
  }

  async createQuestion(admin: AppUser, payload: unknown): Promise<string> {
    const parsed = toQuestionPayload(payload);
    const source = await this.store.questions.read();
    const ordered = reorderWithNormalize(source.questions);
    const resolvedOrder = Math.min(Math.max(1, parsed.order), ordered.length + 1);

    const nextQuestion = buildQuestion(
      {
        ...parsed,
        order: resolvedOrder,
      },
      randomUUID(),
    );

    const next = reorderWithNormalize(
      ordered.map((entry) => {
        if (entry.order >= resolvedOrder) {
          return {
            ...entry,
            order: entry.order + 1,
          };
        }
        return entry;
      }),
    );

    await this.store.questions.update(() => ({
      ...source,
      questions: reorderWithNormalize([...next, nextQuestion]),
      version: source.version + 1,
    }));

    await this.logAction(admin, "question_create", { questionId: nextQuestion.id, questionType: parsed.type });
    return nextQuestion.id;
  }

  async updateQuestion(admin: AppUser, id: string, payload: unknown): Promise<void> {
    const parsed = toQuestionPayload(payload);
    const source = await this.store.questions.read();
    const withoutTarget = source.questions.filter((question) => question.id !== id);
    if (withoutTarget.length === source.questions.length) {
      throw toHttpError("Question not found.", 404);
    }

    const resolvedOrder = Math.min(Math.max(1, parsed.order), withoutTarget.length + 1);
    const nextQuestion = buildQuestion({ ...parsed, order: resolvedOrder }, id);

    const adjusted = withoutTarget
      .map((question) => {
        if (question.order >= resolvedOrder) {
          return {
            ...question,
            order: question.order + 1,
          };
        }
        return question;
      })
      .concat(nextQuestion);

    await this.store.questions.update(() => ({
      ...source,
      questions: reorderWithNormalize(adjusted),
      version: source.version + 1,
    }));

    await this.logAction(admin, "question_edit", { questionId: id, questionType: parsed.type });
  }

  async toggleQuestionActive(admin: AppUser, id: string, active: boolean): Promise<void> {
    const source = await this.store.questions.read();
    const exists = source.questions.some((question) => question.id === id);
    if (!exists) {
      throw toHttpError("Question not found.", 404);
    }

    await this.store.questions.update(() => ({
      ...source,
      questions: source.questions.map((question) =>
        question.id === id ? { ...question, active } : question,
      ),
      version: source.version + 1,
    }));

    await this.logAction(admin, active ? "question_activate" : "question_deactivate", {
      questionId: id,
      active,
    });
  }

  private hasQuestionInteractions(
    questionId: string,
    progress: Record<string, ParticipantProgress>,
  ): boolean {
    return Object.values(progress).some((entry) => {
      if (!validateProgress(entry)) {
        return false;
      }

      return (
        (entry.attemptsByQuestion?.[questionId] ?? 0) > 0 ||
        entry.solvedQuestions.includes(questionId) ||
        (entry.wrongAnswersByQuestion?.[questionId]?.length ?? 0) > 0 ||
        Boolean(entry.hintsUsed?.[questionId])
      );
    });
  }

  async deleteQuestion(admin: AppUser, id: string, confirmText: unknown): Promise<void> {
    const source = await this.store.questions.read();
    const found = source.questions.find((question) => question.id === id);
    if (!found) {
      throw toHttpError("Question not found!", 404);
    }

    const confirmation = trim(confirmText).toUpperCase();
    if (!CONFIRM_KEYWORDS.includes(confirmation)) {
      throw toHttpError("Deletion requires confirmation.", 400);
    }

    const progress = await this.store.progress.read();
    const hasInteractions = this.hasQuestionInteractions(id, progress.users);

    const remaining = hasInteractions
      ? source.questions.map((question) =>
          question.id === id ? { ...question, active: false } : question,
        )
      : source.questions.filter((question) => question.id !== id);

    await this.store.questions.update(() => ({
      ...source,
      questions: reorderWithNormalize(remaining),
      version: source.version + 1,
    }));

    await this.logAction(admin, hasInteractions ? "question_deactivated_for_safety" : "question_delete", {
      questionId: id,
      reason: hasInteractions ? "has_interactions" : "deleted",
    });
  }

  async reorderQuestions(admin: AppUser, payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw toHttpError("Invalid reorder data.", 400);
    }

    const source = await this.store.questions.read();
    const knownIds = new Set(source.questions.map((question) => question.id));
    const requested: Array<{ id: string; order: number }> = [];

    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (!key.startsWith("order:")) {
        continue;
      }

      const id = key.slice("order:".length);
      if (!knownIds.has(id)) {
        continue;
      }

      const order = toPositiveInt(value);
      if (order === null || order < 1) {
        throw toHttpError("Invalid question order.", 400);
      }
      requested.push({ id, order });
    }

    if (requested.length !== source.questions.length) {
      throw toHttpError("You must provide an order for every question.", 400);
    }

    const expected = new Set(Array.from({ length: source.questions.length }, (_, index) => index + 1));
    const uniqueOrderCount = new Set(requested.map((entry) => entry.order)).size;
    if (uniqueOrderCount !== requested.length) {
      throw toHttpError("Order positions cannot repeat.", 400);
    }
    if (!requested.every((entry) => expected.has(entry.order))) {
      throw toHttpError("Invalid position in ordering.", 400);
    }

    const next = reorderWithNormalize(
      source.questions.map((question) => {
        const change = requested.find((entry) => entry.id === question.id);
        return { ...question, order: change ? change.order : question.order };
      }),
    );

    await this.store.questions.update(() => ({
      ...source,
      questions: next,
      version: source.version + 1,
    }));

    await this.logAction(admin, "questions_reorder", { count: next.length });
  }

  async updateGameSettings(admin: AppUser, payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw toHttpError("Invalid settings data.", 400);
    }

    const values = payload as Record<string, unknown>;
    const title = trim(values.title);
    const introduction = trim(values.introduction);
    const rules = trim(values.rules);
    const secretLocation = trim(values.secretLocation);
    const acceptedLocationAnswers = normalizeList(splitList(values.acceptedLocationAnswers));
    const status = trim(values.status);
    const leaderboardVisible = toBoolean(values.leaderboardVisible);
    const startDateTimeRaw = trim(values.startDateTime);
    const endDateTimeRaw = trim(values.endDateTime);

    const errors: string[] = [];
    if (!title.length) {
      errors.push("Title is required.");
    }
    if (!introduction.length) {
      errors.push("Please enter the introduction text.");
    }
    if (!rules.length) {
      errors.push("Please enter the rules.");
    }
    if (!secretLocation.length) {
      errors.push("Secret location cannot be empty.");
    }
    if (acceptedLocationAnswers.length === 0) {
      errors.push("Provide at least one valid answer alias.");
    }
    if (!GAME_STATUSES.includes(status as GameStatusValue)) {
      errors.push("Choose a valid status.");
    }

    const startDateTime = startDateTimeRaw.length ? parseDateTimeInput(startDateTimeRaw) : null;
    const endDateTime = endDateTimeRaw.length ? parseDateTimeInput(endDateTimeRaw) : null;
    if (startDateTimeRaw.length && Number.isNaN(Date.parse(startDateTimeRaw))) {
      errors.push("Invalid start date/time.");
    }
    if (endDateTimeRaw.length && Number.isNaN(Date.parse(endDateTimeRaw))) {
      errors.push("Invalid end date/time.");
    }
    if (startDateTime && endDateTime && startDateTime > endDateTime) {
      errors.push("Start date/time cannot be later than end date/time.");
    }

    if (errors.length > 0) {
      throw toHttpError(errors.join(" "), 400);
    }

    const game = await this.store.game.read();
    const previousStatus = game.status;
    const next: GameDocument = {
      ...game,
      title,
      introduction,
      rules,
      secretLocation,
      acceptedLocationAnswers,
      startDateTime,
      endDateTime,
      leaderboardVisible,
      status: status as GameStatus,
      updatedAt: nowIso(),
    };

    await this.store.game.update(() => next);
    if (game.status !== status) {
      await this.logAction(admin, "game_status_change", {
        previousStatus: game.status,
        status,
      });
    }

    await this.logAction(admin, "game_settings_update", {
      previousStatus,
      status,
      leaderboardVisible,
    });
  }

  async listParticipants(): Promise<ParticipantSummary[]> {
    const [users, progress] = await Promise.all([
      this.store.users.read(),
      this.store.progress.read(),
    ]);

    const map = new Map<string, ParticipantSummary>();
    for (const user of users.users) {
      map.set(user.id, {
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        started: false,
        solvedQuestions: 0,
        wrongAnswers: 0,
        hintsUsed: 0,
        completionStatus: "not_started",
        completionTimeMs: null,
        completionTime: "-",
        startedAt: null,
        completedAt: null,
      });
    }

    for (const [userId, value] of Object.entries(progress.users)) {
      if (!validateProgress(value)) {
        continue;
      }

      const solvedQuestions = value.solvedQuestions.length;
      const wrongAnswers = countWrongAnswers(value);
      const hintsUsed = countHintsUsed(value);
      const completionTimeMs =
        value.completedAt && value.startedAt
          ? new Date(value.completedAt).getTime() - new Date(value.startedAt).getTime()
          : null;

      map.set(userId, {
        userId,
        displayName: value.displayName,
        email: value.email,
        started: true,
        solvedQuestions,
        wrongAnswers,
        hintsUsed,
        completionStatus: value.completedAt ? "completed" : "in_progress",
        completionTimeMs,
        completionTime: toElapsedText(completionTimeMs),
        startedAt: value.startedAt,
        completedAt: value.completedAt,
      });
    }

    return [...map.values()].sort((first, second) =>
      first.displayName.localeCompare(second.displayName, "bg")
    );
  }

  async getParticipantById(userId: string) {
    const [users, progress, results] = await Promise.all([
      this.store.users.read(),
      this.store.progress.read(),
      this.store.results.read(),
    ]);

    const user = users.users.find((entry) => entry.id === userId);
    const participantProgress = progress.users[userId];
    const result = results.results.find((entry) => entry.userId === userId) ?? null;

    if (!user && !participantProgress) {
      throw toHttpError("Participant not found.", 404);
    }

    return {
      user:
        user ??
        ({
            id: userId,
            displayName: participantProgress?.displayName ?? "Participant",
            email: participantProgress?.email ?? "",
            joinedAt: participantProgress?.startedAt ?? nowIso(),
          } satisfies { id: string; displayName: string; email: string; joinedAt: string }),
      progress: participantProgress ?? null,
      result,
    };
  }

  async resetParticipant(admin: AppUser, userId: string, confirmText: unknown): Promise<void> {
    const confirmation = trim(confirmText).toUpperCase();
    if (!["RESET"].includes(confirmation)) {
      throw toHttpError("Confirm with RESET.", 400);
    }

    const progress = await this.store.progress.read();
    const results = await this.store.results.read();
    const hasProgress = Object.prototype.hasOwnProperty.call(progress.users, userId);
    const hasResult = results.results.some((entry) => entry.userId === userId);

    if (!hasProgress && !hasResult) {
      throw toHttpError("No such participant.", 404);
    }

    await this.store.progress.update((file) => {
      delete file.users[userId];
      return file;
    });
    await this.store.results.update((file: ResultsFile): ResultsFile => ({
      ...file,
      results: file.results.filter((entry) => entry.userId !== userId),
    }));

    await this.logAction(admin, "participant_reset", { userId, mode: "progress_only" });
  }

  async resetGame(admin: AppUser, confirmText: unknown): Promise<void> {
    const confirmation = trim(confirmText).toUpperCase();
    if (!["RESET"].includes(confirmation)) {
      throw toHttpError("Confirm with RESET.", 400);
    }

    await this.store.progress.update(() => ({ users: {} }));
    await this.store.results.update((file: ResultsFile): ResultsFile => ({ ...file, results: [] }));

    await this.logAction(admin, "game_reset", { scope: "all_players", retainConfig: true });
  }

  private getLeaderboardEntries(progressFile: { users: Record<string, ParticipantProgress> }, users: UsersFile) {
    const rows = Object.entries(progressFile.users)
      .filter(([, progress]) => validateProgress(progress))
      .map(([userId, progress]) => {
        const user = users.users.find((entry) => entry.id === userId);
        const solvedQuestions = progress.solvedQuestions.length;
        const wrongAnswers = countWrongAnswers(progress);
        const hintsUsed = countHintsUsed(progress);
        const elapsedMs =
          progress.completedAt && progress.startedAt
            ? new Date(progress.completedAt).getTime() - new Date(progress.startedAt).getTime()
            : progress.startedAt
              ? Date.now() - new Date(progress.startedAt).getTime()
              : null;

        return {
          userId,
          displayName: user?.displayName ?? progress.displayName,
          email: user?.email ?? progress.email,
          solvedQuestions,
          wrongAnswers,
          hintsUsed,
          elapsedMs,
          startedAt: normalizeForText(progress.startedAt),
          completedAt: normalizeForText(progress.completedAt),
          completionStatus: progress.completedAt ? "completed" : "in_progress",
          correctFinal: Boolean(progress.finalCorrectAt),
          correctFinalAt: progress.finalCorrectAt ?? null,
          ranking: 0,
        } satisfies LeaderboardEntry;
      });

    return rows.sort((first, second) => {
      if (first.correctFinal !== second.correctFinal) {
        return first.correctFinal ? -1 : 1;
      }
      if (first.solvedQuestions !== second.solvedQuestions) {
        return second.solvedQuestions - first.solvedQuestions;
      }
      if (first.wrongAnswers !== second.wrongAnswers) {
        return first.wrongAnswers - second.wrongAnswers;
      }
      if (first.hintsUsed !== second.hintsUsed) {
        return first.hintsUsed - second.hintsUsed;
      }

      const elapsedA = first.elapsedMs ?? Number.POSITIVE_INFINITY;
      const elapsedB = second.elapsedMs ?? Number.POSITIVE_INFINITY;
      if (elapsedA !== elapsedB) {
        return elapsedA - elapsedB;
      }

      if (first.correctFinal && second.correctFinal) {
        const correctA = first.correctFinalAt ? new Date(first.correctFinalAt).getTime() : Number.POSITIVE_INFINITY;
        const correctB = second.correctFinalAt ? new Date(second.correctFinalAt).getTime() : Number.POSITIVE_INFINITY;
        if (correctA !== correctB) {
          return correctA - correctB;
        }
      }

      return first.displayName.localeCompare(second.displayName, "bg");
    });
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const [progress, users] = await Promise.all([
      this.store.progress.read(),
      this.store.users.read(),
    ]);
    return this.getLeaderboardEntries(progress, users).map((entry, index) => ({ ...entry, ranking: index + 1 }));
  }

  async getLeaderboardVisible(): Promise<boolean> {
    const game = await this.store.game.read();
    return Boolean(game.leaderboardVisible);
  }

  async exportResultsCsv(): Promise<string> {
    const leaderboard = await this.getLeaderboard();
    const header = [
      "participant name",
      "email",
      "solved questions",
      "wrong answers",
      "hints",
      "started",
      "completed",
      "elapsed time",
      "ranking",
    ];

    const rows = leaderboard.map((entry) => [
      toCsvField(entry.displayName),
      toCsvField(entry.email),
      String(entry.solvedQuestions),
      String(entry.wrongAnswers),
      String(entry.hintsUsed),
      entry.startedAt ?? "",
      entry.completedAt ?? "",
      toLeaderboardDuration(entry.elapsedMs),
      String(entry.ranking),
    ]);

    return [header, ...rows]
      .map((row) => row.join(","))
      .join("\n");
  }

  async exportQuestions(): Promise<QuestionsFile> {
    return this.store.questions.read();
  }

  async importQuestions(admin: AppUser, payload: unknown): Promise<number> {
    const payloadQuestions = parseImportPayload(payload);
    const parsed = payloadQuestions.map((entry, index) => {
      const parsedQuestion = toQuestionPayload({
        ...(entry as Record<string, unknown>),
        order: index + 1,
      });
      return buildQuestion(parsedQuestion, randomUUID());
    });

    const backup = await this.createBackupFile();
    const source = await this.store.questions.read();
    const normalized = parsed.map((question, index) => ({ ...question, order: index + 1 }));

    await this.store.questions.update(() => ({
      ...source,
      questions: normalized,
      version: source.version + 1,
    }));

    await this.logAction(admin, "questions_import", {
      count: normalized.length,
      backup: path.basename(backup),
    });

    return normalized.length;
  }

  async createBackupFile(): Promise<string> {
    const payload = await this.getBackupPayload();
    const directory = path.join(this.store.dataDir, "backups");
    const fileName = `backup-${nowIso().replace(/[:.]/g, "-")}.json`;
    const target = path.join(directory, fileName);
    await writeJsonFile(target, payload);
    return target;
  }

  async getBackupPayload() {
    const [game, questions, users, progress, results, auditLog] = await Promise.all([
      this.store.game.read(),
      this.store.questions.read(),
      this.store.users.read(),
      this.store.progress.read(),
      this.store.results.read(),
      this.store.auditLog.read(),
    ]);

    return { game, questions, users, progress, results, auditLog };
  }

  async getAuditLog(): Promise<AuditLogFile["entries"]> {
    const audit = await this.store.auditLog.read();
    return audit.entries
      .slice()
      .sort((first, second) => new Date(second.at).getTime() - new Date(first.at).getTime());
  }

  async listAuditLog(limit = 50): Promise<AuditLogFile["entries"]> {
    const log = await this.getAuditLog();
    return log.slice(0, limit);
  }
}

export const parseDateForInput = (value: string | null): string => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: BUSINESS_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const text = formatter.format(parsed).replace(" ", "T");
  return text;
};
