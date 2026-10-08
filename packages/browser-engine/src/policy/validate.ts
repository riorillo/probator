import { InputError } from "../errors.ts";
import { isRecord } from "../json.ts";

const INVALID = "The TypeSafe answer is not valid; no action was executed.";
const DRIFT = 0.02;
const TOLERANCE = 1e-6;

export type Answer = {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

/** Validates one provider choice against the ids it was allowed to pick from. */
export function validate(answer: unknown, ids: Record<string, unknown>): Answer {
  if (!isRecord(answer)) throw invalid();
  const probabilities = probabilitiesOf(answer.probabilities, ids);
  const confidence = unit(answer.confidence);
  const choice = choiceOf(answer.choice, ids, probabilities);
  return { choice, probabilities, confidence };
}

function probabilitiesOf(value: unknown, ids: Record<string, unknown>): Record<string, number> {
  if (!isRecord(value)) throw invalid();
  const members = Object.keys(value);
  if (!sameMembers(members, Object.keys(ids))) throw invalid();
  const probabilities: Record<string, number> = {};
  for (const member of members) probabilities[member] = unit(value[member]);
  return probabilities;
}

function choiceOf(value: unknown, ids: Record<string, unknown>, probabilities: Record<string, number>): string {
  if (typeof value !== "string" || !Object.hasOwn(ids, value)) throw invalid();
  const scores = Object.values(probabilities);
  if (!(probabilities[value] >= Math.max(...scores) - TOLERANCE)) throw invalid();
  const total = scores.reduce((sum, score) => sum + score, 0);
  if (!(Math.abs(total - 1) < DRIFT)) throw invalid();
  return value;
}

function unit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
  if (value < 0 || value > 1) throw invalid();
  return value;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((member) => right.includes(member));
}

function invalid(): InputError {
  return new InputError(INVALID);
}
