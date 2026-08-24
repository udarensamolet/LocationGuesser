import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  AuditLogFile,
  GameDocument,
  GameResult,
  GameStatus,
  MultipleChoiceQuestion,
  ParticipantProgress,
  Question,
  QuestionsFile,
  ProgressFile,
  ResultsFile,
  SingleChoiceQuestion,
  TextQuestion,
  UsersFile,
} from "../models/data.js";
import { JsonFileRepository } from "../repositories/jsonFileRepository.js";

const nowIso = () => new Date().toISOString();

const maybeAccess = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const parseGameDocument = (payload: string): GameDocument | null => {
  try {
    const value = JSON.parse(payload);
    if (!value || typeof value !== "object") {
      return null;
    }
    return value as GameDocument;
  } catch {
    return null;
  }
};

const isDefaultGameDocument = (value: GameDocument | null): boolean => {
  if (!value) return false;
  return (
    value.title === gameDefault.title &&
    value.introduction === gameDefault.introduction &&
    value.rules === gameDefault.rules
  );
};

const seedMissingFile = async (sourcePath: string, targetPath: string): Promise<void> => {
  const shouldSeed = !(await maybeAccess(targetPath));
  if (!shouldSeed) return;
  if (!(await maybeAccess(sourcePath))) return;

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
};

const seedGameFileFromSource = async (sourcePath: string, targetPath: string): Promise<void> => {
  const targetExists = await maybeAccess(targetPath);
  const sourceExists = await maybeAccess(sourcePath);

  if (!sourceExists || sourcePath === targetPath) {
    return;
  }

  if (!targetExists) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    return;
  }

  const [sourceText, targetText] = await Promise.all([
    fs.readFile(sourcePath, "utf8"),
    fs.readFile(targetPath, "utf8"),
  ]);

  const sourceDocument = parseGameDocument(sourceText);
  const targetDocument = parseGameDocument(targetText);
  if (!sourceDocument || !targetDocument) {
    return;
  }

  const targetUsesDefault = isDefaultGameDocument(targetDocument);
  const differsFromSource = sourceDocument.rules !== targetDocument.rules;
  if (targetUsesDefault && differsFromSource) {
    await fs.copyFile(sourcePath, targetPath);
  }
};

const seedDataDirectory = async (sourceDir: string, targetDir: string): Promise<void> => {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    return;
  }

  const fileNames = ["game.json", "questions.json", "users.json", "progress.json", "results.json", "audit-log.json"];

  await Promise.all(
    fileNames.map((fileName) => {
      const sourcePath = path.join(sourceDir, fileName);
      const targetPath = path.join(targetDir, fileName);

      if (fileName === "game.json") {
        return seedGameFileFromSource(sourcePath, targetPath);
      }

      return seedMissingFile(sourcePath, targetPath);
    }),
  );
};

const normalizeStatus = (value: unknown): GameStatus => {
  if (value === "draft" || value === "active" || value === "closed" || value === "revealed") {
    return value;
  }

  return "draft";
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const gameDefault: GameDocument = {
  title: "Location Guessing Game",
  status: "draft",
  introduction:
    "Welcome! Work through the mission and discover the hidden location.",
  rules:
    "Answer each question, use your collected clues, and submit the final location when ready.",
  startDateTime: null,
  endDateTime: null,
  leaderboardVisible: true,
  createdAt: nowIso(),
  updatedAt: nowIso(),
  secretLocation: "[SECRET LOCATION]",
  acceptedLocationAnswers: ["[ANSWER 1]", "[ANSWER 2]"],
};

export const placeholderQuestions: Question[] = [
  {
    id: "q1",
    type: "singleChoice",
    question: "Which city is the headquarters of our company?",
    options: ["Sofia", "Vienna", "Berlin"],
    correctAnswer: "Sofia",
    unlock: "C",
    hint: "Check the onboarding deck for a clue.",
    explanation: "The correct answer reveals the next step to continue.",
    maxAttempts: 3,
    active: true,
    order: 1,
  },
  {
    id: "q2",
    type: "text",
    question: "Where is the company office located?",
    acceptedAnswers: ["Sofia", "Sofia City", "Sofia HQ"],
    unlock: "A",
    hint: "The hint opens after the previous clue is completed.",
    explanation: "The location hint confirms your identifier context.",
    maxAttempts: 4,
    active: true,
    order: 2,
  },
  {
    id: "q3",
    type: "multipleChoice",
    question: "Which two departments are involved in game administration?",
    options: ["People Operations", "Finance", "Engineering", "Marketing"],
    correctAnswers: ["People Operations", "Finance"],
    unlock: "Y",
    hint: "Use the fragments to unlock the key phrase.",
    explanation: "Select both correct departments.",
    maxAttempts: 2,
    active: true,
    order: 3,
  },
  {
    id: "q4",
    type: "singleChoice",
    question: "What is the final clue category for this mission?",
    options: ["People", "Finance", "Operations", "Timeline"],
    correctAnswer: "People",
    unlock: "P",
    hint: "This hint is tied to the final stage.",
    explanation:
      "The final category points to the last step needed to unlock the reveal.",
    maxAttempts: 3,
    active: true,
    order: 4,
  },
  {
    id: "q5",
    type: "text",
    question: "What is the final location answer?",
    acceptedAnswers: ["North Wing", "Operations Hub", "TEAM-5"],
    unlock: "AF",
    hint: "Use the key words from clues to determine the answer.",
    explanation: "This is the final location answer used for completion.",
    maxAttempts: 3,
    active: true,
    order: 5,
  },
];
export const questionsDefault: QuestionsFile = {
  questions: placeholderQuestions,
  version: 1,
};

const usersDefault: UsersFile = {
  users: [],
};

const progressDefault: ProgressFile = {
  users: {},
};

const resultsDefault: ResultsFile = {
  results: [],
};

const auditLogDefault: AuditLogFile = {
  entries: [],
};

export interface DataStore {
  dataDir: string;
  filePaths: {
    game: string;
    questions: string;
    users: string;
    progress: string;
    results: string;
    auditLog: string;
  };
  game: JsonFileRepository<GameDocument>;
  questions: JsonFileRepository<QuestionsFile>;
  users: JsonFileRepository<UsersFile>;
  progress: JsonFileRepository<ProgressFile>;
  results: JsonFileRepository<ResultsFile>;
  auditLog: JsonFileRepository<AuditLogFile>;
}

const normalizeGameDocument = (value: GameDocument): GameDocument => {
  const now = nowIso();
  const accepted = asStringArray((value as GameDocument).acceptedLocationAnswers);

  return {
    ...gameDefault,
    ...value,
    status: normalizeStatus(value.status),
    acceptedLocationAnswers: accepted.length > 0 ? accepted : gameDefault.acceptedLocationAnswers,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
  };
};

const normalizeQuestionsFile = (value: QuestionsFile): QuestionsFile => {
  const normalized = {
    ...value,
    questions: asArrayQuestions(value.questions ?? []),
    version: Number.isFinite(value.version) ? value.version : 1,
  };

  return normalized;
};

const normalizeUsersFile = (value: UsersFile): UsersFile => ({
  users: Array.isArray(value?.users)
    ? value.users
        .map((entry) => ({
          id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : randomUUID(),
          displayName: typeof entry.displayName === "string" ? entry.displayName.trim() : "Participant",
          email: typeof entry.email === "string" ? entry.email.trim().toLowerCase() : "",
          joinedAt: typeof entry.joinedAt === "string" ? entry.joinedAt : nowIso(),
        }))
        .filter((entry) => Boolean(entry.email))
        .filter(
          (entry, index, all) =>
            index === all.findIndex((existing) => existing.id === entry.id),
        )
    : [],
});

const normalizeProgressFile = (value: ProgressFile): ProgressFile => ({
  users: Object.entries(value?.users ?? {}).reduce<Record<string, ParticipantProgress>>(
    (acc, [id, progress]) => {
      if (typeof id !== "string" || !id.trim()) {
        return acc;
      }

      const progressId = id.trim();
      const userId = progress?.userId ?? progressId;
      const normalized: ParticipantProgress = {
        userId,
        displayName: typeof progress?.displayName === "string" ? progress.displayName : "Participant",
        email: typeof progress?.email === "string" ? progress.email : "",
        startedAt: typeof progress?.startedAt === "string" ? progress.startedAt : nowIso(),
        currentQuestionId: typeof progress?.currentQuestionId === "string" ? progress.currentQuestionId : null,
        solvedQuestions: Array.isArray(progress?.solvedQuestions) ? progress.solvedQuestions : [],
        attemptsByQuestion:
          progress?.attemptsByQuestion && typeof progress.attemptsByQuestion === "object"
            ? { ...progress.attemptsByQuestion }
            : {},
        wrongAnswersByQuestion:
          progress?.wrongAnswersByQuestion && typeof progress.wrongAnswersByQuestion === "object"
            ? { ...progress.wrongAnswersByQuestion }
            : {},
        hintsUsed:
          progress?.hintsUsed && typeof progress.hintsUsed === "object" ? { ...progress.hintsUsed } : {},
        unlockedClues: Array.isArray(progress?.unlockedClues) ? progress.unlockedClues : [],
        completedAt: typeof progress?.completedAt === "string" ? progress.completedAt : null,
        finalAnswerAttempts: Number.isFinite(progress?.finalAnswerAttempts)
          ? Math.trunc(progress.finalAnswerAttempts)
          : 0,
        finalCorrectAt: typeof progress?.finalCorrectAt === "string" ? progress.finalCorrectAt : null,
      };

      acc[progressId] = normalized;
      return acc;
    },
    {},
  ),
});

const normalizeResult = (value: GameResult): GameResult => ({
  id: typeof value.id === "string" && value.id.trim() ? value.id : randomUUID(),
  userId: typeof value.userId === "string" && value.userId.trim() ? value.userId : "",
  displayName: typeof value.displayName === "string" ? value.displayName : "Participant",
  email: typeof value.email === "string" ? value.email : "",
  finalGuess: typeof value.finalGuess === "string" ? value.finalGuess : "",
  completedAt: typeof value.completedAt === "string" ? value.completedAt : nowIso(),
  startedAt: typeof value.startedAt === "string" ? value.startedAt : nowIso(),
  finalAnswerAttempts: Number.isFinite(value.finalAnswerAttempts) ? Math.trunc(value.finalAnswerAttempts) : 0,
  totalSolved: Number.isFinite(value.totalSolved) ? Math.max(0, Math.trunc(value.totalSolved)) : 0,
  totalClues: Number.isFinite(value.totalClues) ? Math.max(0, Math.trunc(value.totalClues)) : 0,
});

const normalizeResultsFile = (value: ResultsFile): ResultsFile => ({
  results: Array.isArray(value?.results)
    ? value.results.map(normalizeResult)
    : [],
});

const normalizeSingleChoiceQuestion = (raw: Question, index: number): SingleChoiceQuestion => ({
  id: (typeof raw.id === "string" && raw.id.trim()) ? raw.id.trim() : `q-${index + 1}`,
  type: "singleChoice",
  question: typeof raw.question === "string" ? raw.question : "",
  options: Array.isArray(raw.options)
    ? raw.options.filter((entry) => typeof entry === "string").map((entry) => entry.trim())
    : [],
  correctAnswer:
    typeof (raw as SingleChoiceQuestion).correctAnswer === "string" &&
    (raw as SingleChoiceQuestion).correctAnswer.trim()
      ? (raw as SingleChoiceQuestion).correctAnswer
    : "",
  unlock: typeof raw.unlock === "string" ? raw.unlock : "",
  hint: typeof raw.hint === "string" ? raw.hint : undefined,
  explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
  maxAttempts: Number.isFinite(raw.maxAttempts) && raw.maxAttempts > 0
    ? Math.trunc(raw.maxAttempts)
    : 3,
  active: typeof raw.active === "boolean" ? raw.active : true,
  order: Number.isFinite(raw.order) ? raw.order : index + 1,
});

const normalizeMultipleChoiceQuestion = (raw: Question, index: number): MultipleChoiceQuestion => ({
  id: (typeof raw.id === "string" && raw.id.trim()) ? raw.id.trim() : `q-${index + 1}`,
  type: "multipleChoice",
  question: typeof raw.question === "string" ? raw.question : "",
  options: Array.isArray(raw.options)
    ? raw.options.filter((entry) => typeof entry === "string").map((entry) => entry.trim())
    : [],
  correctAnswers: asStringArray((raw as MultipleChoiceQuestion).correctAnswers),
  unlock: typeof raw.unlock === "string" ? raw.unlock : "",
  hint: typeof raw.hint === "string" ? raw.hint : undefined,
  explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
  maxAttempts: Number.isFinite(raw.maxAttempts) && raw.maxAttempts > 0
    ? Math.trunc(raw.maxAttempts)
    : 3,
  active: typeof raw.active === "boolean" ? raw.active : true,
  order: Number.isFinite(raw.order) ? raw.order : index + 1,
});

const normalizeTextQuestion = (raw: Question, index: number): TextQuestion => ({
  id: (typeof raw.id === "string" && raw.id.trim()) ? raw.id.trim() : `q-${index + 1}`,
  type: "text",
  question: typeof raw.question === "string" ? raw.question : "",
  acceptedAnswers: asStringArray((raw as TextQuestion).acceptedAnswers),
  unlock: typeof raw.unlock === "string" ? raw.unlock : "",
  hint: typeof raw.hint === "string" ? raw.hint : undefined,
  explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
  maxAttempts: Number.isFinite(raw.maxAttempts) && raw.maxAttempts > 0
    ? Math.trunc(raw.maxAttempts)
    : 3,
  active: typeof raw.active === "boolean" ? raw.active : true,
  order: Number.isFinite(raw.order) ? raw.order : index + 1,
});

const asArrayQuestions = (raw: Array<Question>): Question[] =>
  raw.map((item, index) => {
    const resolvedType =
      item.type === "singleChoice" || item.type === "multipleChoice" || item.type === "text"
        ? item.type
        : "singleChoice";

    if (resolvedType === "singleChoice") {
      return normalizeSingleChoiceQuestion(item, index);
    }

    if (resolvedType === "multipleChoice") {
      return normalizeMultipleChoiceQuestion(item, index);
    }

    return normalizeTextQuestion(item, index);
  });

export const createDataStore = (dataDir: string): DataStore => {
  const resolvedDataDir = path.resolve(process.cwd(), dataDir);
  const filePaths = {
    game: path.join(resolvedDataDir, "game.json"),
    questions: path.join(resolvedDataDir, "questions.json"),
    users: path.join(resolvedDataDir, "users.json"),
    progress: path.join(resolvedDataDir, "progress.json"),
    results: path.join(resolvedDataDir, "results.json"),
    auditLog: path.join(resolvedDataDir, "audit-log.json"),
  };

  return {
    dataDir: resolvedDataDir,
    filePaths,
    game: new JsonFileRepository<GameDocument>(filePaths.game, gameDefault),
    questions: new JsonFileRepository<QuestionsFile>(filePaths.questions, questionsDefault),
    users: new JsonFileRepository<UsersFile>(filePaths.users, usersDefault),
    progress: new JsonFileRepository<ProgressFile>(filePaths.progress, progressDefault),
    results: new JsonFileRepository<ResultsFile>(filePaths.results, resultsDefault),
    auditLog: new JsonFileRepository<AuditLogFile>(filePaths.auditLog, auditLogDefault),
  };
};

export const initializeDataStore = async (dataDir: string): Promise<DataStore> => {
  await seedDataDirectory(path.resolve(process.cwd(), "data"), path.resolve(process.cwd(), dataDir));
  const store = createDataStore(dataDir);
  await Promise.all([
    store.game.read(),
    store.questions.read(),
    store.users.read(),
    store.progress.read(),
    store.results.read(),
    store.auditLog.read(),
  ]);

  const game = await store.game.read();
  const normalizedGame = normalizeGameDocument(game);
  if (JSON.stringify(normalizedGame) !== JSON.stringify(game)) {
    await store.game.update(() => normalizedGame);
  }

  const questions = await store.questions.read();
  const normalizedQuestions = normalizeQuestionsFile(questions);
  if (
    normalizedQuestions.questions.length !== questions.questions.length ||
    normalizedQuestions.version !== questions.version
  ) {
    await store.questions.update(() => normalizedQuestions);
  }

  const users = await store.users.read();
  const normalizedUsers = normalizeUsersFile(users);
  if (JSON.stringify(normalizedUsers) !== JSON.stringify(users)) {
    await store.users.update(() => normalizedUsers);
  }

  const progress = await store.progress.read();
  const normalizedProgress = normalizeProgressFile(progress);
  if (JSON.stringify(normalizedProgress) !== JSON.stringify(progress)) {
    await store.progress.update(() => normalizedProgress);
  }

  const results = await store.results.read();
  const normalizedResults = normalizeResultsFile(results);
  if (JSON.stringify(normalizedResults) !== JSON.stringify(results)) {
    await store.results.update(() => normalizedResults);
  }

  return store;
};


