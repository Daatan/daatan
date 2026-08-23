-- Oracle 2.0 storage layer M2 (daatan#1556): the latent_nodes table (a "shadow
-- forecast" — priced but unpublished), plus making question_relations
-- endpoints polymorphic so a relation can point at a latent node on either
-- side. No promotion path yet (deferred) — predictionId/PROMOTED are on
-- record for the shape but nothing sets them today.
--
-- Design: Daatan/docs planning/oracle-2-harness-and-storage.md §4.2.
--
-- Purely additive on question_relations: the original
-- question_relations_from_prediction_id_to_prediction_id_kind_key unique
-- index is untouched (question-relation.ts's `findUnique` depends on its
-- exact shape), so the M1 typer write path needs zero changes. The three
-- latent-node-involved endpoint combinations get their own partial unique
-- indexes below instead of one coalesced index, so no assumption is needed
-- about predictions.id and latent_nodes.id (both cuid()) never colliding.

CREATE TYPE "LatentNodeStatus" AS ENUM ('OPEN', 'MERGED', 'PROMOTED', 'REJECTED');

CREATE TYPE "LatentNodeOrigin" AS ENUM ('ARTICLE_ANTECEDENT', 'VARIANT', 'MCP_PROBE', 'EXPRESS');

CREATE TABLE "latent_nodes" (
    "id" TEXT NOT NULL,
    "text_en" VARCHAR(500) NOT NULL,
    "embedding" vector(768),
    "claim_deadline" TIMESTAMP(3),
    "claim_direction" "ClaimDirection",
    "claim_archetype" "ClaimArchetype",
    "fan_in" INTEGER NOT NULL DEFAULT 0,
    "first_claim_article_id" TEXT,
    "first_claim_index" INTEGER,
    "last_seen_at" TIMESTAMP(3),
    "status" "LatentNodeStatus" NOT NULL DEFAULT 'OPEN',
    "merged_into_id" TEXT,
    "prediction_id" TEXT,
    "price_mean" DOUBLE PRECISION,
    "price_var" DOUBLE PRECISION,
    "priced_at" TIMESTAMP(3),
    "origin" "LatentNodeOrigin" NOT NULL,
    "variant_of_relation_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "latent_nodes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "latent_nodes_not_self_merge_check" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id"),
    CONSTRAINT "latent_nodes_merged_into_status_check" CHECK ("merged_into_id" IS NULL OR "status" = 'MERGED'),
    CONSTRAINT "latent_nodes_prediction_status_check" CHECK ("prediction_id" IS NULL OR "status" = 'PROMOTED')
);

CREATE INDEX "latent_nodes_status_idx" ON "latent_nodes" ("status");
CREATE INDEX "latent_nodes_merged_into_id_idx" ON "latent_nodes" ("merged_into_id");

ALTER TABLE "latent_nodes"
    ADD CONSTRAINT "latent_nodes_merged_into_id_fkey"
    FOREIGN KEY ("merged_into_id") REFERENCES "latent_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "latent_nodes"
    ADD CONSTRAINT "latent_nodes_prediction_id_fkey"
    FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- variant_of_relation_id references question_relations, added after that
-- table's endpoints are widened below (no ordering requirement in practice,
-- kept last for readability).

-- ---------------------------------------------------------------------------
-- question_relations: polymorphic endpoints
-- ---------------------------------------------------------------------------

-- Drop NOT NULL: a latent-latent or latent-prediction relation leaves the
-- prediction-side column NULL. The existing FKs and the prediction-prediction
-- unique index are unaffected — NULL is simply excluded from that index, same
-- as any nullable-column unique index.
ALTER TABLE "question_relations" ALTER COLUMN "from_prediction_id" DROP NOT NULL;
ALTER TABLE "question_relations" ALTER COLUMN "to_prediction_id" DROP NOT NULL;

ALTER TABLE "question_relations" ADD COLUMN "from_latent_node_id" TEXT;
ALTER TABLE "question_relations" ADD COLUMN "to_latent_node_id" TEXT;

ALTER TABLE "question_relations"
    ADD CONSTRAINT "question_relations_from_endpoint_check"
    CHECK (("from_prediction_id" IS NOT NULL) <> ("from_latent_node_id" IS NOT NULL));

ALTER TABLE "question_relations"
    ADD CONSTRAINT "question_relations_to_endpoint_check"
    CHECK (("to_prediction_id" IS NOT NULL) <> ("to_latent_node_id" IS NOT NULL));

-- The original question_relations_not_self_check (from_prediction_id <>
-- to_prediction_id) already passes on latent-involved rows: with either side
-- NULL the comparison evaluates to NULL, which is not FALSE, so the CHECK is
-- satisfied. This adds the equivalent guard for the latent-latent case.
ALTER TABLE "question_relations"
    ADD CONSTRAINT "question_relations_not_self_latent_check"
    CHECK ("from_latent_node_id" IS NULL OR "to_latent_node_id" IS NULL OR "from_latent_node_id" <> "to_latent_node_id");

ALTER TABLE "question_relations"
    ADD CONSTRAINT "question_relations_from_latent_node_id_fkey"
    FOREIGN KEY ("from_latent_node_id") REFERENCES "latent_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "question_relations"
    ADD CONSTRAINT "question_relations_to_latent_node_id_fkey"
    FOREIGN KEY ("to_latent_node_id") REFERENCES "latent_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One partial unique index per non-prediction-prediction endpoint-type
-- combination. The original question_relations_from_prediction_id_to_prediction_id_kind_key
-- (unchanged, above) covers the fourth (prediction-prediction) combination.
CREATE UNIQUE INDEX "question_relations_pred_latent_kind_key"
    ON "question_relations" ("from_prediction_id", "to_latent_node_id", "kind")
    WHERE "from_prediction_id" IS NOT NULL AND "to_latent_node_id" IS NOT NULL;

CREATE UNIQUE INDEX "question_relations_latent_pred_kind_key"
    ON "question_relations" ("from_latent_node_id", "to_prediction_id", "kind")
    WHERE "from_latent_node_id" IS NOT NULL AND "to_prediction_id" IS NOT NULL;

CREATE UNIQUE INDEX "question_relations_latent_latent_kind_key"
    ON "question_relations" ("from_latent_node_id", "to_latent_node_id", "kind")
    WHERE "from_latent_node_id" IS NOT NULL AND "to_latent_node_id" IS NOT NULL;

CREATE INDEX "question_relations_to_latent_node_id_status_idx"
    ON "question_relations" ("to_latent_node_id", "status");

CREATE INDEX "question_relations_from_latent_node_id_idx"
    ON "question_relations" ("from_latent_node_id");

ALTER TABLE "latent_nodes"
    ADD CONSTRAINT "latent_nodes_variant_of_relation_id_fkey"
    FOREIGN KEY ("variant_of_relation_id") REFERENCES "question_relations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
