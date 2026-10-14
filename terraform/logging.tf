# Container log group (daatan#1788).
#
# `docker logs` belongs to the container, and blue-green-deploy.sh removes the old
# app container on every deploy, so its logs went with it (the #1725 OOM forensics
# and a 2026-10-04 publish-failure trace were both lost or nearly lost that way).
# Containers started with the `awslogs` driver ship here instead; one log group per
# environment, one stream per container instance.
#
# Terraform owns the group on purpose: the docker run flags do NOT set
# `awslogs-create-group`, because a group the driver created would have no
# retention. The flip side is a hard ordering rule — this group must exist in an
# environment before the deploy-script change reaches that environment, or
# `docker run` fails at container start and the deploy aborts in Phase 3.
#
# Both EC2 roles already carry CloudWatchAgentServerPolicy (logs:CreateLogStream,
# PutLogEvents, ...), so no IAM change is needed here.
#
# Apply per environment, always with -target (see terraform/README.md):
#   terraform init -reconfigure -backend-config=backend-<env>.hcl
#   terraform plan -var="environment=<env>" -target=aws_cloudwatch_log_group.containers
resource "aws_cloudwatch_log_group" "containers" {
  name              = "/daatan/${var.environment}/containers"
  retention_in_days = 30

  tags = {
    Environment = var.environment
    Purpose     = "docker-container-logs"
  }
}
