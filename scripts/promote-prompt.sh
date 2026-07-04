#!/usr/bin/env bash
# promote-prompt.sh — Promote or rollback a Bedrock prompt version via SSM.
#
# Usage:
#   Promote:  ./scripts/promote-prompt.sh <env> <prompt> <version-arn>
#   Rollback: ./scripts/promote-prompt.sh <env> <prompt> --rollback
#
# Examples:
#   ./scripts/promote-prompt.sh staging express-prediction arn:aws:bedrock:eu-central-1:123456789012:prompt/ABCDEF/versions/1
#   ./scripts/promote-prompt.sh prod express-prediction --rollback
#
# Valid envs:    staging | prod
# Valid prompts: express-prediction | extract-prediction | suggest-tags | update-context

set -euo pipefail

ENV=${1:-}
PROMPT=${2:-}
ACTION=${3:-}
REGION="eu-central-1"

# --- Validation ---
if [[ -z "$ENV" || -z "$PROMPT" || -z "$ACTION" ]]; then
  echo "Usage: $0 <env> <prompt> <version-arn|--rollback>"
  exit 1
fi

VALID_ENVS=("staging" "prod")
VALID_PROMPTS=("express-prediction" "extract-prediction" "suggest-tags" "update-context" "dedupe-check" "bot-forecast-generation" "forecast-quality-validation" "bot-vote-decision" "bot-config-generation" "research-query-generation" "resolution-research" "translate" "topic-extraction" "content-moderation" "guess-chances" "temporal-classifier")

if [[ ! " ${VALID_ENVS[*]} " =~ " ${ENV} " ]]; then
  echo "Error: env must be one of: ${VALID_ENVS[*]}"
  exit 1
fi

if [[ ! " ${VALID_PROMPTS[*]} " =~ " ${PROMPT} " ]]; then
  echo "Error: prompt must be one of: ${VALID_PROMPTS[*]}"
  exit 1
fi

SSM_PATH="/daatan/${ENV}/prompts/${PROMPT}"

# --- Helpers ---
get_current_arn() {
  aws ssm get-parameter \
    --name "$SSM_PATH" \
    --region "$REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || echo ""
}

get_previous_arn() {
  aws ssm list-tags-for-resource \
    --resource-type Parameter \
    --resource-id "$SSM_PATH" \
    --region "$REGION" \
    --query "TagList[?Key=='previous-arn'].Value" \
    --output text 2>/dev/null || echo ""
}

save_as_previous() {
  local arn=$1
  if [[ -n "$arn" && "$arn" != "PLACEHOLDER" ]]; then
    aws ssm add-tags-to-resource \
      --resource-type Parameter \
      --resource-id "$SSM_PATH" \
      --tags "Key=previous-arn,Value=${arn}" \
      --region "$REGION"
  fi
}

set_arn() {
  local arn=$1
  aws ssm put-parameter \
    --name "$SSM_PATH" \
    --value "$arn" \
    --type String \
    --overwrite \
    --region "$REGION" \
    --output text > /dev/null
}

# --- Promote ---
if [[ "$ACTION" != "--rollback" ]]; then
  NEW_ARN=$ACTION

  if [[ ! "$NEW_ARN" =~ ^arn:aws:bedrock: ]]; then
    echo "Error: version ARN must start with arn:aws:bedrock:"
    exit 1
  fi

  CURRENT=$(get_current_arn)
  save_as_previous "$CURRENT"
  set_arn "$NEW_ARN"

  echo "✓ Promoted  ${ENV} / ${PROMPT}"
  echo "  Old ARN: ${CURRENT:-none}"
  echo "  New ARN: ${NEW_ARN}"
  echo ""
  echo "Cache refreshes within 5 minutes. Restart the app to apply immediately."

# --- Rollback ---
else
  CURRENT=$(get_current_arn)
  PREV=$(get_previous_arn)

  if [[ -z "$PREV" ]]; then
    echo "Error: No previous ARN stored for ${ENV}/${PROMPT}."
    echo "Set manually: aws ssm put-parameter --name '${SSM_PATH}' --value '<arn>' --overwrite --region ${REGION}"
    exit 1
  fi

  save_as_previous "$CURRENT"
  set_arn "$PREV"

  echo "✓ Rolled back  ${ENV} / ${PROMPT}"
  echo "  Was:  ${CURRENT}"
  echo "  Now:  ${PREV}"
  echo ""
  echo "Cache refreshes within 5 minutes. Restart the app to apply immediately."
fi
