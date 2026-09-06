// Unit tests for the infra-alerts-to-Telegram forwarder's pure logic.
//
// Run with the app test suite: npm test
//
// index.mjs imports @aws-sdk/client-secrets-manager, which (like
// @aws-sdk/client-ses in infra/mail-forwarder) is provided by the Lambda
// Node.js runtime rather than bundled as a repo dependency, so it isn't in
// this project's node_modules. The pure helpers are re-declared here in sync
// with index.mjs -- same tradeoff mail-forwarder's test file documents.

import { test } from "vitest";
import assert from "node:assert/strict";

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const STATE_EMOJI = { ALARM: "\u{1F534}", OK: "\u{1F7E2}", INSUFFICIENT_DATA: "⚪" };

function formatAlarmMessage(alarm) {
  const emoji = STATE_EMOJI[alarm.NewStateValue] || "⚠️";
  return `${emoji} ${alarm.NewStateValue}: ${alarm.AlarmName} (${alarm.Region})\n${alarm.NewStateReason}`;
}

test("parseEnvFile reads KEY=VALUE lines and skips comments/blank lines", () => {
  const text = [
    "# comment",
    "",
    'TELEGRAM_BOT_TOKEN="123:abc"',
    "TELEGRAM_CLEAN_CHAT_ID=-100987654321",
    "UNRELATED=ignored too",
  ].join("\n");

  const env = parseEnvFile(text);
  assert.equal(env.TELEGRAM_BOT_TOKEN, "123:abc");
  assert.equal(env.TELEGRAM_CLEAN_CHAT_ID, "-100987654321");
  assert.equal(env.UNRELATED, "ignored too");
  assert.equal(env["# comment"], undefined);
});

test("parseEnvFile strips single and double quotes but leaves unquoted values alone", () => {
  const env = parseEnvFile("A='single'\nB=\"double\"\nC=bare");
  assert.equal(env.A, "single");
  assert.equal(env.B, "double");
  assert.equal(env.C, "bare");
});

test("formatAlarmMessage renders ALARM with the red-circle prefix", () => {
  const msg = formatAlarmMessage({
    AlarmName: "prod-ec2-cpu-high",
    NewStateValue: "ALARM",
    NewStateReason: "Threshold Crossed: CPUUtilization > 85",
    Region: "EU (Frankfurt)",
  });
  assert.ok(msg.startsWith("\u{1F534} ALARM: prod-ec2-cpu-high (EU (Frankfurt))"));
  assert.ok(msg.includes("Threshold Crossed"));
});

test("formatAlarmMessage renders OK with the green-circle prefix", () => {
  const msg = formatAlarmMessage({
    AlarmName: "prod-ec2-cpu-high",
    NewStateValue: "OK",
    NewStateReason: "Threshold Crossed: back below 85",
    Region: "EU (Frankfurt)",
  });
  assert.ok(msg.startsWith("\u{1F7E2} OK: prod-ec2-cpu-high"));
});

test("formatAlarmMessage falls back to a warning emoji for an unrecognized state", () => {
  const msg = formatAlarmMessage({
    AlarmName: "x",
    NewStateValue: "SOMETHING_NEW",
    NewStateReason: "r",
    Region: "eu-central-1",
  });
  assert.ok(msg.startsWith("⚠️ SOMETHING_NEW: x"));
});
