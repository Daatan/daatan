#!/bin/bash

# Restore Secrets to AWS Secrets Manager from Local Files
# Used to refresh secrets after local changes (e.g. rotating API keys in .env).
#
# (The former `daatan-deploy-key-<env>` SSH secret is gone — EC2 bootstrap clones
# over HTTPS with `daatan-github-token`; see Daatan/docs#122.)
#
# Usage:
#   ./scripts/restore_secrets.sh staging
#   ./scripts/restore_secrets.sh prod

REGION="eu-central-1"
ENV=${1:-staging}

# Repo root, derived from this script's location — path-independent so the
# workspace can move without breaking this script.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Usage: $0 [staging|prod]"
  exit 1
fi

# Environment Variables (.env)
echo "Uploading .env variables for $ENV..."
aws secretsmanager put-secret-value \
    --secret-id "daatan-env-$ENV" \
    --secret-string "file://$REPO_ROOT/.env" \
    --region "$REGION"

echo "✅ Secrets restored for $ENV!"
echo "If the server needs the new secrets immediately, restart the app container via SSM:"
if [[ "$ENV" == "prod" ]]; then
  echo "  aws ssm send-command --instance-ids i-04ea44d4243d35624 \\"
  echo "    --document-name AWS-RunShellScript \\"
  echo "    --parameters 'commands=[\"cd ~/app && docker compose -f docker-compose.prod.yml restart app\"]'"
else
  echo "  aws ssm send-command --instance-ids i-0406d237ca5d92cdf \\"
  echo "    --document-name AWS-RunShellScript \\"
  echo "    --parameters 'commands=[\"cd ~/app && docker compose -f docker-compose.prod.yml restart app-staging\"]'"
fi
