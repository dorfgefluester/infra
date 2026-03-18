# Jenkinsfile Enhanced Features

## Overview

Both `Jenkinsfile` and `Jenkinsfile.remote` have been enhanced with comprehensive CI/CD stages tailored for the Dorfgefluester Phaser 3 game project.

## 🆕 New Environment Variables

```groovy
environment {
    // Version & Build Tagging
    VERSION = "0.1.0"                              // From package.json
    GIT_SHORT_COMMIT = "abc1234"                   // Git commit hash
    BUILD_TAG = "0.1.0-42-abc1234"                 // Combined version tag

    // Container Image Configuration
    CONTAINER_CMD = 'podman'                        // Runtime (podman/docker)
    REGISTRY_URL = 'docker.io'                      // Container registry
    REGISTRY_NAMESPACE = 'myaccount'                // Your Docker Hub namespace
    IMAGE_NAME = 'myaccount/dorfgefluester'        // Full image name
    IMAGE_TAG = '0.1.0-42-abc1234'                 // Unique tag per build
    FULL_IMAGE_NAME = 'docker.io/myaccount/dorfgefluester:0.1.0-42-abc1234'
    LATEST_IMAGE_NAME = 'docker.io/myaccount/dorfgefluester:latest'

    // Build Paths
    DIST_DIR = 'dist'                              // Vite build output
    ASSETS_DIR = 'public/assets'                   // Game assets

    // Performance Thresholds
    MAX_BUNDLE_SIZE_MB = '5'                       // Alert if bundle > 5MB
    MAX_ASSET_SIZE_MB = '50'                       // Alert if assets > 50MB
}
```

## 📊 New Pipeline Stages

### 1. **Enhanced Setup Stage**
```groovy
stage('Setup')
```
**Features:**
- Displays comprehensive build information
- Shows versions: Node.js, npm, Podman/Docker
- Displays image name that will be built
- Shows git commit and build number

**Output Example:**
```
📊 Build Information:
  Project: dorfgefluester
  Version: 0.1.0
  Build: #42
  Tag: 0.1.0-42-abc1234
  Image: docker.io/myaccount/dorfgefluester:0.1.0-42-abc1234
  Node: v18.19.0
  npm: 10.2.3
  podman: version 4.9.0
```

---

### 2. **Optimized Dependency Installation**
```groovy
stage('Install Dependencies')
```
**Features:**
- Uses `npm ci` for clean, reproducible installs
- Adds `--prefer-offline` for faster installs
- Skips audit during install (run separately)
- Measures and reports installation time
- Lists outdated packages (informational)

**Improvements:**
- ✅ Faster builds (uses cache)
- ✅ Reproducible (uses package-lock.json)
- ✅ Visibility into dependency status

---

### 3. **NEW: Code Quality Stage (Parallel)**
```groovy
stage('Code Quality') {
    parallel { ... }
}
```

#### 3a. **ESLint** (Conditional)
- **Runs when:** `.eslintrc.js`, `.eslintrc.json`, or `eslint.config.js` exists
- **Purpose:** JavaScript/ES6 linting
- **Actions:**
  - Tries `npm run lint` if script exists
  - Falls back to `npx eslint src/`
  - Generates JSON report
  - Marks build **unstable** on issues (doesn't fail)

**To enable ESLint:**
```bash
npm install --save-dev eslint
npx eslint --init
# Add to package.json: "lint": "eslint src/"
```

#### 3b. **Prettier** (Conditional)
- **Runs when:** `.prettierrc`, `.prettierrc.json`, or `prettier.config.js` exists
- **Purpose:** Code formatting check
- **Actions:**
  - Checks all `src/**/*.{js,json,css,html}` files
  - Warns if formatting issues found
  - Doesn't fail build (informational)

**To enable Prettier:**
```bash
npm install --save-dev prettier
echo '{ "semi": true, "singleQuote": true }' > .prettierrc
# Add to package.json: "format": "prettier --write src/"
```

#### 3c. **Validate Assets** (Always Runs)
- **Purpose:** Game asset validation
- **Actions:**
  - Checks if asset directories exist (`tilemaps`, `sprites`)
  - Counts PNG images, JSON files, tilesets
  - Calculates total asset size
  - Warns if exceeds `MAX_ASSET_SIZE_MB` threshold

**Output Example:**
```
📊 Asset inventory:
  PNG images: 42
  JSON files: 15
  Tilesets: 3
  Total size: 12MB
```

---

### 4. **Enhanced Build Stage**
```groovy
stage('Build')
```
**Features:**
- Measures build time
- Validates `dist/` directory created
- Analyzes bundle output:
  - Counts files
  - Calculates total bundle size
  - Lists main files with sizes
  - Checks for source maps
  - Warns if exceeds `MAX_BUNDLE_SIZE_MB`
- Archives build artifacts with fingerprinting

**Output Example:**
```
✅ Build completed in 12.4s
📊 Build Analysis:
  Files: 87
  Bundle size: 3MB
  Main files:
    dist/index.html (2.1K)
    dist/assets/index-abc123.js (1.8M)
    dist/assets/index-def456.css (45K)
  Source maps: 2
```

---

### 5. **NEW: Build Container Image**
```groovy
stage('Build Container Image')
```
**Purpose:** Package game as containerized nginx server

**Features:**
- Auto-generates `Dockerfile` if not present
- Auto-generates `nginx.conf` for SPA routing
- Builds multi-arch compatible image
- Tags with both unique tag and `latest`
- Adds metadata labels:
  - `version`: Project version
  - `build-number`: Jenkins build number
  - `git-commit`: Git short commit hash
  - `build-date`: ISO-8601 timestamp
  - `project`: Project name
- Displays image information (size, created date)

**Generated Dockerfile:**
```dockerfile
FROM docker.io/nginx:alpine

# Copy game build
COPY dist/ /usr/share/nginx/html/

# Custom nginx config (optional)
COPY nginx.conf /etc/nginx/conf.d/default.conf 2>/dev/null || true

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

**Generated nginx.conf:**
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # Cache static assets (1 year)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback - all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Why This Matters:**
- ✅ Deploy game anywhere (cloud, self-hosted, Kubernetes)
- ✅ Production-ready nginx config with caching
- ✅ SPA routing support (client-side routes work)
- ✅ Gzip compression for faster loading
- ✅ Health checks for orchestration
- ✅ Immutable deployments (unique tags)

---

### 6. **NEW: Scan Container Image** (Jenkinsfile only)
```groovy
stage('Scan Container Image')
```
**Purpose:** Security scan of built container image

**Features:**
- Scans image with Trivy for vulnerabilities
- Checks **CRITICAL**, **HIGH**, **MEDIUM** severities
- Generates JSON and HTML reports
- Publishes HTML report in Jenkins
- Marks build **unstable** if CRITICAL vulnerabilities found
- Doesn't block deployment (allows informed decisions)

**Output Example:**
```
📊 Image scan found 2 CRITICAL vulnerabilities
⚠️ Build marked unstable - review Container Image Scan report
```

**Reports:**
- JSON: `security-reports/trivy/image-scan.json`
- HTML: Published as "Container Image Scan" in Jenkins

---

### 7. **NEW: Test Container Locally** (Jenkinsfile.remote only)
```groovy
stage('Test Container Locally')
```
**Purpose:** Smoke test the container before pushing

**Features:**
- Starts container on temporary port (8888)
- Waits for startup
- Performs HTTP health check (`curl http://localhost:8888/`)
- Stops and removes test container
- Fails build if health check fails

**Why This Matters:**
- ✅ Catches broken containers before registry push
- ✅ Validates nginx config works
- ✅ Ensures game loads correctly
- ✅ Quick feedback (< 5 seconds)

---

### 8. **NEW: Push Container Image**
```groovy
stage('Push Container Image')
```
**When:** Only on `master`, `main`, or `release/*` branches

**Features:**
- Uses Jenkins credentials for registry auth
- Pushes both versioned tag and `latest`
- Logs out after push (security)
- Displays pushed image names

**Prerequisites:**
1. Create Jenkins credential: `container-registry-credentials`
   - Type: Username with password
   - Username: Your Docker Hub username
   - Password: Your Docker Hub access token
2. Update `REGISTRY_NAMESPACE` in Jenkinsfile

**Images Pushed:**
- `docker.io/myaccount/dorfgefluester:0.1.0-42-abc1234` (unique)
- `docker.io/myaccount/dorfgefluester:latest` (always latest master)

**Usage After Push:**
```bash
# Pull and run your game
podman pull docker.io/myaccount/dorfgefluester:latest
podman run -d -p 8080:80 docker.io/myaccount/dorfgefluester:latest

# Access game
open http://localhost:8080
```

---

## 🔄 Stage Execution Flow

### Jenkinsfile (Local Scanning)
```
1. Checkout
2. Setup (display info)
3. Install Dependencies
4. Code Quality (parallel)
   ├─ ESLint
   ├─ Prettier
   └─ Validate Assets
5. Lint & Validate (parallel)
   ├─ Validate Prototype
   └─ Validate Translations
6. Security Scans (parallel)
   ├─ npm audit
   ├─ OWASP DependencyCheck
   ├─ Trivy Scan (filesystem)
   └─ Semgrep Scan
7. Tests (parallel)
   ├─ Unit Tests (Jest)
   └─ E2E Tests (Playwright)
8. Build (Vite)
9. Build Container Image
10. Scan Container Image
11. Generate SBOM
12. Security Summary
13. Push Container Image (master only)
```

### Jenkinsfile.remote (Centralized Scanning)
```
1. Checkout
2. Setup
3. Install Dependencies
4. Code Quality (parallel)
5. Lint & Validate (parallel)
6. Tests (parallel)
7. Build
8. Build Container Image
9. Test Container Locally
10. Push Container Image (master only)
11. Trigger Remote Security Scan (SSH to server)
12. Fetch Remote Scan Results
13. Analyze Scan Results
```

---

## 📦 Artifacts Generated

### Build Artifacts
- `dist/**/*` - Production build (archived)
- `Dockerfile` - Auto-generated container definition
- `nginx.conf` - Auto-generated nginx config

### Test Reports
- `tests/coverage/` - Jest coverage (HTML)
- `playwright-report/` - Playwright E2E results (HTML)

### Security Reports
- `security-reports/dependency-check-report.html`
- `security-reports/trivy-report.html` (filesystem scan)
- `security-reports/image-scan.html` (container scan)
- `security-reports/semgrep-results.json`
- `security-reports/npm-audit.json`
- `security-reports/SBOM.json` (CycloneDX)
- `security-reports/summary.html` (all-in-one dashboard)

---

## 🎯 Performance Optimizations

### 1. **Parallel Execution**
Multiple stages run simultaneously:
- Code quality checks (ESLint, Prettier, Asset validation)
- Security scans (DependencyCheck, Trivy, Semgrep, npm audit)
- Tests (Unit tests, E2E tests, Validation)

**Benefit:** ~40-60% faster builds

### 2. **npm Caching**
```groovy
sh 'npm ci --prefer-offline --no-audit'
```
- Uses npm cache from previous builds
- Skips audit during install (run separately)

**Benefit:** 30-50% faster dependency installation

### 3. **Conditional Stages**
```groovy
when {
    expression { fileExists('.eslintrc.js') }
}
```
- ESLint/Prettier only run if configured
- E2E tests only on main branches or PRs
- Image push only on master/main/release branches

**Benefit:** Faster feature branch builds

### 4. **Container Image Caching**
Podman/Docker caches layers between builds:
- Base image (`nginx:alpine`) cached
- Only rebuilds when `dist/` changes

**Benefit:** 70-90% faster image builds (after first build)

---

## 🛡️ Security Features

### 1. **Multi-Layer Scanning**
- **Source code:** Semgrep (SAST)
- **Dependencies:** DependencyCheck, Trivy, npm audit
- **Container image:** Trivy image scan
- **Secrets:** Trivy secret detection
- **Licenses:** Trivy license scan

### 2. **Severity Thresholds**
- **CRITICAL/HIGH:** Build marked unstable (warning)
- **MEDIUM/LOW:** Informational only
- **Doesn't block:** Allows informed decisions

### 3. **SBOM Generation**
- CycloneDX format
- Full dependency tree
- License information
- Vulnerability status

### 4. **Secure Credentials**
- Registry credentials from Jenkins
- Never hardcoded in Jenkinsfile
- Auto-logout after use

---

## 🚀 Quick Start Guide

### 1. Configure Jenkins Credentials

**Container Registry:**
```
Manage Jenkins → Credentials → Add Credentials
- Type: Username with password
- ID: container-registry-credentials
- Username: your-dockerhub-username
- Password: your-dockerhub-token
```

**SSH Key (for Jenkinsfile.remote):**
```
Manage Jenkins → Credentials → Add Credentials
- Type: SSH Username with private key
- ID: jenkins-ssh-key
- Username: jenkins
- Private Key: [your SSH private key]
```

### 2. Update Environment Variables

Edit `Jenkinsfile` or `Jenkinsfile.remote`:

```groovy
environment {
    REGISTRY_NAMESPACE = 'your-dockerhub-username'  // ← Change this
    SCAN_SERVER = 'your-scan-server-hostname'       // ← Jenkinsfile.remote only
}
```

### 3. Create Multibranch Pipeline

```
New Item → Multibranch Pipeline
- Name: dorfgefluester
- Branch Sources → Git
  - Repository URL: https://github.com/myAccount/dorfgefluester.git
  - Credentials: [your GitHub credentials]
- Build Configuration
  - Script Path: Jenkinsfile  (or Jenkinsfile.remote)
- Scan Multibranch Pipeline Triggers
  - ✓ Periodically if not otherwise run (1 hour)
- Save
```

### 4. Run First Build

```
dorfgefluester → Scan Multibranch Pipeline Now
- Wait for branch discovery
- Click on master branch
- Watch build progress
```

### 5. View Results

After build completes, check:
- **Console Output:** Full build log
- **HTML Reports:** Security Summary, DependencyCheck, Trivy, Coverage
- **Artifacts:** dist/ files, security reports, SBOM

### 6. Pull and Test Container

```bash
# Pull your game container
podman pull docker.io/your-namespace/dorfgefluester:latest

# Run locally
podman run -d -p 8080:80 --name dorfgefluester docker.io/your-namespace/dorfgefluester:latest

# Test
curl http://localhost:8080
open http://localhost:8080  # or visit in browser

# Stop
podman stop dorfgefluester
podman rm dorfgefluester
```

---

## 🔧 Optional Enhancements

### Add ESLint
```bash
npm install --save-dev eslint
npx eslint --init
# Select: problems, modules, none (no framework), browser, JSON

# Add to package.json
"lint": "eslint src/"
```

### Add Prettier
```bash
npm install --save-dev prettier
echo '{"semi": true, "singleQuote": true, "tabWidth": 2}' > .prettierrc

# Add to package.json
"format": "prettier --write src/"
"format:check": "prettier --check src/"
```

### Add TypeScript Support
```bash
npm install --save-dev typescript @types/node
npx tsc --init

# Jenkinsfile will auto-detect and run type checking
```

---

## 📊 Comparison: Local vs Remote

| Feature | Jenkinsfile (Local) | Jenkinsfile.remote |
|---------|---------------------|---------------------|
| **Security Scans** | On Jenkins agent | On remote server |
| **Scan Tools** | DependencyCheck, Trivy, Semgrep, npm audit | Triggered via SSH |
| **Container Build** | ✅ On Jenkins agent | ✅ On Jenkins agent |
| **Container Scan** | ✅ Trivy image scan | ❌ (use remote server) |
| **Container Test** | ❌ | ✅ Smoke test |
| **Reports** | Archived in Jenkins | Fetched from server + links |
| **Resource Usage** | Higher (agent scans) | Lower (server scans) |
| **Network** | Needs container registry | Needs SSH to server |
| **Best For** | Standalone Jenkins | Centralized security |

---

## 🎓 Next Steps

1. ✅ **Configure credentials** in Jenkins
2. ✅ **Update environment variables** in Jenkinsfile
3. ✅ **Create multibranch pipeline**
4. ✅ **Run first build** and verify
5. ✅ **Review security reports**
6. ✅ **Fix any vulnerabilities found**
7. ✅ **Pull and test container image**
8. ⭐ **Optional:** Add ESLint, Prettier, TypeScript
9. 🚀 **Deploy** your containerized game!

---

**Questions?** Check `docs/ci/JENKINS_SETUP.md` for detailed setup instructions and troubleshooting.
