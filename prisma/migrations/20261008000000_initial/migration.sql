CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "preview_artifact_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "boards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "columns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "board_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "columns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "board_id" UUID NOT NULL,
    "column_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "objective" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,
    "expected" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "labels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "test_labels" (
    "test_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    CONSTRAINT "test_labels_pkey" PRIMARY KEY ("test_id", "label_id")
);

CREATE TABLE "executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "definition" JSONB NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'local',
    "effective_url" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "execution_jobs" (
    "execution_id" UUID NOT NULL,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_by" TEXT,
    "claimed_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "execution_jobs_pkey" PRIMARY KEY ("execution_id")
);

CREATE TABLE "step_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL,
    "step_id" UUID,
    "position" INTEGER NOT NULL,
    "expected" TEXT NOT NULL DEFAULT '',
    "observed" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "error_detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "step_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "check_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL,
    "check_id" UUID,
    "position" INTEGER NOT NULL,
    "expected" TEXT NOT NULL,
    "observed" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "error_detail" TEXT,
    CONSTRAINT "check_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "run_events" (
    "id" BIGSERIAL NOT NULL,
    "execution_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "checksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "step_position" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "boards_project_id_key" ON "boards"("project_id");
CREATE UNIQUE INDEX "columns_board_id_position_key" ON "columns"("board_id", "position");
CREATE UNIQUE INDEX "columns_board_id_name_key" ON "columns"("board_id", "name");
CREATE INDEX "tests_column_id_position_idx" ON "tests"("column_id", "position");
CREATE INDEX "tests_board_id_updated_at_idx" ON "tests"("board_id", "updated_at" DESC);
CREATE UNIQUE INDEX "steps_test_id_position_key" ON "steps"("test_id", "position");
CREATE UNIQUE INDEX "checks_test_id_position_key" ON "checks"("test_id", "position");
CREATE UNIQUE INDEX "labels_project_id_name_key" ON "labels"("project_id", "name");
CREATE UNIQUE INDEX "executions_test_id_idempotency_key_key" ON "executions"("test_id", "idempotency_key");
CREATE INDEX "executions_test_id_created_at_idx" ON "executions"("test_id", "created_at" DESC);
CREATE INDEX "executions_phase_created_at_idx" ON "executions"("phase", "created_at");
CREATE INDEX "execution_jobs_available_at_idx" ON "execution_jobs"("available_at");
CREATE UNIQUE INDEX "step_results_execution_id_position_key" ON "step_results"("execution_id", "position");
CREATE UNIQUE INDEX "check_results_execution_id_position_key" ON "check_results"("execution_id", "position");
CREATE UNIQUE INDEX "run_events_execution_id_sequence_key" ON "run_events"("execution_id", "sequence");
CREATE INDEX "run_events_execution_id_sequence_idx" ON "run_events"("execution_id", "sequence");
CREATE UNIQUE INDEX "artifacts_execution_id_object_key_key" ON "artifacts"("execution_id", "object_key");

ALTER TABLE "projects" ADD CONSTRAINT "projects_preview_artifact_id_fkey" FOREIGN KEY ("preview_artifact_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "columns" ADD CONSTRAINT "columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tests" ADD CONSTRAINT "tests_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tests" ADD CONSTRAINT "tests_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "columns"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "steps" ADD CONSTRAINT "steps_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checks" ADD CONSTRAINT "checks_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_labels" ADD CONSTRAINT "test_labels_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_labels" ADD CONSTRAINT "test_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "executions" ADD CONSTRAINT "executions_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "projects" ADD CONSTRAINT "projects_name_length_check" CHECK (length(trim("name")) BETWEEN 1 AND 120);
ALTER TABLE "tests" ADD CONSTRAINT "tests_title_length_check" CHECK (length(trim("title")) BETWEEN 1 AND 200);
ALTER TABLE "tests" ADD CONSTRAINT "tests_version_check" CHECK ("version" > 0);
ALTER TABLE "columns" ADD CONSTRAINT "columns_position_check" CHECK ("position" >= 0);
ALTER TABLE "tests" ADD CONSTRAINT "tests_position_check" CHECK ("position" >= 0);
ALTER TABLE "steps" ADD CONSTRAINT "steps_position_check" CHECK ("position" >= 0);
ALTER TABLE "checks" ADD CONSTRAINT "checks_position_check" CHECK ("position" >= 0);
ALTER TABLE "checks" ADD CONSTRAINT "checks_kind_check" CHECK ("kind" IN ('text_visible', 'url_contains'));
ALTER TABLE "executions" ADD CONSTRAINT "executions_mode_check" CHECK ("mode" IN ('live', 'recording'));
ALTER TABLE "executions" ADD CONSTRAINT "executions_status_check" CHECK ("status" IN ('running', 'passed', 'failed', 'blocked'));
ALTER TABLE "executions" ADD CONSTRAINT "executions_phase_check" CHECK ("phase" IN ('queued', 'starting', 'executing', 'evaluating', 'finished'));
ALTER TABLE "step_results" ADD CONSTRAINT "step_results_status_check" CHECK ("status" IN ('passed', 'failed', 'blocked', 'running', 'pending'));
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_status_check" CHECK ("status" IN ('passed', 'failed', 'blocked', 'pending'));
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_status_check" CHECK ("status" IN ('pending', 'ready', 'error'));
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_execution_prefix_check" CHECK ("object_key" LIKE ('replay/' || "execution_id"::text || '/%'));
