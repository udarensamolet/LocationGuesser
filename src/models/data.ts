export interface GameDocument {
  title: string;
  status: "draft" | "active" | "closed" | "revealed";
  introduction: string;
  rules: string;
  startDateTime: string | null;
  endDateTime: string | null;
  leaderboardVisible: boolean;
  createdAt: string;
  updatedAt: string;
  secretLocation: string;
  acceptedLocationAnswers: string[];
}

export type GameStatus = "draft" | "active" | "closed" | "revealed";

export type QuestionType = "singleChoice" | "multipleChoice" | "text";

export interface BaseQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  hint?: string;
  unlock: string;
  explanation?: string;
  maxAttempts: number;
  active: boolean;
  order: number;
}

export interface SingleChoiceQuestion extends BaseQuestion {
  type: "singleChoice";
  correctAnswer: string;
  options: string[];
}

export interface MultipleChoiceQuestion extends BaseQuestion {
  type: "multipleChoice";
  correctAnswers: string[];
  options: string[];
}

export interface TextQuestion extends BaseQuestion {
  type: "text";
  acceptedAnswers: string[];
}

export type Question = SingleChoiceQuestion | MultipleChoiceQuestion | TextQuestion;

export interface QuestionsFile {
  questions: Question[];
  version: number;
}

export interface UsersFile {
  users: Array<{
    id: string;
    displayName: string;
    email: string;
    joinedAt: string;
  }>;
}

export interface ProgressFile {
  users: Record<string, ParticipantProgress>;
}

export interface ParticipantProgress {
  userId: string;
  displayName: string;
  email: string;
  startedAt: string;
  currentQuestionId: string | null;
  solvedQuestions: string[];
  attemptsByQuestion: Record<string, number>;
  wrongAnswersByQuestion: Record<string, string[]>;
  hintsUsed: Record<string, boolean>;
  unlockedClues: string[];
  completedAt: string | null;
  finalAnswerAttempts: number;
  finalCorrectAt: string | null;
}

export interface ResultsFile {
  results: Array<GameResult>;
}

export interface GameResult {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  finalGuess: string;
  completedAt: string;
  startedAt: string;
  finalAnswerAttempts: number;
  totalSolved: number;
  totalClues: number;
}

export interface AuditLogEntry {
  at: string;
  adminId: string;
  adminEmail: string;
  action: string;
  details: Record<string, unknown>;
}

export interface AuditLogFile {
  entries: AuditLogEntry[];
}
