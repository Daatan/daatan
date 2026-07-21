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

The keystore and both passwords live in AWS Secrets Manager (canonical) and
are mirrored to GitHub Actions repo secrets (what CI actually reads —
`gh secret set`, no Terraform/OIDC changes needed):

| Secret | Secrets Manager name | GitHub Actions secret |
|---|---|---|
| Keystore (base64) | `daatan/android/upload-keystore-base64` | `ANDROID_KEYSTORE_BASE64` |
| Keystore password | `daatan/android/upload-keystore-password` | `ANDROID_KEYSTORE_PASSWORD` |
| Key password | `daatan/android/upload-key-password` | `ANDROID_KEY_PASSWORD` |

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

It currently lists only the **upload key's** SHA-256 fingerprint, which is
correct for locally-built/sideloaded installs (`adb install`) signed
directly with the upload key. Once the app is first uploaded to Play
Console and enrolled in Play App Signing, Google **re-signs it with a
different key** for Play-distributed installs. Before real users install
from the Play Store, fetch the **App signing key certificate** SHA-256 from
Play Console → App integrity → App signing, and add it as a **second**
entry in the `sha256_cert_fingerprints` array (keep the upload key's entry
too — it's still needed for local testing). Ships through daatan's normal
PR flow like any other code change.

## Store listing

See [`STORE_LISTING.md`](./STORE_LISTING.md) (draft copy) and
[`DATA_SAFETY_CHECKLIST.md`](./DATA_SAFETY_CHECKLIST.md) (draft Data Safety
+ content rating answers). Both are drafts for review — Play Console
submission is account-tied and has to happen by hand.
