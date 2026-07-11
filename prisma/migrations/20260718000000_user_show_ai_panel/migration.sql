-- Per-user opt-in for the experimental AI-panel chart lines (docs/AI_PANEL.md §8).
-- Default false: the panel is a hidden source, revealed only when a user enables it in
-- Settings. Separate from the Oracle line, which is always shown and unaffected.
ALTER TABLE "users" ADD COLUMN "show_ai_panel" BOOLEAN NOT NULL DEFAULT false;
