import { History } from "@/components/history";

export default async function HistoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <History projectId={projectId} />;
}
