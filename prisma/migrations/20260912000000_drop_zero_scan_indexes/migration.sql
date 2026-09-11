-- daatan#1733: drop indexes still at idx_scan = 0 on 2026-09-12, ~6.5 days after
-- #1732 restarted postgres and started pg_stat_statements collecting (2026-09-05 21:36 UTC).
-- Excludes: predictions_embedding_hnsw_idx / predictions_claim_text_trgm_idx / tags_name_trgm_idx
-- (small-table false negatives per #1733's own note, real query-pattern users in code) and the
-- comments_*/users_* leaderboard-sort indexes (same small-table caveat) -- see the issue for the
-- full disposition table.

DROP INDEX IF EXISTS "news_anchors_createdAt_idx";
DROP INDEX IF EXISTS "external_markets_slug_idx";
DROP INDEX IF EXISTS "commitment_revisions_commitment_id_superseded_at_idx";
DROP INDEX IF EXISTS "comment_reactions_userId_idx";
DROP INDEX IF EXISTS "comment_translations_language_idx";
DROP INDEX IF EXISTS "bot_run_logs_runAt_idx";
DROP INDEX IF EXISTS "bot_rejected_topics_botId_idx";
DROP INDEX IF EXISTS "bot_rejected_topics_rejectedAt_idx";
DROP INDEX IF EXISTS "forecast_creation_attempts_userId_idx";
DROP INDEX IF EXISTS "forecast_creation_attempts_outcome_idx";
DROP INDEX IF EXISTS "oracle_call_logs_userId_idx";
DROP INDEX IF EXISTS "question_relations_to_latent_node_id_status_idx";
DROP INDEX IF EXISTS "question_relations_from_latent_node_id_idx";
DROP INDEX IF EXISTS "latent_nodes_status_idx";
DROP INDEX IF EXISTS "latent_nodes_merged_into_id_idx";
DROP INDEX IF EXISTS "calibration_records_resolved_at_idx";
