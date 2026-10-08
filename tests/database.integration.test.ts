import { afterAll, describe, expect, test } from "bun:test";
import { database } from "../src/server/db.ts";
import { create as createExecution } from "../src/server/executions.ts";
import { create as createProject, getList as getProjects } from "../src/server/projects.ts";
import { create as createTest, move, update } from "../src/server/tests.ts";

const connectionString = process.env.TEST_DATABASE_URL;
let projectId: string | undefined;
const db = connectionString ? databaseForTest() : null;

function databaseForTest() {
  process.env.DATABASE_URL = connectionString;
  return database();
}

afterAll(async () => {
  if (projectId && db) {
    const tests = await db.test.findMany({ where: { board: { projectId } }, select: { id: true } });
    const testIds = tests.map(({ id }) => id);
    await db.execution.deleteMany({ where: { testId: { in: testIds } } });
    await db.test.deleteMany({ where: { id: { in: testIds } } });
    await db.project.delete({ where: { id: projectId } });
  }
  await db?.$disconnect();
});

describe("Prisma persistence", () => {
  test.skipIf(!connectionString)("creates a project board, versions definitions, and de-duplicates queued runs", async () => {
    if (!db) return;
    const suffix = crypto.randomUUID();
    const project = await createProject({ name: `Probator integration ${suffix}`, url: `https://${suffix}.example.test`, description: "Temporary integration fixture" });
    projectId = project.id;
    const columns = await db.boardColumn.findMany({ where: { board: { projectId } }, orderBy: { position: "asc" } });
    expect(columns.map(({ name }) => name)).toEqual(["Da fare", "In corso", "Completato"]);

    const testCase = await createTest({
      projectId,
      title: "Sign in",
      objective: "Verify the login flow",
      steps: [{ instruction: "Submit valid credentials", completionCondition: "The dashboard is open with a welcome message." }],
      checks: [{ kind: "url_contains", value: "/dashboard" }],
      labels: ["authentication"],
    });
    await move(testCase.id, columns[1].id);
    const secondTest = await createTest({ projectId, title: "Search", steps: [{ instruction: "Search", completionCondition: "Search results are displayed." }] });
    await move(secondTest.id, columns[1].id);
    await move(testCase.id, columns[1].id, 0);
    const ordered = await db.test.findMany({ where: { columnId: columns[1].id }, orderBy: { position: "asc" }, select: { id: true } });
    expect(ordered.map(({ id }) => id)).toEqual([testCase.id, secondTest.id]);

    const first = await createExecution({ testId: testCase.id, mode: "recording", idempotencyKey: "same-attempt" });
    const duplicate = await createExecution({ testId: testCase.id, mode: "recording", idempotencyKey: "same-attempt" });
    expect(duplicate.id).toBe(first.id);
    expect((await db.execution.findUniqueOrThrow({ where: { id: first.id } })).mode).toBe("recording");
    const preview = await db.artifact.create({ data: { executionId: first.id, kind: "screenshot", objectKey: `replay/${first.id}/screenshots/step-0001.jpg`, mimeType: "image/jpeg", sizeBytes: 128n, checksum: "sha256", status: "ready", stepPosition: 0 } });
    await db.project.update({ where: { id: projectId }, data: { previewArtifactId: preview.id } });
    const listedProject = (await getProjects()).find(({ id }) => id === projectId);
    expect(listedProject?.preview_artifact_id).toBe(preview.id);
    expect(listedProject?.preview_execution_id).toBe(first.id);
    expect(listedProject?.preview_status).toBe("ready");

    const edited = await update({
      projectId,
      testId: testCase.id,
      title: "Sign in with valid credentials",
      objective: "Verify the updated login flow",
      steps: [{ instruction: "Submit valid credentials", completionCondition: "The dashboard is open." }],
      checks: [{ kind: "text_visible", value: "Welcome back" }],
      labels: ["authentication", "smoke"],
    });
    const next = await createExecution({ testId: testCase.id, mode: "live", idempotencyKey: "new-attempt" });
    const originalSnapshot = await db.execution.findUniqueOrThrow({ where: { id: first.id } });
    const nextSnapshot = await db.execution.findUniqueOrThrow({ where: { id: next.id } });
    expect(edited.version).toBe(2);
    expect((originalSnapshot.definition as { version: number }).version).toBe(1);
    expect((nextSnapshot.definition as { version: number }).version).toBe(2);
    expect(await db.executionJob.count({ where: { executionId: first.id } })).toBe(1);
  });
});
