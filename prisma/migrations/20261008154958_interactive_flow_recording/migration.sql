-- DropForeignKey
ALTER TABLE "executions" DROP CONSTRAINT "executions_test_id_fkey";

-- DropForeignKey
ALTER TABLE "tests" DROP CONSTRAINT "tests_column_id_fkey";

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "parameters" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "tests" ADD COLUMN     "variables" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "flow_recordings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "effective_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "worker_id" TEXT,
    "heartbeat_at" TIMESTAMPTZ(6),
    "frame_object_key" TEXT,
    "command_sequence" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "flow_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recording_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recording_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "recording_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flow_recordings_project_id_created_at_idx" ON "flow_recordings"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "flow_recordings_status_created_at_idx" ON "flow_recordings"("status", "created_at");

-- CreateIndex
CREATE INDEX "recording_events_recording_id_sequence_idx" ON "recording_events"("recording_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "recording_events_recording_id_sequence_key" ON "recording_events"("recording_id", "sequence");

-- CreateIndex
CREATE INDEX "recording_commands_recording_id_status_sequence_idx" ON "recording_commands"("recording_id", "status", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "recording_commands_recording_id_sequence_key" ON "recording_commands"("recording_id", "sequence");

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "columns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_recordings" ADD CONSTRAINT "flow_recordings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_events" ADD CONSTRAINT "recording_events_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "flow_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_commands" ADD CONSTRAINT "recording_commands_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "flow_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
