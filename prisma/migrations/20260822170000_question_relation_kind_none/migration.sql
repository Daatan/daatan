-- Ledger for "we looked and found no constraint": without it the typer re-asks
-- the same top-cosine independent pairs every run and never reaches new ones.
ALTER TYPE "QuestionRelationKind" ADD VALUE 'NONE';
