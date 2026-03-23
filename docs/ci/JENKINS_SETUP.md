# Jenkins CI/CD Setup for Dorfgefluester

## Overview

This project includes two Jenkins pipeline configurations for CI/CD with integrated security scanning.

## Jenkinsfile Options

### 1. `Jenkinsfile` - Local Scanning (Default)

**When to use:** Jenkins agents have Podman/Docker available and can run security scans locally.

**Features:**
- ✅ All scans run on Jenkins agent
- ✅ OWASP DependencyCheck
- ✅ Trivy (vulnerability, secret, license scanning)
- ✅ Semgrep SAST
- ✅ npm audit
- ✅ Unit tests (Jest)
- ✅ E2E tests (Playwright)
- ✅ Production build
- ✅ SBOM generation
- ✅ HTML reports published in Jenkins

**Requirements:**
- Podman or Docker on Jenkins agent
- Node.js 18+
- Access to container registries

---

### 2. `Jenkinsfile.remote` - Centralized Scanning

**When to use:** You have a dedicated scan server (like your "docker" server running SonarQube).

**Features:**
- ✅ Triggers scans on remote server via SSH
- ✅ Matches existing SonarQube workflow
- ✅ Fetches reports back to Jenkins
- ✅ Links to live reports on scan server
- ✅ Lighter Jenkins agent requirements
- ✅ Unit/E2E tests still run locally
- ✅ Production build

**Requirements:**
- SSH access to scan server
- Jenkins SSH credentials configured
- Scan server setup (from plan)

---

## Setup Instructions

### Option 1: Local Scanning (Jenkinsfile)

#### 1. Install Podman on Jenkins Agent

```bash
# RHEL/CentOS/Fedora
sudo dnf install podman

# Ubuntu/Debian
sudo apt-get install podman

# Verify
podman --version
```

#### 2. Pull Container Images

```bash
podman pull docker.io/owasp/dependency-check:latest
podman pull docker.io/aquasec/trivy@sha256:7228e304ae0f610a1fad937baa463598cadac0c2ac4027cc68f3a8b997115689
podman pull docker.io/returntocorp/semgrep:latest
```

#### 3. Create Jenkins Job

1. New Item → Multibranch Pipeline
2. Branch Sources → Add Git repository
3. Script Path: `Jenkinsfile`
4. Save and scan repository

---

### Option 2: Centralized Scanning (Jenkinsfile.remote)

#### 1. Setup Scan Server

Follow the plan in `/home/pinguin/.claude/plans/idempotent-hugging-parrot.md`:

```bash
# On "docker" server
ssh docker
sudo /opt/scans/scripts/setup-server.sh
```

#### 2. Configure SSH Key in Jenkins

1. Jenkins → Manage Jenkins → Credentials
2. Add SSH Username with Private Key
3. ID: `jenkins-ssh-key`
4. Username: Your SSH user on scan server
5. Private Key: Enter directly or from file

#### 3. Test SSH Connection

```bash
# From Jenkins agent
ssh -i /path/to/key jenkins@docker 'echo "Connection successful"'
```

#### 4. Update Environment Variables

Edit `Jenkinsfile.remote`:

```groovy
environment {
    SCAN_SERVER = 'docker'           // Your server hostname/IP
    SCAN_SERVER_USER = 'jenkins'     // SSH username
    REPORT_URL = 'http://docker:8080' // Report server URL
}
```

#### 5. Create Jenkins Job

1. New Item → Multibranch Pipeline
2. Branch Sources → Add Git repository
3. Script Path: `Jenkinsfile.remote`
4. Save and scan repository

---

## Pipeline Stages

### Both Pipelines Include:

1. **Checkout** - Clone repository
2. **Setup** - Verify Node.js environment
3. **Install Dependencies** - `npm ci`
4. **Lint & Validate** - Run validation scripts
5. **Tests** - Jest unit tests + optional Playwright E2E
6. **Build** - Production build with Vite
7. **Security Scans** - DependencyCheck, Trivy, Semgrep, npm audit
8. **Reports** - Generate and publish reports

**Playwright E2E in CI (this repo):**
- Implemented in the root `Jenkinsfile` as stage `E2E (Release Happy Path)`.
- Runs automatically on version branches (e.g. `0.5.4`) and can be forced via Jenkins parameter `RUN_E2E=true`.
- Artifacts are archived: `playwright-report/**/*` + `tests/test-results/**/*` (includes screenshots/traces/videos per config).

### Key Differences:

| Stage | Jenkinsfile (Local) | Jenkinsfile.remote (Centralized) |
|-------|---------------------|----------------------------------|
| Security Scans | Runs on Jenkins agent | Triggers on remote server |
| Report Storage | Jenkins artifacts | Remote server + cached copy |
| Resource Usage | Higher (agent runs scans) | Lower (server runs scans) |
| Network | Needs container registry | Needs SSH to server |

---

## Viewing Reports

### Local Scanning (Jenkinsfile)

Reports available in Jenkins:
- **Security Summary**: Blue Ocean → Artifacts → security-reports/summary.html
- **DependencyCheck**: Blue Ocean → HTML Reports → DependencyCheck Report
- **Trivy**: Blue Ocean → HTML Reports → Trivy Report
- **Code Coverage**: Blue Ocean → HTML Reports → Code Coverage

### Centralized Scanning (Jenkinsfile.remote)

Reports available on scan server:
- **Live Dashboard**: http://docker:8080/latest/summary.html
- **DependencyCheck**: http://docker:8080/dependency-check/
- **Trivy**: http://docker:8080/trivy/
- **SBOM**: http://docker:8080/sbom/SBOM.json

Cached copies also in Jenkins artifacts.

---

## Configuration Files

### Suppress False Positives

**DependencyCheck**: `config/security/dependency-check-suppression.xml`
```xml
<suppress>
  <notes>Justification for suppression</notes>
  <packageUrl regex="true">^pkg:npm/package-name@.*$</packageUrl>
  <cve>CVE-2024-XXXXX</cve>
</suppress>
```

**Trivy**: `.trivyignore` (root of repo)
```
CVE-2024-XXXXX  # Comment explaining why suppressed
```

### Adjust Severity Thresholds

Edit Jenkinsfile to change failure criteria:

```groovy
// Fail on critical only (not high)
if (criticalCount.toInteger() > 0) {
    error("Critical vulnerabilities found")
}
```

---

## Troubleshooting

### Issue: "podman: command not found"

**Solution**: Install Podman on Jenkins agent or use `Jenkinsfile.remote`

### Issue: SSH connection failed

**Solution**:
```bash
# Test SSH manually
ssh -vvv jenkins@docker

# Check Jenkins credential ID matches
// In Jenkinsfile.remote
sshagent(['jenkins-ssh-key']) { ... }
```

### Issue: Container pull fails

**Solution**:
```bash
# Use fully qualified image names
docker.io/owasp/dependency-check:latest  # ✓ Good
owasp/dependency-check:latest            # ✗ May fail
```

### Issue: npm audit fails pipeline

**Solution**: npm audit sets unstable (warning) not failure. To ignore:
```groovy
sh 'npm audit --json > npm-audit.json || true'
```

### Issue: E2E tests fail in Jenkins

**Solution**: In this repo, Playwright runs inside a version-matched Playwright Docker image (so browsers are included).
If E2E fails:
- Open Jenkins build artifacts: `playwright-report/index.html` for the HTML report (screenshots attached).
- Check `tests/test-results/` for per-test output (screenshots/videos/traces).

---

## Performance Optimization

### Cache npm Modules

Add to Jenkinsfile:
```groovy
stage('Install Dependencies') {
    steps {
        script {
            // Cache node_modules between builds
            def cacheDir = "/var/jenkins_home/npm-cache/${PROJECT_NAME}"
            sh """
                mkdir -p ${cacheDir}
                npm ci --cache ${cacheDir}
            """
        }
    }
}
```

### Cache CVE Database

For local scanning, persist DependencyCheck data:
```groovy
// Use named volume
-v dependency-check-data:/usr/share/dependency-check/data
```

For remote scanning, data already persisted on server.

### Parallel Stages

Both Jenkinsfiles already use `parallel` blocks:
- Security scans run in parallel
- Tests run in parallel
- Validation scripts run in parallel

---

## Integration with GitHub/GitLab

### GitHub Integration

Add webhook for automatic builds:
1. GitHub repo → Settings → Webhooks
2. Payload URL: `https://jenkins.example.com/github-webhook/`
3. Content type: `application/json`
4. Events: Push, Pull Request

### Status Checks

Add to Jenkinsfile:
```groovy
post {
    success {
        script {
            if (env.CHANGE_ID) {
                // Update PR status
                githubNotify status: 'SUCCESS',
                             description: 'Security scans passed',
                             context: 'security/scans'
            }
        }
    }
}
```

---

## Security Best Practices

1. **Never commit secrets** - Use Jenkins credentials
2. **Review suppression files** - Monthly audit of `.trivyignore`
3. **Update dependencies** - Weekly `npm update`
4. **Rotate PATs** - Quarterly GitHub/scan server tokens
5. **Monitor scan results** - Address CRITICAL within 24h, HIGH within 1 week

---

## Choosing Which Jenkinsfile to Use

**Use `Jenkinsfile` (local) if:**
- ✓ Jenkins agents have container runtime
- ✓ No centralized scan server available
- ✓ Want all scans in Jenkins artifacts
- ✓ Simpler infrastructure

**Use `Jenkinsfile.remote` (centralized) if:**
- ✓ Already have scan server (like SonarQube)
- ✓ Jenkins agents are lightweight
- ✓ Want consistent scan environment
- ✓ Multiple projects share scan infrastructure

**Pro tip:** You can use both! Rename to:
- `Jenkinsfile.local` - For feature branches
- `Jenkinsfile.remote` - For master/main branch

---

## Next Steps

1. Choose your Jenkinsfile approach
2. Set up infrastructure (Podman OR scan server)
3. Create Jenkins multibranch pipeline
4. Configure SSH credentials (if using remote)
5. Push code and watch pipeline run
6. Review security reports
7. Address vulnerabilities
8. Iterate! 🚀

---

**Questions?** Check the security scanning plan: `/home/pinguin/.claude/plans/idempotent-hugging-parrot.md`
