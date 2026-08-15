export const normalizeTextInput = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export const normalizeAnswers = (value: string): string =>
  normalizeTextInput(value);