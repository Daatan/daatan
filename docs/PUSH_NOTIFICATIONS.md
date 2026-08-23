# Push notifications

Daatan sends push notifications through `src/lib/services/push/`, built as a small
provider/adapter seam rather than a single Web Push implementation.

## Why an adapter

Today the only provider is Web Push (via the `web-push` npm package + VAPID keys), used by
both the web app and the Android app — the Android app ships as a TWA (Trusted Web Activity)
wrapping the PWA, and TWAs receive notifications through the browser's Web Push service, so no
FCM integration is required for that to work today (daatan#1136).

The seam exists for later, not because anything is broken now: if Daatan ever needs
FCM-grade delivery (a genuinely native Android app, richer delivery guarantees/analytics than
Web Push offers), that becomes a new provider file rather than a rewrite of the dispatch,
retry, and subscription-storage logic.

## Architecture

- `src/lib/services/push/types.ts` — the `PushProvider` interface and shared payload/target
  types. A provider only has to implement `isConfigured()` and `send(target, message)`.
- `src/lib/services/push/web-push-provider.ts` — the only provider today. Wraps the
  `web-push` package: VAPID setup, per-subscription send with bounded retry, and
  provider-specific status-code interpretation (410/404 = stale subscription, 401/403 =
  VAPID keypair mismatch — prune and log loudly, since retrying won't help and this silently
  breaks every send until someone notices).
- `src/lib/services/push/index.ts` — the orchestrator. Exports `dispatchBrowserPush`,
  `upsertPushSubscription`, `deletePushSubscription`. Picks the active provider, fans a
  notification out to a user's subscriptions via `Promise.allSettled`, and batches the
  resulting DB writes (`lastUsedAt` bump on success, delete on stale).

`dispatchBrowserPush`'s signature and behavior are unchanged from before the refactor — this
was a seam extraction, not a behavior change.

## Adding a new provider (e.g. FCM)

1. Add the provider's config (e.g. FCM service account) as env vars, following the pattern in
   `web-push-provider.ts`'s `isConfigured()`.
2. Implement `PushProvider` in `src/lib/services/push/fcm-provider.ts`: translate the shared
   `PushTarget`/`PushMessage` into the provider's send call, and map its failure modes onto
   `PushSendResult` (`'sent' | 'stale' | 'failed'`) the same way `web-push-provider.ts` maps
   HTTP status codes.
3. Wire it into the provider selection in `index.ts`. Until there's a driver to pick a
   provider per-subscription (e.g. a native Android client using FCM tokens instead of Web
   Push endpoints), the simplest selection is "first configured provider wins" or an env
   flag — decide based on what's actually driving the addition at the time.
4. `PushSubscription` in `prisma/schema.prisma` stores Web Push's `endpoint`/`p256dh`/`auth`
   shape. An FCM provider needs its own token shape; extend the schema rather than
   overloading these fields with provider-specific semantics.

No FCM provider exists yet — this doc describes the seam, not a shipped second provider.
