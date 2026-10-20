#!/usr/bin/env bash
# Verify that the release artifacts are signed with the expected upload key.
#
# Usage: verify-signature.sh <expected-sha256> <apk> <aab> [assetlinks.json]
#
# The expected value is the upload key's SHA-256 certificate fingerprint (colons/case don't matter).
# The APK is checked with apksigner (v1/v2/v3 signers, what Android uses); the AAB is only JAR-signed,
# so keytool is the right reader there. If assetlinks.json is given, the expected fingerprint must also be
# listed in it, so the workflow constant and the served Digital Asset Links file can't drift apart.
# APKSIGNER may point at a specific apksigner binary; otherwise the newest one in $ANDROID_HOME is used.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <expected-sha256> <apk> <aab> [assetlinks.json]" >&2
  exit 2
fi

norm() { tr -d ': \r' | tr '[:upper:]' '[:lower:]'; }

EXPECTED=$(printf '%s' "$1" | norm)
APK=$2
AAB=$3
ASSETLINKS=${4:-}

if ! [[ "$EXPECTED" =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error::Expected fingerprint is not a SHA-256 value: $1" >&2
  exit 1
fi

if [ -z "${APKSIGNER:-}" ]; then
  APKSIGNER=$(find "${ANDROID_HOME:?ANDROID_HOME not set}/build-tools" -name apksigner -type f | sort -V | tail -1)
fi

fail=0

APK_CERTS=$("$APKSIGNER" verify --print-certs "$APK" | sed -nE 's/^Signer #[0-9]+ certificate SHA-256 digest: *//p' | norm | sort -u)
echo "APK signer SHA-256: ${APK_CERTS:-<none>}"
if [ "$APK_CERTS" != "$EXPECTED" ]; then
  echo "::error::$APK is not signed (only) with the expected upload key"
  fail=1
fi

AAB_CERTS=$(keytool -printcert -jarfile "$AAB" | sed -nE 's/^[[:space:]]*SHA256: *//p' | norm | sort -u)
echo "AAB signer SHA-256: ${AAB_CERTS:-<none>}"
if [ "$AAB_CERTS" != "$EXPECTED" ]; then
  echo "::error::$AAB is not signed (only) with the expected upload key"
  fail=1
fi

if [ -n "$ASSETLINKS" ]; then
  if jq -r '.[].target.sha256_cert_fingerprints[]?' "$ASSETLINKS" | norm | grep -qx "$EXPECTED"; then
    echo "Expected fingerprint is listed in $ASSETLINKS"
  else
    echo "::error::Expected fingerprint is not listed in $ASSETLINKS"
    fail=1
  fi
fi

exit "$fail"
