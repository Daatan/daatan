# Design Document: Deployment Process Improvements

> **Archived spec (historical).** Implemented; root `DEPLOYMENT.md` was removed in #2039 — the current docs are `docs/DEPLOYMENT.md` and `docs/SECRETS.md`.

## Overview

This design document outlines the technical approach for improving the DAATAN deployment process. The solution focuses on four key areas: enhanced local verification, reliable staging authentication, automated version management, and comprehensive deployment monitoring. The design leverages existing infrastructure (GitHub Actions, Docker, NextAuth) while adding new automation and verification layers.

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Developer Workflow                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Local Verification (Pre-Commit + Pre-Push)                  │
│     - Build check                                                │
│     - Test execution                                             │
│     - Lint check                                                 │
│     - Auth verification (if changed)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Version Increment (Automated)                               │
│     - Detect change type (feat/fix/chore)                       │
│     - Increment version in package.json                         │
│     - Update version.ts                                          │
│     - Commit version bump                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. CI/CD Pipeline (GitHub Actions)                             │
│     - Build & Test                                               │
│     - Deploy to Staging                                          │
│     - Verify Staging (including auth)                           │
│     - Create git tag                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Deployment Monitoring                                        │
│     - Real-time logs                                             │
│     - Health checks                                              │
│     - Version verification                                       │
│     - Post-deployment metrics                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Local Verification System

#### Component: Pre-Commit Hook Enhancement
**Location:** `.husky/pre-commit`

**Current State:**
- Runs build only
- Uses dummy environment variables

**Enhanced Design:**
```bash
#!/bin/bash
# Enhanced pre-commit hook with comprehensive verification

set -e

echo "🔍 Running pre-commit verification..."

# Set dummy environment variables
export DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
export NEXTAUTH_SECRET="dummy-secret-for-build"
export NEXTAUTH_URL="http://localhost:3000"

# 1. Build verification
echo "📦 Building application..."
npm run build

# 2. Test execution
echo "🧪 Running tests..."
npm test

# 3. Lint check
echo "🔍 Running linter..."
npm run lint || true

echo "✅ Pre-commit verification passed!"
```

#### Component: Pre-Push Hook (New)
**Location:** `.husky/pre-push`

**Purpose:** Additional verification before pushing to remote

**Design:**
```bash
#!/bin/bash
# Pre-push verification with auth check

set -e

echo "🚀 Running pre-push verification..."

# Check if auth-related files changed
AUTH_FILES_CHANGED=$(git diff --name-only origin/main...HEAD | grep -E "(auth|session|login)" || true)

if [ -n "$AUTH_FILES_CHANGED" ]; then
  echo "⚠️  Authentication files changed. Please verify:"
  echo "   1. Test login flow locally"
  echo "   2. Verify OAuth configuration"
  echo "   3. Check session management"
  echo ""
  read -p "Have you tested auth locally? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Please test authentication before pushing"
    exit 1
  fi
fi

echo "✅ Pre-push verification passed!"
```

#### Component: Local Verification Script (New)
**Location:** `scripts/verify-local.sh`

**Purpose:** Comprehensive local verification that developers can run manually

**Interface:**
```bash
#!/bin/bash
# Comprehensive local verification script

verify_local() {
  echo "🔍 DAATAN Local Verification"
  echo "============================"
  
  # 1. Check Node version
  # 2. Verify dependencies
  # 3. Run build
  # 4. Run tests
  # 5. Run linter
  # 6. Check for uncommitted changes
  # 7. Verify environment variables
  
  return 0 or 1
}
```

### 2. Staging Authentication System

#### Component: OAuth Configuration Validator
**Location:** `scripts/verify-auth-config.sh`

**Purpose:** Verify OAuth configuration for staging environment

**Design:**
```bash
#!/bin/bash
# Verify OAuth configuration

check_oauth_config() {
  # 1. Verify GOOGLE_CLIENT_ID is set
  # 2. Verify GOOGLE_CLIENT_SECRET is set
  # 3. Verify NEXTAUTH_URL matches environment
  # 4. Verify NEXTAUTH_SECRET is set
  # 5. Check OAuth callback URLs in Google Console
}
```

#### Component: Authentication Health Check
**Location:** `src/app/api/auth/health/route.ts` (New)

**Purpose:** Dedicated endpoint to verify auth system health

**Interface:**
```typescript
// GET /api/auth/health
Response: {
  status: "ok" | "error",
  provider: "google",
  configured: boolean,
  callbackUrl: string,
  timestamp: string
}
```

**Design:**
```typescript
export async function GET() {
  const isConfigured = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.NEXTAUTH_SECRET &&
    process.env.NEXTAUTH_URL
  )
  
  return Response.json({
    status: isConfigured ? "ok" : "error",
    provider: "google",
    configured: isConfigured,
    callbackUrl: process.env.NEXTAUTH_URL + "/api/auth/callback/google",
    timestamp: new Date().toISOString()
  })
}
```

#### Component: Enhanced Deployment Verification
**Location:** `scripts/verify-deploy.sh` (Enhanced)

**Current State:** Checks health and version only

**Enhanced Design:**
- Add authentication health check
- Verify OAuth configuration
- Test auth callback URL accessibility

### 3. Automated Version Management

#### Component: Version Increment Script
**Location:** `scripts/increment-version.sh` (New)

**Purpose:** Automatically increment version based on commit messages

**Design:**
```bash
#!/bin/bash
# Automatic version increment based on conventional commits

increment_version() {
  CURRENT_VERSION=$(node -p "require('./package.json').version")
  
  # Parse commit messages since last tag
  COMMITS=$(git log $(git describe --tags --abbrev=0)..HEAD --oneline)
  
  # Determine version bump type
  if echo "$COMMITS" | grep -q "BREAKING CHANGE\|^feat!:"; then
    BUMP_TYPE="major"
  elif echo "$COMMITS" | grep -q "^feat:"; then
    BUMP_TYPE="minor"
  else
    BUMP_TYPE="patch"
  fi
  
  # Calculate new version
  NEW_VERSION=$(npm version $BUMP_TYPE --no-git-tag-version)
  
  # Update version.ts
  echo "export const VERSION = '$NEW_VERSION'" > src/lib/version.ts
  
  # Commit changes
  git add package.json package-lock.json src/lib/version.ts
  git commit -m "chore: bump version to $NEW_VERSION"
  
  echo $NEW_VERSION
}
```

#### Component: GitHub Actions Version Workflow
**Location:** `.github/workflows/version.yml` (New)

**Purpose:** Automate version increment on merge to main

**Trigger:** On push to main branch

**Steps:**
1. Checkout code
2. Run increment-version.sh
3. Push version commit
4. Create git tag
5. Push tag

**Design:**
```yaml
name: Version Increment

on:
  push:
    branches:
      - main

jobs:
  increment-version:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Configure Git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
      
      - name: Increment Version
        run: ./scripts/increment-version.sh
      
      - name: Push Changes
        run: |
          git push origin main
          git push origin --tags
```

#### Component: Version Synchronization
**Purpose:** Ensure version.ts and package.json stay in sync

**Approach:**
- Single source of truth: package.json
- version.ts generated from package.json
- Pre-commit hook validates synchronization

### 4. Deployment Monitoring System

#### Component: Enhanced Deployment Logs
**Location:** `.github/workflows/deploy.yml` (Enhanced)

**Current State:** Basic deployment logs

**Enhanced Design:**
- Add timestamps to all log entries
- Include deployment metrics (duration, size)
- Add structured logging for parsing
- Include health check results in logs

#### Component: Deployment Dashboard Script
**Location:** `scripts/monitor-deploy.sh` (New)

**Purpose:** Real-time monitoring of deployment progress

**Interface:**
```bash
#!/bin/bash
# Monitor deployment in real-time

monitor_deploy() {
  ENVIRONMENT=$1  # staging or production
  URL="https://${ENVIRONMENT}.daatan.com"
  
  echo "📊 Monitoring $ENVIRONMENT deployment..."
  
  # 1. Watch GitHub Actions logs
  # 2. Poll health endpoint
  # 3. Check version updates
  # 4. Monitor error rates
  # 5. Display metrics
}
```

**Features:**
- Real-time health check polling
- Version verification
- Response time tracking
- Error rate monitoring
- Auto-refresh display

#### Component: Post-Deployment Metrics
**Location:** `scripts/post-deploy-metrics.sh` (New)

**Purpose:** Collect and display metrics after deployment

**Metrics Collected:**
- Deployment duration
- Health check response time
- First successful request time
- Error count in first 30 minutes
- Container restart count

#### Component: Deployment Notification System
**Purpose:** Alert team of deployment status

**Integration Points:**
- GitHub Actions status checks
- Slack/Discord webhook (optional)
- Email notifications (optional)

**Design:**
```yaml
# In .github/workflows/deploy.yml
- name: Notify Deployment Status
  if: always()
  run: |
    if [ "${{ job.status }}" == "success" ]; then
      echo "✅ Deployment successful"
      # Send success notification
    else
      echo "❌ Deployment failed"
      # Send failure notification with logs
    fi
```

## Data Models

### Version Information
```typescript
interface VersionInfo {
  version: string;        // Semantic version (e.g., "0.1.17")
  timestamp: string;      // ISO 8601 timestamp
  commit: string;         // Git commit hash
  environment: string;    // "staging" | "production"
}
```

### Deployment Metrics
```typescript
interface DeploymentMetrics {
  deploymentId: string;
  environment: string;
  version: string;
  startTime: string;
  endTime: string;
  duration: number;       // seconds
  healthCheckTime: number; // milliseconds
  success: boolean;
  errorCount: number;
}
```

### Authentication Health
```typescript
interface AuthHealth {
  status: "ok" | "error";
  provider: string;
  configured: boolean;
  callbackUrl: string;
  timestamp: string;
  error?: string;
}
```

## Error Handling

### Local Verification Failures
- **Build Failure:** Block commit, display build errors
- **Test Failure:** Block commit, display failing tests
- **Lint Failure:** Warn but allow commit (configurable)
- **Auth Check Failure:** Block push, require manual verification

### Staging Deployment Failures
- **Build Failure:** Stop deployment, notify team
- **Health Check Failure:** Rollback deployment, alert team
- **Auth Check Failure:** Stop deployment, provide OAuth config instructions
- **Version Mismatch:** Warn but continue (version may not be updated yet)

### Version Increment Failures
- **Git Conflict:** Retry after pull
- **Permission Error:** Notify team, require manual intervention
- **Invalid Version:** Fallback to patch increment

### Monitoring Failures
- **Health Check Timeout:** Retry 3 times, then alert
- **Version Mismatch:** Alert team, provide rollback instructions
- **High Error Rate:** Alert team, suggest rollback

## Testing Strategy

### Unit Tests
- Version increment logic
- Version synchronization validation
- Auth configuration validation
- Health check endpoint

### Integration Tests
- Full local verification workflow
- Version increment + commit + tag flow
- Deployment + health check + version verification
- Auth health check in staging

### End-to-End Tests
- Complete deployment pipeline (staging)
- Rollback procedure
- Monitoring and alerting
- Authentication flow in staging

### Manual Testing Checklist
1. Run local verification script
2. Test pre-commit hook with various changes
3. Test pre-push hook with auth changes
4. Verify version increment on merge
5. Test staging deployment with auth verification
6. Monitor deployment in real-time
7. Verify rollback procedure
8. Test production deployment

## Security Considerations

### Secrets Management
- OAuth credentials stored in GitHub Secrets
- Never log sensitive information
- Validate environment variables before use
- Use secure token for version commits

### Authentication Verification
- Verify OAuth callback URLs match environment
- Check for proper HTTPS configuration
- Validate NEXTAUTH_SECRET strength
- Ensure session security settings

### Deployment Security
- Verify code integrity before deployment
- Use signed commits (optional)
- Audit deployment logs
- Restrict deployment permissions

## Performance Considerations

### Local Verification
- Parallel execution of build and tests where possible
- Cache dependencies to speed up checks
- Skip unnecessary checks based on changed files

### Version Management
- Lightweight version increment (< 5 seconds)
- Minimal git operations
- Efficient commit message parsing

### Deployment Monitoring
- Efficient polling intervals (5-10 seconds)
- Limit log retention
- Async metric collection

## Migration Plan

### Phase 1: Local Verification (Week 1)
1. Enhance pre-commit hook
2. Create pre-push hook
3. Create local verification script
4. Update documentation

### Phase 2: Authentication Verification (Week 1-2)
1. Create auth health endpoint
2. Enhance deployment verification script
3. Add OAuth configuration validator
4. Test in staging

### Phase 3: Version Automation (Week 2)
1. Create version increment script
2. Create GitHub Actions workflow
3. Test version synchronization
4. Update CI/CD pipeline

### Phase 4: Monitoring (Week 2-3)
1. Enhance deployment logs
2. Create monitoring script
3. Add post-deployment metrics
4. Set up notifications

### Phase 5: Documentation & Training (Week 3)
1. Update DEPLOYMENT.md
2. Create runbook for new processes
3. Team training session
4. Gather feedback and iterate

## Dependencies

### External Dependencies
- GitHub Actions
- Node.js 20+
- npm
- Git
- Docker (for deployment)
- Bash (for scripts)

### Internal Dependencies
- Existing CI/CD pipeline
- NextAuth configuration
- Health check endpoint
- Deployment scripts

### New Dependencies
- None (using existing tools)

## Rollback Strategy

### If Local Verification Causes Issues
- Temporarily disable hooks: `git commit --no-verify`
- Fix verification script
- Re-enable hooks

### If Version Automation Fails
- Manual version increment
- Create tag manually
- Deploy using existing process

### If Auth Verification Fails
- Skip auth check temporarily
- Fix OAuth configuration
- Re-run deployment

### If Monitoring Fails
- Deployment continues normally
- Fix monitoring scripts
- Monitor manually

## Success Metrics

### Local Verification
- 100% of commits pass local checks
- < 5% of commits use --no-verify
- Reduced staging deployment failures by 50%

### Authentication
- 100% auth health check pass rate in staging
- Zero auth-related production incidents
- < 1 minute to detect auth issues

### Version Management
- 100% automated version increments
- Zero manual version updates needed
- Accurate version tracking

### Monitoring
- 100% deployment visibility
- < 2 minutes to detect deployment issues
- < 5 minutes mean time to alert

## Future Enhancements

### Short Term
- Add Slack/Discord notifications
- Implement deployment dashboard UI
- Add performance regression detection

### Medium Term
- Automated rollback on failure
- Canary deployments
- A/B testing support

### Long Term
- Multi-region deployment monitoring
- Predictive failure detection
- Self-healing deployments
