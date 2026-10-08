import { Execution } from "@/components/execution";

export default async function ExecutionPage({ params }: { params: Promise<{ executionId: string }> }) {
  const { executionId } = await params;
  return <Execution executionId={executionId} />;
}
