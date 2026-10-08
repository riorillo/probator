import { randomUUID } from "node:crypto";
import { database } from "@/server/db";
import { placeTestInColumn } from "@/server/tests";

export async function create(input: { testId: string; mode: "live" | "recording"; idempotencyKey?: string; parameters?: Record<string, string> }) {
  const db = database();
  const key = input.idempotencyKey?.trim() || randomUUID();
  return db.$transaction(async (tx) => {
    const existing = await tx.execution.findUnique({ where: { testId_idempotencyKey: { testId: input.testId, idempotencyKey: key } }, select: { id: true, status: true, phase: true } });
    if (existing) return existing;
    const test = await tx.test.findUnique({ where: { id: input.testId }, include: { steps: { orderBy: { position: "asc" } }, checks: { orderBy: { position: "asc" } }, board: { include: { project: true } } } });
    if (!test) throw new Error("Test not found.");
    if (!test.steps.length) throw new Error("Add at least one step before starting a test.");
    const variables = Array.isArray(test.variables) ? test.variables as Array<{ name: string; defaultValue?: string; secret?: boolean }> : [];
    const parameters = Object.fromEntries(variables.map((variable) => {
      const provided = input.parameters?.[variable.name];
      const value = typeof provided === "string" ? provided : variable.defaultValue ?? "";
      if (!value.trim()) throw new Error(`Inserisci un valore per il parametro “${variable.name}”.`);
      return [variable.name, value];
    }));
    const definition = { testId: test.id, title: test.title, objective: test.objective, version: test.version, steps: test.steps, checks: test.checks, variables };
    const execution = await tx.execution.create({ data: {
      testId: test.id,
      mode: input.mode,
      status: "running",
      phase: "queued",
      definition,
      parameters,
      effectiveUrl: test.board.project.url,
      idempotencyKey: key,
      job: { create: {} },
      events: { create: { sequence: 1, kind: "queued", payload: { phase: "queued" } } },
    }, select: { id: true, status: true, phase: true } });
    const inProgress = await tx.boardColumn.findFirst({ where: { boardId: test.boardId, name: { equals: "in corso", mode: "insensitive" } }, select: { id: true } });
    if (inProgress && test.columnId !== inProgress.id) await placeTestInColumn(tx, test.id, inProgress.id);
    return execution;
  });
}

export async function getList(projectId: string, options: { limit?: number; cursor?: string; testId?: string } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const list = await database().execution.findMany({
    where: { test: { board: { projectId }, ...(options.testId ? { id: options.testId } : {}) } },
    include: { test: { select: { title: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = list.length > limit;
  const rows = list.slice(0, limit);
  return { items: rows.map((run) => ({ id: run.id, test_id: run.testId, title: run.test.title, mode: run.mode, status: run.status, phase: run.phase, started_at: run.startedAt, finished_at: run.finishedAt, created_at: run.createdAt })), nextCursor: hasMore ? rows.at(-1)?.id ?? null : null };
}

export async function get(id: string) {
  const run = await database().execution.findUnique({
    where: { id },
    include: {
      test: { select: { title: true, board: { select: { projectId: true, project: { select: { name: true } } } } } },
      stepResults: { orderBy: { position: "asc" } },
      checkResults: { orderBy: { position: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { sequence: "asc" } },
    },
  });
  if (!run) return null;
  const definition = run.definition as { title: string; version: number; steps: unknown[]; checks: unknown[] };
  return {
    id: run.id, test_id: run.testId, project_id: run.test.board.projectId, project_name: run.test.board.project.name, test_title: run.test.title, mode: run.mode, status: run.status, phase: run.phase, definition,
    environment: run.environment, effective_url: safeOrigin(run.effectiveUrl), started_at: run.startedAt, finished_at: run.finishedAt, error: run.error,
    steps: run.stepResults.map((item) => ({ id: item.id, step_id: item.stepId, position: item.position, completion_condition: item.completionCondition, observed: item.observed, status: item.status, error_detail: item.errorDetail })),
    checks: run.checkResults.map((item) => ({ id: item.id, check_id: item.checkId, position: item.position, expected: item.expected, observed: item.observed, status: item.status, error_detail: item.errorDetail })),
    artifacts: run.artifacts.map((item) => ({ id: item.id, kind: item.kind, mime_type: item.mimeType, size_bytes: item.sizeBytes === null ? null : Number(item.sizeBytes), checksum: item.checksum, status: item.status, step_position: item.stepPosition, created_at: item.createdAt })),
    events: run.events.map((item) => ({ sequence: item.sequence, kind: item.kind, payload: item.payload, created_at: item.createdAt })),
  };
}

function safeOrigin(value: string) {
  try { return new URL(value).origin; }
  catch { return ""; }
}
