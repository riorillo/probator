import { TestEditor } from "@/components/test-editor";

export default async function TestPage({ params }: { params: Promise<{ projectId: string; testId: string }> }) {
  const { projectId, testId } = await params;
  return <TestEditor projectId={projectId} testId={testId} />;
}
