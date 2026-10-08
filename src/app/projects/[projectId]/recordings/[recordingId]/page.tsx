import { FlowRecorder } from "@/components/flow-recorder";

export default async function FlowRecordingPage({ params }: { params: Promise<{ projectId: string; recordingId: string }> }) {
  const { projectId, recordingId } = await params;
  return <FlowRecorder projectId={projectId} recordingId={recordingId} />;
}
