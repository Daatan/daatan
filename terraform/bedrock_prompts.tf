locals {
  # WARNING — adding a name here CREATES the SSM parameter with value "PLACEHOLDER".
  # `ignore_changes = [value]` only protects a parameter AFTER Terraform owns it, so
  # adding a name for a parameter that already exists out-of-band would overwrite its
  # live Bedrock ARN with PLACEHOLDER. Import it first (import → no-op plan), then add.
  #
  # Known unmanaged parameters that exist in SSM but are deliberately NOT listed here
  # for exactly that reason: content-moderation, temporal-classifier. They currently
  # resolve only because of the hand-made `daatan-bedrock-prompts-fix` inline policy
  # (a wildcard grant that is not in Terraform). Importing them, then dropping that
  # wildcard, is a separate change.
  prompt_names = [
    "express-prediction",
    "extract-prediction",
    "suggest-tags",
    "update-context",
    "dedupe-check",
    "bot-forecast-generation",
    "forecast-quality-validation",
    "bot-vote-decision",
    "bot-config-generation",
    "research-query-generation",
    "resolution-research",
    "translate",
    "topic-extraction",
    # AI panel (docs/LASSO.md). Exists nowhere yet, so creating it at PLACEHOLDER
    # is safe: getPromptTemplate() treats PLACEHOLDER as "serve the hardcoded fallback",
    # which is exactly today's behaviour minus the per-sweep ParameterNotFound error.
    "panel-estimate"
  ]
  prompt_envs = ["staging", "prod"]
}

# Allow EC2 to read Bedrock prompts by ARN and SSM prompt params
resource "aws_iam_role_policy" "bedrock_prompts" {
  name = "daatan-bedrock-prompts"
  role = aws_iam_role.ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:GetPrompt"]
        Resource = "arn:aws:bedrock:${var.aws_region}:*:prompt/*"
      },
      {
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = [
          for pair in setproduct(local.prompt_envs, local.prompt_names) :
          "arn:aws:ssm:${var.aws_region}:*:parameter/daatan/${pair[0]}/prompts/${pair[1]}"
        ]
      }
    ]
  })
}

# SSM parameters — one per env × prompt.
# Values start as PLACEHOLDER and are updated manually via promote-prompt.sh
# after creating the first version in the Bedrock console.
resource "aws_ssm_parameter" "prompts" {
  for_each = {
    for pair in setproduct(local.prompt_envs, local.prompt_names) :
    "${pair[0]}-${pair[1]}" => { env = pair[0], prompt = pair[1] }
  }

  name      = "/daatan/${each.value.env}/prompts/${each.value.prompt}"
  type      = "String"
  value     = "PLACEHOLDER"
  overwrite = true

  tags = {
    Prompt      = each.value.prompt
    Environment = each.value.env
  }

  lifecycle {
    # Never overwrite values updated by promote-prompt.sh
    ignore_changes = [value]
  }
}
