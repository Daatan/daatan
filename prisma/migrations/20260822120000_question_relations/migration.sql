-- Oracle 2.0 storage layer M1 (daatan#1555): a declared relation between two
-- questions. Structure only — NO probability column; edge weights belong to the
-- materialised snapshot layer (M4, daatan#1558), never to this row.
--
-- First writer: the signed relation typer (retro#574). First reader: the
-- coherence check (docs conditionals.md Track A step 2). Rows are
-- post-moderated: a `rejected` row stays so the typer cannot re-propose the
-- same pair; `merged` records that the two questions were found to be one.
--
-- Design: Daatan/docs planning/oracle-2-harness-and-storage.md §4.1.

CREATE TYPE "QuestionRelationKind" AS ENUM (
    'ALIAS',
    'NESTED_DEADLINE',
    'THRESHOLD_NESTING',
    'MUTUALLY_EXCLUSIVE',
    'COMPLEMENT',
    'IMPLIES',
    'CONDITIONAL'
);

CREATE TYPE "QuestionRelationOrigin" AS ENUM ('HUMAN', 'DERIVED', 'EXTRACTED', 'MODEL');

CREATE TYPE "QuestionRelationStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED', 'MERGED');

CREATE TABLE "question_relations" (
    "id" TEXT NOT NULL,
    "from_prediction_id" TEXT NOT NULL,
    "to_prediction_id" TEXT NOT NULL,
    "kind" "QuestionRelationKind" NOT NULL,
    -- +1 / -1 for CONDITIONAL (antecedent raises / lowers the consequent); NULL otherwise.
    "sign" SMALLINT,
    "created_by" "QuestionRelationOrigin" NOT NULL,
    "status" "QuestionRelationStatus" NOT NULL DEFAULT 'PROPOSED',
    -- Verbatim typer output, written for audit (classifier_output precedent).
    "typer_output" JSONB,
    -- Candidate-pair evidence at proposal time.
    "cosine" DOUBLE PRECISION,
    "shared_tag" BOOLEAN,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_relations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "question_relations_sign_check" CHECK ("sign" IS NULL OR "sign" IN (-1, 1)),
    CONSTRAINT "question_relations_not_self_check" CHECK ("from_prediction_id" <> "to_prediction_id")
);

CREATE UNIQUE INDEX "question_relations_from_prediction_id_to_prediction_id_kind_key"
    ON "question_relations" ("from_prediction_id", "to_prediction_id", "kind");

CREATE INDEX "question_relations_to_prediction_id_status_idx"
    ON "question_relations" ("to_prediction_id", "status");

CREATE INDEX "question_relations_from_prediction_id_idx"
    ON "question_relations" ("from_prediction_id");

ALTER TABLE "question_relations"
    ADD CONSTRAINT "question_relations_from_prediction_id_fkey"
    FOREIGN KEY ("from_prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "question_relations"
    ADD CONSTRAINT "question_relations_to_prediction_id_fkey"
    FOREIGN KEY ("to_prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
