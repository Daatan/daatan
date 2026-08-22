# Android (Play Store TWA)

Thin Trusted Web Activity (TWA) wrapper around the daatan.com PWA, built with
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). The web app is
the single source of truth — this wraps it in a native shell, it doesn't
reimplement anything. A web deploy updates the app instantly; only native
shell changes (icon, signing, permissions) need a new Android release.

## What's committed vs. generated

Only `twa-manifest.json` (plus this README and the draft store docs) is
committed. Everything else — `app/`, `gradlew`, `build.gradle`,
`android.keystore` — is regenerated fresh by `bubblewrap build` both in CI
and locally, and is gitignored. Don't hand-edit the generated project; edit
`twa-manifest.json` (or `bubblewrap update`) and rebuild instead.

## Building locally

Requires JDK 17 (not 21+ — bubblewrap's Gradle project targets 17) and the
Android SDK (`cmdline-tools`, `platform-tools`, `build-tools;34.0.0`,
`platforms;android-36`).

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/Android/Sdk
mkdir -p ~/.bubblewrap
echo "{\"jdkPath\":\"$JAVA_HOME\",\"androidSdkPath\":\"$ANDROID_HOME\"}" > ~/.bubblewrap/config.json
# Only needed if your SDK uses the modern cmdline-tools/latest/ layout --
# bubblewrap's path validator only recognizes a tools/ or bin/ dir directly
# under the SDK root.
ln -sf "$ANDROID_HOME/cmdline-tools/latest/bin" "$ANDROID_HOME/bin"

cd android
export BUBBLEWRAP_KEYSTORE_PASSWORD=...   # from AWS Secrets Manager, see below
export BUBBLEWRAP_KEY_PASSWORD=...
npx @bubblewrap/cli build
```

Output: `android/app-release-bundle.aab` (signed) and
`android/app-release-signed.apk` (for local sideload testing via
`adb install`).

**Known gotcha:** Bubblewrap's own "install the JDK for me" / "install the
Android SDK for me" prompts are currently broken — the JDK download resolves
to the `openjdk/jdk17u` GitHub repo's **source** archive, not a compiled
binary, and crashes on decompression. Always decline those prompts (or
pre-seed `~/.bubblewrap/config.json` as above to skip them) and point
Bubblewrap at a real JDK 17 (e.g. `apt-get install openjdk-17-jdk`, or
extract the Temurin tarball) and your existing Android SDK instead.

## Signing keys and secrets

Google Play App Signing is enabled: Bubblewrap generated a local **upload**
keystore (`android.keystore`, alias `upload`); Google holds the actual **app
signing key** used on end-user devices. If the upload key is ever lost,
Google can help reset it — a fully self-managed key would brick the app.

The keystore and both passwords live in SSM Parameter Store (canonical —
migrated off Secrets Manager per docs#122, since nothing here reads them at
app runtime, only this manual setup step) and are mirrored to GitHub Actions
repo secrets (what CI actually reads — `gh secret set`, no Terraform/OIDC
changes needed):

| Secret | SSM parameter name | GitHub Actions secret |
|---|---|---|
| Keystore (base64) | `/daatan/shared/secrets/ANDROID_UPLOAD_KEYSTORE_BASE64` | `ANDROID_KEYSTORE_BASE64` |
| Keystore password | `/daatan/shared/secrets/ANDROID_UPLOAD_KEYSTORE_PASSWORD` | `ANDROID_KEYSTORE_PASSWORD` |
| Key password | `/daatan/shared/secrets/ANDROID_UPLOAD_KEY_PASSWORD` | `ANDROID_KEY_PASSWORD` |

Read one with `aws ssm get-parameter --name <name> --with-decryption --query
Parameter.Value --output text`; re-mirror to GitHub with `gh secret set
<GitHub name> --body "$(aws ssm get-parameter --name <name> --with-decryption
--query Parameter.Value --output text)"`.

The key alias (`upload`) isn't a secret — it's hardcoded in
`twa-manifest.json` and the CI workflow.

**Never commit `android.keystore` or any password.** `android/.gitignore`
blocks it, but double-check before any `git add -A` in this directory.

## Releasing

Push a tag matching `android-v*` (e.g. `android-v1.0.0`) — deliberately
decoupled from the web app's own `v*` tags, since a web deploy is
instant/no-review but an Android release is a distinct, occasional event.
`.github/workflows/android-release.yml` builds the signed AAB and attaches
it to the workflow run as a downloadable artifact — **it does not upload to
Play Console**. Download the artifact and upload it by hand to the
appropriate track (internal testing first).

Internal testers (as of the initial rollout — ask before assuming this list
is final, more may be added later): `komapc@gmail.com`,
`andrey1bar@gmail.com`, `janwuf@gmail.com`.

## Digital Asset Links (`assetlinks.json`)

`public/.well-known/assetlinks.json` proves daatan.com and the Android app
share an owner — this is what lets the TWA open **without a visible browser
URL bar**. A mismatch here is the classic TWA bug.

It now lists **two** SHA-256 fingerprints: the **upload key** (for
locally-built/sideloaded installs via `adb install`) and the **Play App
Signing key** (added after the first Play Console upload — Google re-signs
the distributed APK with a different, Google-managed key). Keep both
entries; each is needed for a different install path.

To find the Play App Signing key's SHA-256 again (e.g. if it's ever
rotated): Play Console → **Protected with Play** → expand **"Play Store
protection"** → **"Protect app signing key"** row → **"Manage Play app
signing"** button → use the **classical key**'s SHA-256 (not the
post-quantum one — Digital Asset Links verification doesn't support PQC
keys yet). Google has moved this page at least once (it used to be under
"App integrity → App signing" directly); if the path above is stale, use
the console's own search or try
`.../app/<app-id>/app-signing` directly.

**Production gotcha (bit us for 4 days, 2026-07-21 to 2026-07-25):**
Next.js's `output: 'standalone'` static file server silently 404s any
`public/` request path with a dot-prefixed segment — so
`/.well-known/assetlinks.json` was **completely unreachable in production**
despite being committed and correct, and the TWA silently fell back to a
visible-URL-bar Custom Tab the entire time. Comparing the committed file's
*content* against the keystore is not the same as proving it's *served* —
always do a live `curl -sD - https://daatan.com/.well-known/assetlinks.json`
after any change here. See `docs/DEPLOYMENT.md` for the general fix
(a `next.config.js` rewrite to a normal API route) and
[daatan#1176](https://github.com/Daatan/daatan/issues/1176) for the full
incident.

## Store listing

See [`STORE_LISTING.md`](./STORE_LISTING.md) (draft copy) and
[`DATA_SAFETY_CHECKLIST.md`](./DATA_SAFETY_CHECKLIST.md) (draft Data Safety
+ content rating answers). Both are drafts for review — Play Console
submission is account-tied and has to happen by hand.

Real device screenshots and a composed 1024×500 feature graphic live under
[`store-assets/`](./store-assets/) — captured from the actual running app,
not mockups (see `android/.gitignore`, which allowlists this directory
alongside the other hand-curated docs).
