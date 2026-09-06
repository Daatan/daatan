import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsManager = new SecretsManagerClient({});

const ENV_SECRET_ID = process.env.ENV_SECRET_ID;

// Minimal .env parser for the subset of syntax actually used in
// daatan-env-<environment> (KEY=VALUE lines, optional quoting, # comments).
// Not a general dotenv implementation -- just enough to pull two keys out of
// the app's existing secret instead of provisioning a new one for this Lambda.
export function parseEnvFile(text) {
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

// CloudWatch's SNS message body for an alarm state change (not the SNS
// envelope itself, which the caller has already unwrapped).
export function formatAlarmMessage(alarm) {
  const emoji = STATE_EMOJI[alarm.NewStateValue] || "⚠️";
  return `${emoji} ${alarm.NewStateValue}: ${alarm.AlarmName} (${alarm.Region})\n${alarm.NewStateReason}`;
}

// Cached across warm invocations of the same container so a burst of alarms
// (e.g. every EC2 metric tipping over during a thrash) doesn't hit Secrets
// Manager once per message. The secret is manually managed and rarely
// rotated, so a stale cache surviving until the next cold start is fine.
let cachedCreds = null;

async function getTelegramCreds() {
  if (cachedCreds) return cachedCreds;
  const res = await secretsManager.send(new GetSecretValueCommand({ SecretId: ENV_SECRET_ID }));
  const env = parseEnvFile(res.SecretString || "");
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CLEAN_CHAT_ID || env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error(
      `Missing TELEGRAM_BOT_TOKEN/TELEGRAM_CLEAN_CHAT_ID in secret ${ENV_SECRET_ID}`
    );
  }
  cachedCreds = { token, chatId };
  return cachedCreds;
}

export const handler = async (event) => {
  const { token, chatId } = await getTelegramCreds();

  for (const record of event.Records) {
    const raw = record.Sns.Message;
    let alarm = null;
    try {
      alarm = JSON.parse(raw);
    } catch {
      // Not every SNS message on this topic is guaranteed to be a CloudWatch
      // alarm payload; forward it verbatim rather than dropping it silently.
      alarm = null;
    }

    const text =
      alarm && alarm.AlarmName ? formatAlarmMessage(alarm) : `⚠️ daatan-infra-alerts: ${raw.slice(0, 500)}`;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Rethrow so this invocation counts against the Lambda's own Errors
      // metric -- daatan-infra-alerts-telegram-errors (terraform/telegram_alerts.tf)
      // alarms on it through the pre-existing email subscription, which does
      // not depend on this Lambda or on Telegram to deliver.
      throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
    }

    console.log(`Forwarded alarm "${alarm?.AlarmName ?? "unknown"}" (${alarm?.NewStateValue ?? "?"}) to Telegram.`);
  }
};
