# Play Console Data Safety + Content Rating — DRAFT checklist

Both forms are tied to the Play Console account and must be submitted by a
human. This is a drafted answer set from the actual codebase, for review
before pasting into the console.

## Data Safety form

### Does your app collect or share any of the required user data types?
**Yes.**

| Data type | Collected? | Shared with 3rd parties? | Purpose | Source |
|---|---|---|---|---|
| Email address | Yes | No | Account creation/management, App functionality | `prisma/schema.prisma` `User.email`; Google OAuth (`src/auth.ts`) |
| Name | Yes | No | Account functionality, personalization | `User.name` |
| Profile photo (avatar URL) | Yes (URL reference to Google's image, not an uploaded file) | No | Account functionality | `User.image` / `avatarUrl` |
| User IDs | Yes | Yes — Google Analytics (internal cuid only, not email) | Analytics | `src/components/AnalyticsUserSync.tsx` → `identifyUser(session.user.id)` → `gtag('set', {user_id})` |
| Passwords | Yes (bcrypt hash, credentials sign-in path only) | No | Account authentication | `User.password` |
| App interactions / other user-generated content | Yes (predictions, comments) | No | App functionality (the product itself) | `Prediction`, `Comment` models |

### Is all of the user data collected by your app encrypted in transit?
**Yes** — HTTPS everywhere (TLS terminated at nginx; see `infra/nginx/nginx-prod-ssl.conf`).

### Do you provide a way for users to request that their data be deleted?
**Confirm with user** — check whether an account-deletion flow exists
(grepped for one during research; if none exists, this needs either (a) an
in-app deletion path, or (b) a documented support-email process before this
question can be answered "Yes" truthfully in the console).

### Third parties data is shared with
- **Google Analytics (GA4)** — internal user ID only, only after explicit
  cookie-consent opt-in (`src/components/CookieConsent.tsx`); denied by
  default for new visitors. No ad network, no Facebook/Segment/Mixpanel, no
  Sentry/crash-reporting SDK, no payment SDK — confirmed absent from
  `package.json` dependencies.
- **Google OAuth** — used only for sign-in (NextAuth), not a data-sharing
  relationship in the Play Safety sense beyond authentication.

### Ads
**No ads.** No ad SDK present.

### Data collected is not required to be deleted / is it processed ephemerally?
Not applicable — data is retained (it's a permanent-track-record product by
design, per `PRODUCT.md`: "track record permanently"). Note in the
"data retention" free-text field that a user's prediction history is
intentionally permanent — that's the product's core value proposition, not
an oversight.

## Content Rating questionnaire (IARC)

- **User-generated content: Yes.** `Comment` model (`prisma/schema.prisma:871`)
  — threaded comments on predictions, visible to other users.
- **Moderation: automated only.** `src/lib/services/moderation.ts` runs an
  LLM content check (`checkContent(text, contentType)`) pre/post-hoc against
  a `MODERATED` status; **no manual user-facing report/flag button exists
  today** (confirmed by grep — no dedicated report/flag API route).
  ⚠️ **Flag for the user**: Play's UGC questionnaire asks whether users can
  report objectionable content. The honest current answer is "no manual
  report path, automated moderation only" — worth deciding before submitting
  whether to (a) answer accurately as-is, or (b) add a lightweight report
  button first. Not in scope for this implementation pass.
- **Violence / sexual content / gambling simulation: No.** Text-based
  predictions on news/politics; no gambling mechanics (`PRODUCT.md`: "What
  DAATAN Is NOT" table — no real money, no cash-out, no financial incentive).
- **Shares location: No.**
- **Users can interact (chat/comment): Yes**, via comments — same UGC note
  above.
- **Digital purchases: No.**

## Target audience / Families
Not designed for children; primary audience is news/politics-engaged adults.
Recommend **not** opting into the Families program (avoids extra COPPA-style
requirements the product doesn't need).
