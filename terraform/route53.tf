# Route 53 Hosted Zone — now owned by the platform/foundation stack, not here.
# This app stack only manages records; it looks the zone up by id so a service
# repo never reaches "up" into an app's state and the staging backend can't
# create a duplicate zone. See Daatan/platform foundation/route53.tf.
data "aws_route53_zone" "main" {
  zone_id = "Z0878807J7QMMQ2P8AA2" # daatan.com
}

# ====================================================================
# PRODUCTION DOMAIN RECORDS (daatan.com)
# ====================================================================
# Root domain A record pointing to production instance
resource "aws_route53_record" "root" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [aws_eip.production.public_ip]
}

# Legacy prod subdomain A record, same target as the root domain. Live in Route53
# since before this repo's Terraform history began (never added via IaC — see
# docs#79); imported rather than deleted since decommissioning wasn't the call.
# TTL 60 matches the live record as found, distinct from this file's usual 300.
resource "aws_route53_record" "prod" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "prod.${var.domain_name}"
  type    = "A"
  ttl     = 60
  records = [aws_eip.production.public_ip]
}

# API subdomain pointing to production instance
resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "api.${var.domain_name}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.production.public_ip]
}

# Elections subdomain (elections.daatan.com) → production instance. Served by the
# same app; src/middleware.ts host-routes it to the /elections section. TLS is the
# daatan.com cert expanded to include this SAN (certbot --expand); nginx server
# block in infra/nginx/nginx-prod-ssl.conf.
resource "aws_route53_record" "elections" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "elections.${var.domain_name}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.production.public_ip]
}

# WWW CNAME pointing to root
resource "aws_route53_record" "www" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "www.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [var.domain_name]
}

# ====================================================================
# STAGING DOMAIN RECORDS (staging.daatan.com)
# ====================================================================
# Staging subdomain A record pointing to staging instance
resource "aws_route53_record" "staging" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "staging.${var.domain_name}"
  type    = "A"
  ttl     = 60
  records = [aws_eip.staging.public_ip]
}

# Next testbed subdomain A record pointing to staging instance
resource "aws_route53_record" "next" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "next.${var.domain_name}"
  type    = "A"
  ttl     = 60
  records = [aws_eip.staging.public_ip]
}

# SES Verification TXT record
resource "aws_route53_record" "ses_verification" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  ttl     = 300
  records = [aws_ses_domain_identity.main.verification_token]
}

# SES MX Records (Inbound Mail)
resource "aws_route53_record" "mx" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 300
  records = [
    "10 inbound-smtp.${var.aws_region}.amazonaws.com"
  ]
}

# SES DKIM Records
resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${element(aws_ses_domain_dkim.main.dkim_tokens, count.index)}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${element(aws_ses_domain_dkim.main.dkim_tokens, count.index)}.dkim.amazonses.com"]
}

# Root TXT record: SPF + Google site verification (must all be in one recordset)
resource "aws_route53_record" "spf" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "TXT"
  ttl     = 300
  records = [
    "v=spf1 include:amazonses.com include:resend.com ~all",
    "google-site-verification=ATwti6XWdVyDu_RJlJhqcBsq-Z_lkjA7nq8ooac",
    "google-site-verification=d1d667f41fecd0d0",
  ]
}

# DMARC Record
# Aggregate reports (rua) go to Postmark's free DMARC monitoring service,
# which parses the raw XML into human-readable digests. p=none = monitor only.
resource "aws_route53_record" "dmarc" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 300
  records = [
    "v=DMARC1; p=none; pct=100; rua=mailto:re+qh4cxpbzeku@dmarc.postmarkapp.com; sp=none; aspf=r;"
  ]
}

# SES MAIL FROM MX and SPF records
resource "aws_route53_record" "mail_from_mx" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = aws_ses_domain_mail_from.main.mail_from_domain
  type    = "MX"
  ttl     = 300
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = aws_ses_domain_mail_from.main.mail_from_domain
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com ~all"]
}

