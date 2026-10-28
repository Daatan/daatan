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
export BUBBLEWRAP_KEYSTORE_PASSWORD=...   # from SSM Parameter Store, see below
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

`.github/workflows/android-release.yml` builds the signed AAB and, when the Play service account is configured, uploads
it to Google Play. Triggers:

| Trigger | What happens |
|---|---|
| Pull request touching `android/**` | Build + verify only (same-repo PRs; never uploads) |
| Push to `main` touching `android/**` | Build + upload to the **internal** track |
| Tag `android-v*` (e.g. `android-v1.1.0`) | Same, with `versionName` taken from the tag |
| Monthly schedule (1st, 05:23 UTC) | Rebuild + upload to internal, so toolchain breakage shows up early |
| `workflow_dispatch` | Choose a testing track (`internal`/`alpha`/`beta`), status (`completed`/`draft`) and en-US release notes |

**Production promotion is a human step in Play Console.** The workflow only uploads to testing tracks; nothing here
publishes to production.

**Release notes.** Every upload carries en-US release notes (`whatsNewDirectory`): the `release_notes` dispatch input,
or `DAATAN <versionName>: bug fixes and improvements.` by default. Play keeps them when the release is promoted;
edit them in the Console before promoting if the release deserves a real changelog.

`versionCode` (minutes since the epoch) and `versionName` are derived in CI and stamped into `twa-manifest.json` at
build time; the committed `appVersionCode`/`appVersion` are only a baseline. Play rejects a duplicate `versionCode`, so
do not set it back to a fixed value in CI. A tag build uses the tag's version; any other build uses
`X.Y.(Z + run number)` from the highest `android-vX.Y.Z` tag, so it never reads lower than the last tagged release.

**Signature check.** After building, `scripts/verify-android-signature.sh` checks that the APK (`apksigner`) and the AAB
(`keytool`; bundles are JAR-signed) are signed with exactly the upload key (`UPLOAD_KEY_SHA256` at the top of the
workflow) and that this fingerprint is listed in `public/.well-known/assetlinks.json`. If the upload key is ever
rotated, update both.

**Target API floor.** Google Play requires updates to target a minimum API level (currently **36**, Android 16,
enforced 2026-08-31 — Play Console → Policy status). The workflow runs a pinned `@bubblewrap/cli`
(`BUBBLEWRAP_VERSION`), whose template sets `targetSdkVersion`, and **fails before building** if the generated
`app/build.gradle` targets less than `MIN_TARGET_SDK` (top of the workflow). When Google raises the floor, raise
`MIN_TARGET_SDK` there and bump `BUBBLEWRAP_VERSION` (by PR, which runs the full build) to a release whose template
meets it.

### One-time setup for automatic Play uploads

Without it the job still builds and keeps the AAB as an artifact (you upload by hand). To enable uploads:

1. Google Cloud: create a service account (any project), create a JSON key, and enable the **Google Play Android
   Developer API** on that project.
2. Play Console → Users and permissions → invite the service account's email with permission to **release to
   testing tracks** only — production promotion stays a manual step in the console.
3. `gh secret set PLAY_SERVICE_ACCOUNT_JSON < key.json -R Daatan/daatan`, store the same JSON in SSM (e.g.
   `/daatan/shared/secrets/PLAY_SERVICE_ACCOUNT_JSON`) as the canonical copy, then delete the local file.

Notes: the first upload through the API to a brand-new service account can take a few hours to be recognised. If the
app is on managed publishing, an uploaded release still needs publishing in the console.

Internal testers (as of the initial rollout — ask before assuming this list
is final, more may be added later): `komapc@gmail.com`,
`andrey1bar@gmail.com`, `janwuf@gmail.com`.

## Digital Asset Links (`assetlinks.json`)

`public/.well-known/assetlinks.json` proves daatan.com and the Android app
share an owner — this is what lets the TWA open **without a visible browser
URL bar**. A mismatch here is the classic TWA bug.

It lists exactly **two** SHA-256 fingerprints, and the route unit test pins that
exact set, so adding a third fails CI:

| Fingerprint | What it is | Needed for |
|---|---|---|
| `1B:79:A3:BC:…:CF:18` | **Upload key** (our keystore) | Locally-built / sideloaded installs via `adb install` |
| `B0:60:24:A9:…:42:90` | **Play App Signing key** — what Google actually re-signs the distributed APK with | Every install from Google Play |

**Do not read the Play App Signing fingerprint out of the Play Console UI.**
That is how this broke (#1697): `FC:BE:B0:3B:…:81:52` was transcribed from
the console as "the classical key" on 2026-07-25 and is **not** the key Play
signs with. It went unnoticed for five weeks, during which every Play
install rendered with a visible `daatan.com` URL bar. The console shows
several fingerprints (upload key, app signing key, classical vs
post-quantum) and it is easy to take the wrong one — and nothing downstream
will tell you, because a wrong value still serves HTTP 200 and still passes
the unit test.

`FC:BE:…:81:52` was kept for a while in case it was the post-quantum app
signing key, but it was never observed on a real artifact or positively
identified, so it was removed (platform#38) — an unidentified certificate in a
`delegate_permission/common.handle_all_urls` allowlist grants URL-handling
authority to a key we cannot account for. If Google ever starts signing with
a new key, add it only after reading it off a Play-installed APK (below).

### Getting the Play App Signing fingerprint the reliable way

Read it off a real artifact rather than a UI, on a device with the app
installed **from Google Play** (`installer=com.android.vending`):

```bash
adb shell pm list packages -i com.daatan.app        # confirm installer=com.android.vending
adb pull "$(adb shell pm path com.daatan.app | sed 's/package://' | tr -d '\r')" /tmp/play.apk
~/Android/Sdk/build-tools/36.1.0/apksigner verify --print-certs -v /tmp/play.apk \
  | grep "Signer #1 certificate SHA-256"
```

Use `apksigner`, not `keytool -printcert -jarfile` — the latter reads only
the legacy v1 JAR signature and can disagree with the v2/v3 signer that
Android actually uses for Digital Asset Links.

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

**And the `curl` is not sufficient either** (#1697, 5 weeks): a file with a
*wrong* fingerprint serves HTTP 200 exactly like a correct one. The three
checks are independent and you need all of them — content is committed, the
file is **served**, and the fingerprints are the keys actually in use.

### The only acceptance test that means anything

Sideloading proves nothing about the Play path: `adb install` uses the
**upload** key, and that fingerprint has always been correct. Both TWA
regressions to date were invisible to sideload testing. Verify like this:

1. Install **from Google Play** (not `adb install`), then launch the app.
2. Screenshot it — there must be **no URL bar**.
3. `adb logcat | grep -E "TWAConnectionPool|DelegationService"` must show
   Chrome binding `com.daatan.app.DelegationService` for `https://daatan.com/`.
   Chrome only binds that after Digital Asset Links verification succeeds, so
   its **absence is the failure signal**.

Note that the resolved top activity is `TranslucentCustomTabActivity` in
*both* the working and broken cases — Chrome reuses that class for TWAs and
Custom Tabs alike and just toggles the toolbar. Do not use it as a signal.

## Store listing

See [`STORE_LISTING.md`](./STORE_LISTING.md) (draft copy) and
[`DATA_SAFETY_CHECKLIST.md`](./DATA_SAFETY_CHECKLIST.md) (draft Data Safety
+ content rating answers). Both are drafts for review — Play Console
submission is account-tied and has to happen by hand.

Real device screenshots and a composed 1024×500 feature graphic live under
[`store-assets/`](./store-assets/) — captured from the actual running app,
not mockups (see `android/.gitignore`, which allowlists this directory
alongside the other hand-curated docs).
