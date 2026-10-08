import { Prisma } from "@prisma/client";
import { database } from "@/server/db";

export async function getList(projectId: string) {
  const tests = await database().test.findMany({
    where: { board: { projectId } },
    include: { column: { select: { id: true, name: true } }, labels: { include: { label: { select: { name: true, color: true } } } }, executions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, mode: true, createdAt: true } } },
    orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
  });
  return tests.map((test) => ({ id: test.id, title: test.title, objective: test.objective, column_id: test.columnId, column_name: test.column.name, position: test.position, version: test.version, variables: test.variables, labels: test.labels.map(({ label }) => ({ name: label.name, color: label.color })), latest_status: test.executions[0]?.status ?? null, latest_execution_id: test.executions[0]?.id ?? null, latest_mode: test.executions[0]?.mode ?? null, latest_execution_at: test.executions[0]?.createdAt ?? null }));
}

export async function getOne(projectId: string, testId: string) {
  const test = await database().test.findFirst({
    where: { id: testId, board: { projectId } },
    include: { steps: { orderBy: { position: "asc" } }, checks: { orderBy: { position: "asc" } }, labels: { include: { label: { select: { name: true } } } }, executions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, phase: true, mode: true, startedAt: true, createdAt: true, finishedAt: true } } },
  });
  if (!test) return null;
  const latestExecution = test.executions[0];
  return { id: test.id, title: test.title, objective: test.objective, version: test.version, column_id: test.columnId, steps: test.steps, checks: test.checks, variables: test.variables, labels: test.labels.map(({ label }) => label.name), latest_execution: latestExecution ? { id: latestExecution.id, status: latestExecution.status, phase: latestExecution.phase, mode: latestExecution.mode, started_at: latestExecution.startedAt, created_at: latestExecution.createdAt, finished_at: latestExecution.finishedAt } : null };
}

type StepInput = { instruction: string; completionCondition?: string; required?: boolean };
type CheckInput = { kind: "text_visible" | "url_contains"; value: string; required?: boolean };
type VariableInput = { name: string; description?: string; secret?: boolean; defaultValue?: string };

export async function create(input: { projectId: string; title: string; objective?: string; steps?: StepInput[]; checks?: CheckInput[]; labels?: string[]; variables?: VariableInput[] }) {
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error("Test title must contain 1–200 characters.");
  if ((input.steps?.length ?? 0) > 100) throw new Error("A test can contain at most 100 steps.");
  if ((input.checks?.length ?? 0) > 50) throw new Error("A test can contain at most 50 final checks.");
  if (!(input.steps?.length) || input.steps.some((step) => !step.instruction.trim() || !step.completionCondition?.trim())) throw new Error("Each step needs an action and a completion condition.");
  if ((input.checks ?? []).some((check) => !["text_visible", "url_contains"].includes(check.kind) || !check.value.trim())) throw new Error("Final checks need a supported type and a value.");
  return database().$transaction(async (tx) => {
    const board = await tx.board.findUnique({ where: { projectId: input.projectId }, include: { columns: { orderBy: { position: "asc" } } } });
    if (!board) throw new Error("Project not found.");
    const todo = board.columns[0];
    if (!todo) throw new Error("Project board has no columns.");
    const current = await tx.test.aggregate({ where: { columnId: todo.id }, _max: { position: true } });
    const position = (current._max.position ?? -1) + 1;
    const test = await tx.test.create({ data: {
      boardId: board.id,
      columnId: todo.id,
      position,
      title,
      objective: input.objective?.trim() ?? "",
      variables: normalizeVariables(input.variables ?? []),
      steps: { create: (input.steps ?? []).map((step, index) => ({ position: index, instruction: step.instruction.trim(), completionCondition: step.completionCondition!.trim(), required: step.required ?? true })) },
      checks: { create: (input.checks ?? []).map((check, index) => ({ position: index, kind: check.kind, value: check.value.trim(), required: check.required ?? true })) },
    }, select: { id: true } });
    const labels = [...new Set((input.labels ?? []).map((name) => name.trim()).filter(Boolean))];
    await Promise.all(labels.map(async (name) => {
      const label = await tx.label.upsert({ where: { projectId_name: { projectId: input.projectId, name } }, create: { projectId: input.projectId, name }, update: {} });
      await tx.testLabel.create({ data: { testId: test.id, labelId: label.id } });
    }));
    return test;
  });
}

export async function move(testId: string, requestedColumnId: string, requestedPosition?: number) {
  await database().$transaction(async (tx) => {
    const [test, requestedColumn] = await Promise.all([
      tx.test.findUnique({ where: { id: testId }, select: { id: true, boardId: true, columnId: true, position: true } }),
      tx.boardColumn.findUnique({ where: { id: requestedColumnId }, select: { id: true, boardId: true, name: true } }),
    ]);
    if (!test || !requestedColumn || test.boardId !== requestedColumn.boardId) throw new Error("Test and column must belong to the same board.");
    let destinationColumnId = requestedColumn.id;
    if (requestedColumn.id !== test.columnId && requestedColumn.name.trim().toLocaleLowerCase() !== "in corso") {
      const latest = await tx.execution.findFirst({ where: { testId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { status: true } });
      const canonicalName = latest?.status === "running" ? "in corso" : latest?.status === "passed" ? "completato" : "da fare";
      const canonicalColumn = await tx.boardColumn.findFirst({ where: { boardId: test.boardId, name: { equals: canonicalName, mode: "insensitive" } }, select: { id: true } });
      if (canonicalColumn) destinationColumnId = canonicalColumn.id;
    }
    await placeTestInColumn(tx, testId, destinationColumnId, requestedPosition);
  });
}

export async function placeTestInColumn(tx: Prisma.TransactionClient, testId: string, destinationColumnId: string, requestedPosition?: number) {
  const test = await tx.test.findUnique({ where: { id: testId }, select: { id: true, boardId: true, columnId: true } });
  const destination = await tx.boardColumn.findUnique({ where: { id: destinationColumnId }, select: { id: true, boardId: true } });
  if (!test || !destination || test.boardId !== destination.boardId) throw new Error("Test and column must belong to the same board.");
  const source = await tx.test.findMany({ where: { columnId: test.columnId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
  const target = test.columnId === destinationColumnId ? source : await tx.test.findMany({ where: { columnId: destinationColumnId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
  const sourceIds = source.filter((item) => item.id !== testId).map((item) => item.id);
  const targetIds = test.columnId === destinationColumnId ? [...sourceIds] : target.map((item) => item.id);
  const at = Math.max(0, Math.min(requestedPosition ?? targetIds.length, targetIds.length));
  targetIds.splice(at, 0, testId);
  const involved = [...new Set([...source.map((item) => item.id), ...target.map((item) => item.id)])];
  await Promise.all(involved.map((id, index) => tx.test.update({ where: { id }, data: { position: 1_000_000 + index } })));
  if (test.columnId !== destinationColumnId) await tx.test.update({ where: { id: testId }, data: { columnId: destinationColumnId, position: 2_000_000 } });
  if (test.columnId !== destinationColumnId) await Promise.all(sourceIds.map((id, index) => tx.test.update({ where: { id }, data: { position: index } })));
  await Promise.all(targetIds.map((id, index) => tx.test.update({ where: { id }, data: { columnId: destinationColumnId, position: index } })));
}

export async function moveTestAfterExecution(tx: Prisma.TransactionClient, executionId: string, outcome: "passed" | "failed" | "blocked") {
  const execution = await tx.execution.findUnique({ where: { id: executionId }, select: { id: true, testId: true, createdAt: true } });
  if (!execution) return;
  const latest = await tx.execution.findFirst({ where: { testId: execution.testId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  if (latest?.id !== executionId) return;

  const test = await tx.test.findUnique({ where: { id: execution.testId }, select: { id: true, columnId: true, boardId: true } });
  if (!test) return;
  const targetName = outcome === "passed" ? "completato" : "da fare";
  const target = await tx.boardColumn.findFirst({ where: { boardId: test.boardId, name: { equals: targetName, mode: "insensitive" } }, select: { id: true } });
  if (!target || target.id === test.columnId) return;

  await placeTestInColumn(tx, test.id, target.id);
}

const labelPalette = new Set(["#d87986", "#ca8b48", "#b39b3e", "#6b9b66", "#449891", "#5688bc", "#8475b8", "#78849a"]);

export async function updateLabels(testId: string, labels: Array<{ name: string; color: string }>) {
  if (!Array.isArray(labels) || labels.length > 30) throw new Error("A test can have at most 30 labels.");
  const normalized = [...new Map(labels.map(({ name, color }) => {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 48) throw new Error("Label names must contain 1–48 characters.");
    if (!labelPalette.has(color)) throw new Error("Choose a color from the available palette.");
    return [cleanName.toLocaleLowerCase(), { name: cleanName, color }];
  })).values()];

  return database().$transaction(async (tx) => {
    const test = await tx.test.findUnique({ where: { id: testId }, select: { id: true, board: { select: { projectId: true } } } });
    if (!test) throw new Error("Test not found.");
    const links = await Promise.all(normalized.map(async ({ name, color }) => {
      const label = await tx.label.upsert({
        where: { projectId_name: { projectId: test.board.projectId, name } },
        create: { projectId: test.board.projectId, name, color },
        update: { color },
        select: { id: true, name: true, color: true },
      });
      return { testId, labelId: label.id, name: label.name, color: label.color };
    }));
    await tx.testLabel.deleteMany({ where: { testId } });
    if (links.length) await tx.testLabel.createMany({ data: links.map(({ testId: id, labelId }) => ({ testId: id, labelId })) });
    return links.map(({ name, color }) => ({ name, color }));
  });
}

export async function update(input: { projectId: string; testId: string; title: string; objective?: string; steps: StepInput[]; checks?: CheckInput[]; labels?: string[]; variables?: VariableInput[] }) {
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error("Test title must contain 1–200 characters.");
  if (!input.steps.length || input.steps.length > 100 || input.steps.some((step) => !step.instruction.trim() || !step.completionCondition?.trim())) throw new Error("Each step needs an action and a completion condition.");
  if ((input.checks?.length ?? 0) > 50) throw new Error("A test can contain at most 50 final checks.");
  if ((input.checks ?? []).some((check) => !["text_visible", "url_contains"].includes(check.kind) || !check.value.trim())) throw new Error("Final checks need a supported type and a value.");
  return database().$transaction(async (tx) => {
    const existing = await tx.test.findFirst({ where: { id: input.testId, board: { projectId: input.projectId } }, select: { id: true } });
    if (!existing) throw new Error("Test not found.");
    const updated = await tx.test.update({ where: { id: input.testId }, data: {
      title,
      objective: input.objective?.trim() ?? "",
      variables: normalizeVariables(input.variables ?? []),
      version: { increment: 1 },
      steps: { deleteMany: {}, create: input.steps.map((step, index) => ({ position: index, instruction: step.instruction.trim(), completionCondition: step.completionCondition!.trim(), required: step.required ?? true })) },
      checks: { deleteMany: {}, create: (input.checks ?? []).map((check, index) => ({ position: index, kind: check.kind, value: check.value.trim(), required: check.required ?? true })) },
      labels: { deleteMany: {}, create: await Promise.all([...new Set((input.labels ?? []).map((name) => name.trim()).filter(Boolean))].map(async (name) => {
        const label = await tx.label.upsert({ where: { projectId_name: { projectId: input.projectId, name } }, create: { projectId: input.projectId, name }, update: {} });
        return { labelId: label.id };
      })) },
    }, select: { id: true, version: true } });
    return updated;
  });
}

function normalizeVariables(variables: VariableInput[]) {
  if (variables.length > 30) throw new Error("A test can contain at most 30 parameters.");
  const seen = new Set<string>();
  return variables.map((variable) => {
    const name = variable.name.trim();
    if (!/^[a-z][a-zA-Z0-9_]{0,47}$/.test(name) || seen.has(name)) throw new Error("Parameter names must be unique and start with a lowercase letter.");
    seen.add(name);
    return { name, description: variable.description?.trim() ?? name, secret: Boolean(variable.secret), defaultValue: variable.secret ? "" : variable.defaultValue ?? "" };
  });
}
