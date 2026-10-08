import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ServerWebSocket } from "bun";
import { Prisma } from "@prisma/client";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { database, transaction } from "../src/server/db.ts";
import { bucket, ensureBucket, storage } from "../src/server/storage.ts";
import { overall } from "../src/domain/evaluation.ts";
import { evaluateStepCompletion } from "../src/server/step-evaluation.ts";
import { recorderBootstrap, recordingEventOrNull } from "../src/domain/recording.ts";
import { retentionSweep } from "./retention.ts";
import { moveTestAfterExecution } from "../src/server/tests.ts";

type RunnerConfig = {
  screenshots: boolean;
  recordingScript?: string;
  decisionAddress?: string;
  decisionCredential?: string;
  decisionIdentity?: string;
  textAddress?: string;
  textCredential?: string;
  textIdentity?: string;
  healAddress?: string;
  healCredential?: string;
  healIdentity?: string;
};
type RunnerSession = {
  setGoal(goal: string): void;
  drainRecordingEvents(): Promise<unknown[]>;
  captureScreenshot(): Promise<string | null>;
  snapshot(): unknown;
  run(): AsyncGenerator<unknown>;
  close(): Promise<void>;
};
type UserRecorder = {
  observe(): Promise<{ url: string; title: string; text: string; actions: unknown[]; screenshot?: string }>;
  drainEvents(): Promise<unknown[]>;
  startFrameStream(onFrame: (frame: Uint8Array) => void): Promise<() => Promise<void>>;
  click(x: number, y: number): Promise<Record<string, unknown>>;
  type(text: string): Promise<Record<string, unknown> | null>;
  key(key: string): Promise<Record<string, unknown> | null>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};
type UserRecording = { recorder: UserRecorder; lastFrameAt: number; pendingFill: Record<string, unknown> | null; pendingFillAt: number; stopFrameStream?: () => Promise<void> };
type RecordingSocket = ServerWebSocket<{ recordingId: string }>;
type RunnerModule = { open(url: string, goal: string, config: RunnerConfig): Promise<RunnerSession>; openRecorder(url: string): Promise<UserRecorder> };
const runnerModule = import("@probator/browser-engine") as Promise<RunnerModule>;

type Definition = {
  testId: string;
  title: string;
  objective: string;
  version: number;
  steps: Array<{ id: string; position: number; instruction: string; completionCondition: string; required: boolean }>;
  checks: Array<{ id: string; position: number; kind: "text_visible" | "url_contains"; value: string; required: boolean }>;
  variables?: Array<{ name: string; secret?: boolean }>;
};
type Job = { id: string; effective_url: string; mode: "live" | "recording"; project_id: string; definition: Definition; parameters: Record<string, string> };
type PageView = { url?: string; title?: string; text?: string };
type RunView = { status?: string; page?: PageView; history?: unknown[]; decisions?: unknown[] };

const workerId = process.env.PROBATOR_WORKER_ID || `worker-${process.pid}`;
const stepTimeout = Number(process.env.RUNNER_STEP_TIMEOUT_MS || 90_000);
const recorderBundle = await readFile(new URL("../public/rrweb.bundle.js", import.meta.url), "utf8");
let nextRetentionSweep = 0;
let stopping = false;
let recordingPollActive = false;
const userRecorders = new Map<string, UserRecording>();
const recordingSockets = new Map<string, Set<RecordingSocket>>();
const latestRecordingFrames = new Map<string, Uint8Array>();
const streamCommandQueues = new Map<string, Promise<void>>();
const streamActionQueues = new Map<string, Promise<void>>();
let stopRecordingStreamServer: (() => void) | null = null;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  startRecordingStreamServer();
  console.log(`Probator worker ${workerId} is polling.`);
  void pollRecordings();
  while (!stopping) {
    try {
      await blockStale();
      if (Date.now() >= nextRetentionSweep) {
        nextRetentionSweep = Date.now() + 60 * 60_000;
        try { await retentionSweep(); }
        catch (error) { console.error(`Artifact maintenance failed: ${safeMessage(error)}`); }
      }
      const job = await claim();
      if (!job) { await Bun.sleep(1_000); continue; }
      try { await execute(job); }
      catch (error) { await fail(job.id, safeMessage(error)); }
    } catch (error) {
      console.error(`Worker polling failed: ${safeMessage(error)}`);
      await Bun.sleep(5_000);
    }
  }
  for (const [id, current] of userRecorders) {
    await database().flowRecording.updateMany({ where: { id, status: { in: ["starting", "recording"] } }, data: { status: "cancelled", error: null } });
    await closeUserRecording(id, current.recorder);
  }
  stopRecordingStreamServer?.();
  await database().$disconnect();
}

async function pollRecordings() {
  while (!stopping) {
    if (!recordingPollActive) {
      recordingPollActive = true;
      try { await processRecordings(); }
      catch (error) { console.error(`Interactive recording poll failed: ${safeMessage(error)}`); }
      finally { recordingPollActive = false; }
    }
    await Bun.sleep(250);
  }
}

async function processRecordings() {
  const db = database();
  const queued = await db.flowRecording.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: 2 });
  for (const row of queued) await startUserRecording(row.id, row.effectiveUrl);
  for (const [id, current] of userRecorders) await processUserRecording(id, current.recorder, current);
}

async function startUserRecording(id: string, url: string) {
  const claimed = await database().flowRecording.updateMany({ where: { id, status: "queued" }, data: { status: "starting", workerId } });
  if (!claimed.count) return;
  try {
    const recorder = await (await runnerModule).openRecorder(url);
    const current: UserRecording = { recorder, lastFrameAt: 0, pendingFill: null, pendingFillAt: 0 };
    userRecorders.set(id, current);
    try { current.stopFrameStream = await recorder.startFrameStream((frame) => broadcastRecordingFrame(id, frame)); }
    catch (error) { console.warn(`Live frame streaming unavailable for ${id}: ${safeMessage(error)}`); }
    const activated = await database().flowRecording.updateMany({ where: { id, status: "starting" }, data: { status: "recording", heartbeatAt: new Date() } });
    if (!activated.count) {
      await closeUserRecording(id, recorder);
      return;
    }
    await appendRecordingEvents(id, [{ action: "recording_started", url: originOf(url) }]);
  } catch (error) {
    await database().flowRecording.updateMany({ where: { id, status: "starting" }, data: { status: "failed", error: safeMessage(error), heartbeatAt: new Date() } });
  }
}

async function processUserRecording(id: string, recorder: UserRecorder, current: UserRecording) {
  const row = await database().flowRecording.findUnique({ where: { id }, select: { status: true } });
  if (!row || ["stopped", "failed", "cancelled"].includes(row.status)) {
    await closeUserRecording(id, recorder);
    return;
  }
  if (row.status === "stopping") {
    try {
      await streamActionQueues.get(id);
      const pending = await database().recordingCommand.findMany({ where: { recordingId: id, status: "pending" }, orderBy: { sequence: "asc" }, take: 50 });
      for (const command of pending) await runRecordingCommand(id, command, recorder, current);
      await flushPendingFill(id, current);
      const page = await recorder.observe();
      await appendRecordingEvents(id, [{ action: "final_state", url: page.url, title: page.title, text: page.text.slice(0, 12_000), elements: page.actions.slice(0, 80) }, ...await recorder.drainEvents()]);
      await saveRecordingFrame(id, page.screenshot);
      await database().flowRecording.update({ where: { id }, data: { status: "stopped", heartbeatAt: new Date() } });
    } catch (error) {
      await database().flowRecording.update({ where: { id }, data: { status: "failed", error: safeMessage(error), heartbeatAt: new Date() } });
    } finally { await closeUserRecording(id, recorder); }
    return;
  }
  if (row.status !== "recording") return;

  const commands = await database().recordingCommand.findMany({ where: { recordingId: id, status: "pending" }, orderBy: { sequence: "asc" }, take: 8 });
  for (const command of commands) await runRecordingCommand(id, command, recorder, current);
  if (current.pendingFill && Date.now() - current.pendingFillAt >= 700) await flushPendingFill(id, current);
  await appendRecordingEvents(id, await recorder.drainEvents());

  if (!current.stopFrameStream && Date.now() - current.lastFrameAt >= 1_000) {
    const page = await recorder.observe();
    await saveRecordingFrame(id, page.screenshot);
    current.lastFrameAt = Date.now();
  }
  await database().flowRecording.update({ where: { id }, data: { heartbeatAt: new Date() } });
}

async function runRecordingCommand(recordingId: string, command: { id: string; sequence: number; kind: string; payload: unknown }, recorder: UserRecorder, current: UserRecording): Promise<boolean> {
  const claimed = await database().recordingCommand.updateMany({ where: { id: command.id, status: { in: ["pending", "stream_queued"] } }, data: { status: "running" } });
  if (!claimed.count) return false;
  try {
    const payload = record(command.payload);
    if (command.kind !== "type") await flushPendingFill(recordingId, current);
    let action: Record<string, unknown> | null = null;
    if (command.kind === "click") action = await recorder.click(Number(payload.x), Number(payload.y));
    else if (command.kind === "type") action = await recorder.type(String(payload.text ?? ""));
    else if (command.kind === "key") action = await recorder.key(String(payload.key ?? ""));
    else if (command.kind === "scroll") {
      const x = Number(payload.x);
      const y = Number(payload.y);
      const deltaX = Number(payload.deltaX);
      const deltaY = Number(payload.deltaY);
      action = await recorder.scroll(x, y, deltaX, deltaY);
    }
    else throw new Error("Unsupported browser input.");
    if (action) {
      const event = { ...action, commandSequence: command.sequence };
      if (command.kind === "type") {
        const previousSequences = Array.isArray(current.pendingFill?.commandSequences) ? current.pendingFill.commandSequences : [];
        current.pendingFill = { ...event, commandSequences: [...previousSequences, command.sequence] };
        current.pendingFillAt = Date.now();
      } else await appendRecordingEvents(recordingId, [event]);
    }
    await database().recordingCommand.update({ where: { id: command.id }, data: { status: "done", payload: {}, finishedAt: new Date() } });
    return true;
  } catch (error) {
    await database().recordingCommand.update({ where: { id: command.id }, data: { status: "failed", payload: {}, error: safeMessage(error), finishedAt: new Date() } });
    return false;
  }
}

async function flushPendingFill(recordingId: string, current: UserRecording) {
  if (!current.pendingFill) return;
  await appendRecordingEvents(recordingId, [current.pendingFill]);
  current.pendingFill = null;
  current.pendingFillAt = 0;
}

async function appendRecordingEvents(recordingId: string, values: unknown[]) {
  const events = values.map(record).filter((item) => Object.keys(item).length > 0);
  if (!events.length) return;
  await transaction(async (client) => {
    const current = await client.recordingEvent.aggregate({ where: { recordingId }, _max: { sequence: true } });
    const start = (current._max.sequence ?? 0) + 1;
    await client.recordingEvent.createMany({ data: events.map((payload, index) => ({ recordingId, sequence: start + index, kind: String(payload.action ?? "interaction").slice(0, 48), payload: payload as Prisma.InputJsonValue })) });
  });
}

async function saveRecordingFrame(recordingId: string, image: string | undefined) {
  if (!image) return;
  const key = `recordings/${recordingId}/live/latest.jpg`;
  await ensureBucket();
  await storage().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: Buffer.from(image, "base64"), ContentType: "image/jpeg" }));
  await database().flowRecording.update({ where: { id: recordingId }, data: { frameObjectKey: key, frameUpdatedAt: new Date(), heartbeatAt: new Date() } });
}

async function closeUserRecording(id: string, recorder: UserRecorder) {
  const state = userRecorders.get(id);
  await streamActionQueues.get(id);
  await state?.stopFrameStream?.().catch(() => undefined);
  userRecorders.delete(id);
  const current = [...recordingSockets.get(id) ?? []];
  for (const socket of current) socket.close(1000, "Recording ended");
  recordingSockets.delete(id);
  latestRecordingFrames.delete(id);
  streamCommandQueues.delete(id);
  streamActionQueues.delete(id);
  await recorder.close().catch(() => undefined);
}

function startRecordingStreamServer() {
  const port = Number(process.env.PROBATOR_STREAM_PORT || 3001);
  const server = Bun.serve<{ recordingId: string }>({
    hostname: "127.0.0.1",
    port,
    fetch(request, server) {
      const match = new URL(request.url).pathname.match(/^\/recordings\/([0-9a-f-]{36})$/i);
      if (request.headers.get("upgrade") !== "websocket" || !match) return new Response("Not found", { status: 404 });
      if (!server.upgrade(request, { data: { recordingId: match[1] } })) return new Response("Upgrade failed", { status: 400 });
      return undefined;
    },
    websocket: {
      open(socket) {
        const sockets = recordingSockets.get(socket.data.recordingId) ?? new Set<RecordingSocket>();
        sockets.add(socket);
        recordingSockets.set(socket.data.recordingId, sockets);
        const latest = latestRecordingFrames.get(socket.data.recordingId);
        if (latest) socket.send(latest);
      },
      message(socket, message) {
        if (typeof message !== "string") return;
        let request: Record<string, unknown>;
        try { request = record(JSON.parse(message)); } catch { return; }
        if (request.type !== "command" || typeof request.requestId !== "string" || typeof request.kind !== "string") return;
        const recordingId = socket.data.recordingId;
        const pending = streamCommandQueues.get(recordingId) ?? Promise.resolve();
        const next = pending.then(() => dispatchStreamCommand(socket, recordingId, request)).catch((error) => {
          socket.send(JSON.stringify({ type: "command_ack", requestId: request.requestId, ok: false, error: safeMessage(error) }));
        });
        streamCommandQueues.set(recordingId, next);
      },
      close(socket) {
        const sockets = recordingSockets.get(socket.data.recordingId);
        sockets?.delete(socket);
        if (sockets?.size === 0) recordingSockets.delete(socket.data.recordingId);
      },
    },
  });
  stopRecordingStreamServer = () => server.stop(true);
  console.log(`Interactive browser stream listening on 127.0.0.1:${port}.`);
}

function broadcastRecordingFrame(recordingId: string, frame: Uint8Array) {
  latestRecordingFrames.set(recordingId, frame);
  for (const socket of recordingSockets.get(recordingId) ?? []) {
    if (socket.readyState === WebSocket.OPEN && socket.getBufferedAmount() < 1_000_000) socket.send(frame);
  }
}

async function dispatchStreamCommand(socket: RecordingSocket, recordingId: string, request: Record<string, unknown>) {
  const requestId = String(request.requestId);
  const kind = String(request.kind);
  const payload = normalizeStreamPayload(kind, record(request.payload));
  if (!payload) {
    socket.send(JSON.stringify({ type: "command_ack", requestId, ok: false, error: "Comando browser non supportato." }));
    return;
  }
  const current = userRecorders.get(recordingId);
  if (!current) {
    socket.send(JSON.stringify({ type: "command_ack", requestId, ok: false, error: "Sessione browser non attiva." }));
    return;
  }
  const command = await transaction(async (client) => {
    const recording = await client.flowRecording.findUnique({ where: { id: recordingId }, select: { status: true, commandSequence: true } });
    if (!recording || recording.status !== "recording") throw new Error("La registrazione non è attiva.");
    const sequence = recording.commandSequence + 1;
    await client.flowRecording.update({ where: { id: recordingId }, data: { commandSequence: sequence } });
    return client.recordingCommand.create({ data: { recordingId, sequence, kind, payload: payload as Prisma.InputJsonValue, status: "stream_queued" } });
  });
  // Confirm once queued so the UI can continue accepting input while the worker
  // applies this command in order. Persisting the completed action can take
  // several database round trips and must not hold up the next keystroke.
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "command_ack", requestId, ok: true }));
  const previous = streamActionQueues.get(recordingId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const completed = await runRecordingCommand(recordingId, command, current.recorder, current);
    if (!completed && socket.readyState === WebSocket.OPEN) {
      const failure = await database().recordingCommand.findUnique({ where: { id: command.id }, select: { error: true } });
      socket.send(JSON.stringify({ type: "command_error", requestId, error: failure?.error ?? "Comando browser non completato." }));
    }
  }).catch((error) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "command_error", requestId, error: safeMessage(error) }));
  });
  streamActionQueues.set(recordingId, next);
}

function normalizeStreamPayload(kind: string, payload: Record<string, unknown>) {
  const point = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1120;
  if (kind === "click" && point(payload.x) && point(payload.y) && Number(payload.y) <= 780) return { x: payload.x, y: payload.y };
  if (kind === "type" && typeof payload.text === "string" && payload.text.length > 0 && payload.text.length <= 2000) return { text: payload.text };
  if (kind === "key" && ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "].includes(String(payload.key))) return { key: payload.key };
  if (kind === "scroll" && point(payload.x) && point(payload.y) && Number(payload.y) <= 780 && typeof payload.deltaX === "number" && Math.abs(payload.deltaX) <= 2000 && typeof payload.deltaY === "number" && Math.abs(payload.deltaY) <= 2000) return { x: payload.x, y: payload.y, deltaX: payload.deltaX, deltaY: payload.deltaY };
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function claim(): Promise<Job | null> {
  return transaction(async (client) => {
    const [row] = await client.$queryRaw<Job[]>(Prisma.sql`SELECT e.id, e.effective_url, e.mode, b.project_id, e.definition, e.parameters FROM execution_jobs j JOIN executions e ON e.id = j.execution_id JOIN tests t ON t.id = e.test_id JOIN boards b ON b.id = t.board_id
       WHERE e.phase = 'queued' AND j.available_at <= now() ORDER BY j.available_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
    if (!row) return null;
    await client.executionJob.update({ where: { executionId: row.id }, data: { claimedBy: workerId, claimedAt: new Date(), attempts: { increment: 1 } } });
    await client.execution.update({ where: { id: row.id }, data: { phase: "starting", startedAt: new Date(), heartbeatAt: new Date() } });
    await event(client, row.id, "starting", { workerId });
    return row;
  });
}

async function execute(job: Job) {
  const definition = job.definition;
  const secretValues = (definition.variables ?? []).filter((variable) => variable.secret).map((variable) => job.parameters[variable.name]).filter((value): value is string => Boolean(value));
  let session: RunnerSession | null = null;
  const events: Array<Record<string, unknown>> = [];
  let recordingSequence = 0;
  let recordedEventCount = 0;
  let lastLiveFrameAt = 0;
  let liveFrameSequence = 0;
  const drainRecording = async () => {
    if (!session) return;
    const events = (await session.drainRecordingEvents()).map(recordingEventOrNull).filter((event) => event !== null);
    recordedEventCount += events.length;
    let chunk: unknown[] = [];
    let chunkBytes = 2;
    const flush = async () => {
      if (!chunk.length) return;
      const body = Buffer.from(JSON.stringify(chunk));
      const key = `replay/${job.id}/rrweb/chunk-${String(++recordingSequence).padStart(6, "0")}.json`;
      await putArtifact(job.id, key, "rrweb_chunk", "application/json", body);
      chunk = [];
      chunkBytes = 2;
    };
    for (const event of events) {
      const bytes = Buffer.byteLength(JSON.stringify(event)) + 1;
      if (chunk.length >= 250 || chunkBytes + bytes > 512_000) await flush();
      chunk.push(event);
      chunkBytes += bytes;
    }
    await flush();
  };
  const stepOutcomes: Array<{ step: Definition["steps"][number]; observed: string; status: "passed" | "failed" | "blocked"; error?: string }> = [];
  let finished = false;
  try {
    await setPhase(job.id, "executing", "browser_starting", { url: originOf(job.effective_url) });
    const config: RunnerConfig = {
      screenshots: true,
      decisionAddress: process.env.RUNNER_DECISION_URL,
      decisionCredential: process.env.RUNNER_DECISION_KEY,
      decisionIdentity: process.env.RUNNER_DECISION_MODEL,
      textAddress: process.env.RUNNER_TEXT_URL,
      textCredential: process.env.RUNNER_TEXT_KEY,
      textIdentity: process.env.RUNNER_TEXT_MODEL,
      healAddress: process.env.RUNNER_HEAL_URL,
      healCredential: process.env.RUNNER_HEAL_KEY,
      healIdentity: process.env.RUNNER_HEAL_MODEL,
      recordingScript: recorderBootstrap(recorderBundle),
    };
    session = await openWithin(job.effective_url, definition.steps[0].instruction, config);
    const activeSession = session;
    await drainRecording();
    for (const step of definition.steps) {
      await heartbeat(job.id);
      await appendEvent(job.id, "step_started", { position: step.position });
      const actionOffset = ((activeSession.snapshot() as RunView).history ?? []).length;
      let loggedActionCount = actionOffset;
      activeSession.setGoal(goal(step, job.parameters));
      const last = await withTimeout(runGoal(activeSession, async (progress) => {
        const current = progress as RunView;
        await heartbeat(job.id);
        await appendEvent(job.id, "agent_progress", { position: step.position, agentStatus: current.status ?? "running", actionCount: current.history?.length ?? 0, decisionCount: current.decisions?.length ?? 0, observedOrigin: originOf(current.page?.url ?? "") });
        const actionHistory = current.history ?? [];
        for (const action of actionHistory.slice(loggedActionCount)) await appendEvent(job.id, "action_logged", { position: step.position, action: actionSummary(action, secretValues) });
        loggedActionCount = Math.max(loggedActionCount, actionHistory.length);
        if (job.mode === "live") await saveLiveFrame(job.id, job.project_id, step.position, activeSession, false, () => lastLiveFrameAt, (value) => { lastLiveFrameAt = value; }, () => ++liveFrameSequence);
        await drainRecording();
      }), stepTimeout, `Step ${step.position + 1} timed out.`);
      const view = last as RunView;
      await drainRecording();
      if (job.mode === "live") await saveLiveFrame(job.id, job.project_id, step.position, activeSession, true, () => lastLiveFrameAt, (value) => { lastLiveFrameAt = value; }, () => ++liveFrameSequence);
      const observedPage = safePage(view.page);
      events.push({ kind: "step_finished", step: step.position, status: view.status, page: observedPage, actionCount: view.history?.length ?? 0, decisionCount: view.decisions?.length ?? 0 });
      let outcome: (typeof stepOutcomes)[number];
      try {
        const evaluation = await evaluateStepCompletion({
          objective: definition.objective,
          instruction: step.instruction,
          condition: step.completionCondition,
          actions: redact((view.history ?? []).slice(actionOffset), secretValues) as unknown[],
          page: redact(view.page, secretValues) as PageView | undefined,
        });
        outcome = { step, observed: evaluation.explanation, status: evaluation.reached ? "passed" : "failed" };
        await appendEvent(job.id, "step_evaluated", { position: step.position, status: outcome.status, explanation: evaluation.explanation, evaluator: evaluation.model });
      } catch (error) {
        const explanation = error instanceof Error ? error.message : "Il modello non ha potuto valutare la condizione.";
        outcome = { step, observed: explanation, status: "blocked", error: explanation };
        await appendEvent(job.id, "step_evaluated", { position: step.position, status: "blocked", explanation });
      }
      stepOutcomes.push(outcome);
      await saveStepResult(job.id, outcome);
      await appendEvent(job.id, "step_finished", { position: step.position, status: outcome.status, observation: observedPage });
      if (outcome.status !== "passed" && step.required) break;
    }
    await setPhase(job.id, "evaluating", "evaluating", { completedSteps: stepOutcomes.length });
    const finalPage = (session.snapshot() as RunView).page;
    const checkOutcomes: Array<{ check: Definition["checks"][number]; observed: string; status: "passed" | "failed" | "blocked"; error?: string }> = definition.checks.map((check) => {
      const candidate = check.kind === "url_contains" ? finalPage?.url ?? "" : finalPage?.text ?? "";
      const passed = candidate.toLocaleLowerCase().includes(check.value.toLocaleLowerCase());
      const observed = check.kind === "url_contains" ? passed ? "Configured URL fragment matched." : "Configured URL fragment did not match." : passed ? "Configured exact text was visible." : "Configured exact text was not visible.";
      return { check, observed, status: passed ? "passed" as const : "failed" as const, ...(passed ? {} : { error: `Expected ${check.kind === "url_contains" ? "URL fragment" : "visible text"} was not observed.` }) };
    });
    if (definition.checks.some((check) => check.required) && stepOutcomes.some((step) => step.status !== "passed")) {
      checkOutcomes.forEach((check) => { check.status = "blocked"; check.error = "Final checks were not run because a required step did not pass."; });
    }
    const outcome = overall(
      definition.steps.map((step) => ({ required: step.required, status: stepOutcomes.find((result) => result.step.id === step.id)?.status })),
      definition.checks.map((check) => ({ required: check.required, status: checkOutcomes.find((result) => result.check.id === check.id)?.status })),
    );
    const evidence = { executionId: job.id, url: originOf(job.effective_url), definitionVersion: definition.version, steps: stepOutcomes.map(({ step, observed, status, error }) => ({ position: step.position, completionCondition: step.completionCondition, observed, status, error })), checks: checkOutcomes.map(({ check, observed, status, error }) => ({ position: check.position, expected: check.value, observed, status, error })), events, finalPage: safePage(finalPage), finishedAt: new Date().toISOString() };
    await drainRecording();
    if (job.mode === "recording" && recordedEventCount === 0) throw new Error("rrweb did not produce a recorder event; the recording is incomplete.");
    await saveManifest(job.id, { version: 1, recorder: "rrweb", capture: { textMasked: false, inputsMasked: false, blockedSelectors: [], crossOriginIframes: true, canvas: true, fonts: true, stylesheets: true }, status: recordedEventCount ? "complete" : "partial", eventCount: recordedEventCount, chunkCount: recordingSequence, finishedAt: new Date().toISOString() });
    await saveEvidence(job.id, evidence);
    await transaction(async (client) => {
      await Promise.all(stepOutcomes.map(({ step, observed, status, error }) => client.stepResult.upsert({
        where: { executionId_position: { executionId: job.id, position: step.position } },
        create: { executionId: job.id, stepId: step.id, position: step.position, completionCondition: step.completionCondition, observed, status, errorDetail: error },
        update: { observed, status, errorDetail: error },
      })));
      await Promise.all(checkOutcomes.map(({ check, observed, status, error }) => client.checkResult.upsert({
        where: { executionId_position: { executionId: job.id, position: check.position } },
        create: { executionId: job.id, checkId: check.id, position: check.position, expected: check.value, observed, status, errorDetail: error },
        update: { observed, status, errorDetail: error },
      })));
      await client.execution.update({ where: { id: job.id }, data: { status: outcome, phase: "finished", finishedAt: new Date(), heartbeatAt: new Date() } });
      await moveTestAfterExecution(client, job.id, outcome);
      await client.executionJob.deleteMany({ where: { executionId: job.id } });
      await event(client, job.id, "finished", { status: outcome, stepCount: stepOutcomes.length, checkCount: checkOutcomes.length });
    });
    finished = true;
  } finally {
    try {
      if (!finished) {
        await drainRecording();
        await saveManifest(job.id, { version: 1, recorder: "rrweb", capture: { textMasked: false, inputsMasked: false, blockedSelectors: [], crossOriginIframes: true, canvas: true, fonts: true, stylesheets: true }, status: "partial", eventCount: recordedEventCount, chunkCount: recordingSequence, finishedAt: new Date().toISOString() });
      }
    } finally {
      await session?.close().catch(() => undefined);
    }
  }
}

function goal(step: Definition["steps"][number], parameters: Record<string, string>): string {
  return `Perform this single test action: ${interpolate(step.instruction, parameters)}. Stop after attempting the requested action. The step completion condition will be evaluated separately from your DONE status.`;
}

function interpolate(template: string, parameters: Record<string, string>): string {
  return template.replace(/\{\{([a-z][a-zA-Z0-9_]*)\}\}/g, (_, name: string) => parameters[name] ?? `{{${name}}}`);
}

async function runGoal(session: RunnerSession, onProgress: (view: unknown) => Promise<void>): Promise<unknown> {
  let latest: unknown = session.snapshot();
  for await (const view of session.run()) { latest = view; await onProgress(view); }
  return latest;
}

async function saveEvidence(executionId: string, document: unknown) {
  const body = Buffer.from(JSON.stringify(document, null, 2));
  const key = `replay/${executionId}/logs/trace.json`;
  const checksum = createHash("sha256").update(body).digest("hex");
  await database().artifact.upsert({ where: { executionId_objectKey: { executionId, objectKey: key } }, create: { executionId, kind: "trace", objectKey: key, mimeType: "application/json", sizeBytes: BigInt(body.byteLength), checksum, status: "pending" }, update: { status: "pending" } });
  try {
    await ensureBucket();
    await storage().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: "application/json", Metadata: { sha256: checksum } }));
    await database().artifact.update({ where: { executionId_objectKey: { executionId, objectKey: key } }, data: { status: "ready" } });
  } catch (error) {
    await database().artifact.update({ where: { executionId_objectKey: { executionId, objectKey: key } }, data: { status: "error" } });
    throw new Error(`Could not persist execution evidence: ${safeMessage(error)}`);
  }
}

async function saveManifest(executionId: string, document: unknown) {
  const body = Buffer.from(JSON.stringify(document, null, 2));
  await putArtifact(executionId, `replay/${executionId}/manifest.json`, "manifest", "application/json", body);
}

async function saveLiveFrame(executionId: string, projectId: string, position: number, session: RunnerSession, force: boolean, lastAt: () => number, setLastAt: (value: number) => void, nextSequence: () => number) {
  if (!force && Date.now() - lastAt() < 2_500) return;
  setLastAt(Date.now());
  try {
    const screenshot = await session.captureScreenshot();
    if (!screenshot) {
      await appendEvent(executionId, "frame_unavailable", { position });
      return;
    }
    const key = `replay/${executionId}/screenshots/frame-${String(nextSequence()).padStart(6, "0")}.jpg`;
    const artifact = await putArtifact(executionId, key, "screenshot", "image/jpeg", Buffer.from(screenshot, "base64"), position);
    await database().project.updateMany({ where: { id: projectId }, data: { previewArtifactId: artifact.id } });
  } catch {
    await appendEvent(executionId, "frame_unavailable", { position });
  }
}

async function putArtifact(executionId: string, key: string, kind: string, mimeType: string, body: Buffer, stepPosition?: number) {
  const checksum = createHash("sha256").update(body).digest("hex");
  const where = { executionId_objectKey: { executionId, objectKey: key } };
  const artifact = await database().artifact.upsert({ where, create: { executionId, kind, objectKey: key, mimeType, sizeBytes: BigInt(body.byteLength), checksum, status: "pending", stepPosition }, update: { kind, mimeType, sizeBytes: BigInt(body.byteLength), checksum, status: "pending", stepPosition } });
  try {
    await ensureBucket();
    await storage().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mimeType, Metadata: { sha256: checksum } }));
    await database().artifact.update({ where, data: { status: "ready" } });
    return artifact;
  } catch (error) {
    await database().artifact.update({ where, data: { status: "error" } });
    throw new Error(`Could not persist execution artifact: ${safeMessage(error)}`);
  }
}

function safePage(page: PageView | undefined) {
  return { url: originOf(page?.url ?? "") };
}

function originOf(value: string) {
  try { return new URL(value).origin; }
  catch { return ""; }
}

function actionSummary(value: unknown, secrets: string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { action: String(value) };
  const entry = value as Record<string, unknown>;
  const fields = ["step", "action", "kind", "operation", "target", "text", "page_changed", "elapsed_ms", "healed", "heal_reason"];
  return redact(Object.fromEntries(fields.filter((field) => field in entry).map((field) => [field, entry[field]])), secrets) as Record<string, unknown>;
}

function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return secrets.reduce((safe, secret) => secret ? safe.replaceAll(secret, "[segreto]") : safe, value);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]));
  return value;
}

async function setPhase(id: string, phase: string, kind: string, payload: unknown) {
  await transaction(async (client) => {
    await client.execution.update({ where: { id }, data: { phase, heartbeatAt: new Date() } });
    await event(client, id, kind, payload);
  });
}

async function heartbeat(id: string) { await database().execution.update({ where: { id }, data: { heartbeatAt: new Date() } }); }
async function appendEvent(id: string, kind: string, payload: unknown) { await transaction((client) => event(client, id, kind, payload)); }

async function saveStepResult(executionId: string, outcome: { step: Definition["steps"][number]; observed: string; status: "passed" | "failed" | "blocked"; error?: string }) {
  const { step, observed, status, error } = outcome;
  await database().stepResult.upsert({
    where: { executionId_position: { executionId, position: step.position } },
    create: { executionId, stepId: step.id, position: step.position, completionCondition: step.completionCondition, observed, status, errorDetail: error },
    update: { completionCondition: step.completionCondition, observed, status, errorDetail: error },
  });
}

async function event(client: import("@prisma/client").Prisma.TransactionClient, id: string, kind: string, payload: unknown) {
  const latest = await client.runEvent.aggregate({ where: { executionId: id }, _max: { sequence: true } });
  await client.runEvent.create({ data: { executionId: id, sequence: (latest._max.sequence ?? 0) + 1, kind, payload: payload as Prisma.InputJsonValue } });
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer!); }
}

async function openWithin(url: string, goal: string, config: RunnerConfig): Promise<RunnerSession> {
  const pending = runnerModule.then((runner) => runner.open(url, goal, config));
  try { return await withTimeout(pending, stepTimeout, "Browser startup timed out."); }
  catch (error) {
    void pending.then((session) => session.close(), () => undefined);
    throw error;
  }
}

async function fail(id: string, message: string) {
  await transaction(async (client) => {
    const updated = await client.execution.updateMany({ where: { id, phase: { not: "finished" } }, data: { status: "blocked", phase: "finished", finishedAt: new Date(), error: message, heartbeatAt: new Date() } });
    if (!updated.count) return;
    await moveTestAfterExecution(client, id, "blocked");
    await client.executionJob.deleteMany({ where: { executionId: id } });
    await event(client, id, "blocked", { message });
  });
  console.error(`Execution ${id} blocked: ${message}`);
}

async function blockStale() {
  await transaction(async (client) => {
    const staleBefore = new Date(Date.now() - 2 * 60_000);
    const stale = await client.execution.findMany({ where: { status: "running", phase: { not: "queued" }, heartbeatAt: { lt: staleBefore } }, select: { id: true } });
    await client.flowRecording.updateMany({ where: { status: { in: ["starting", "recording", "stopping"] }, heartbeatAt: { lt: staleBefore } }, data: { status: "failed", error: "La sessione di registrazione è scaduta: il worker non risponde." } });
    await Promise.all(stale.map(async ({ id }) => {
      await client.execution.update({ where: { id }, data: { status: "blocked", phase: "finished", finishedAt: new Date(), error: "Worker heartbeat expired; browser action was not retried." } });
      await moveTestAfterExecution(client, id, "blocked");
      await client.executionJob.deleteMany({ where: { executionId: id } });
      await event(client, id, "blocked", { message: "Worker heartbeat expired; browser action was not retried." });
    }));
  });
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unexpected worker error.";
}

await main();
