-- Keep the existing step text while giving it the semantics of a natural-language condition.
ALTER TABLE "steps" RENAME COLUMN "expected" TO "completion_condition";
ALTER TABLE "step_results" RENAME COLUMN "expected" TO "completion_condition";
