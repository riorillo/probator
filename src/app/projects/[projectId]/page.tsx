import { Board } from "@/components/board";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <Board projectId={projectId} />;
}
