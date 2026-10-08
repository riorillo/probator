import { database } from "@/server/db";

export async function getList(search = "") {
  const db = database();
  const projects = await db.project.findMany({
    where: search.trim() ? { OR: [{ name: { contains: search.trim(), mode: "insensitive" } }, { url: { contains: search.trim(), mode: "insensitive" } }] } : undefined,
    include: {
      previewArtifact: { select: { id: true, executionId: true, status: true } },
      board: {
        include: {
          tests: {
            select: {
              id: true,
              executions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  return projects.map((project) => {
    const executions = project.board?.tests.flatMap((test) => test.executions) ?? [];
    const latest = executions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      id: project.id,
      name: project.name,
      url: projectOrigin(project.url),
      description: project.description,
      created_at: project.createdAt,
      test_count: project.board?.tests.length ?? 0,
      latest_status: latest?.status ?? null,
      preview_artifact_id: project.previewArtifact?.id ?? null,
      preview_execution_id: project.previewArtifact?.executionId ?? null,
      preview_status: project.previewArtifact?.status ?? null,
    };
  });
}

function projectOrigin(value: string) {
  try { return new URL(value).origin; }
  catch { return ""; }
}

export async function create(input: { name: string; url: string; description?: string }) {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name || name.length > 120) throw new Error("Project name must contain 1–120 characters.");
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Project URL must use HTTP or HTTPS.");
  if (parsed.username || parsed.password) throw new Error("Project URLs cannot contain credentials.");
  return database().$transaction(async (tx) => tx.project.create({
    data: {
      name,
      url: parsed.toString().replace(/\/$/, ""),
      description: input.description?.trim() ?? "",
      board: { create: { columns: { create: [{ name: "Da fare", position: 0 }, { name: "In corso", position: 1 }, { name: "Completato", position: 2 }] } } },
    },
    select: { id: true, name: true, url: true, description: true, createdAt: true },
  }));
}
