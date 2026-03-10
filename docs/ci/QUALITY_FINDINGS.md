# Quality & Security Findings (How to Pull Snapshots)

This repo can pull “backlog snapshots” from:
- SonarQube (code quality / security issues via Web API)
- Trivy (filesystem scan results via container runtime)
- Jenkins runtime scans (Gitleaks secrets, ZAP DAST, k6 load smoke) via pipeline artifacts

The goal is to make these findings easy to review and turn into upcoming tasks.

## SonarQube (Community Edition compatible)

### Requirements
- SonarQube token with permission to browse the project
- Host URL (including context path if any, e.g. `https://sonar.example.com` or `https://sonar.example.com/sonar`)

### Run
```bash
export SONAR_HOST_URL="http://sonarqube:9000"
export SONAR_TOKEN="your_token"
export SONAR_PROJECT_KEY="dorfgefluester"   # optional (default)

npm run quality:sonar
```

### Outputs
- `reports/sonarqube/issues.json` (full, paginated issue list + measures)
- `docs/ci/SONARQUBE_ISSUES.md` (summary + top issues for backlog)

## SonarQube Report (impact-based triage)

This report focuses on **impact-based** issue slices (Security/Reliability/Maintainability) and emits a
single JSON payload that’s easy to turn into “fix next” tasks.

### Run
```bash
export SONAR_HOST_URL="http://sonarqube:9000"
export SONAR_TOKEN="your_token"
export SONAR_PROJECT_KEY="dorfgefluester"   # optional (default)

npm run quality:sonar:report
```

Alternative (bash wrapper):
```bash
./scripts/sonar-report.sh --project-key dorfgefluester --strict false
```

### Outputs
- `reports/sonarqube/sonar-report.json` (structured report: measures + impact-based issue lists)
- `reports/sonarqube/sonar-report.md` (human-readable summary)

### JSON shape (synthetic example, matches this repo’s script output)
```json
{
  "generatedAt": "2026-03-08T12:34:56.000Z",
  "hostUrl": "http://sonarqube:9000",
  "projectKey": "dorfgefluester",
  "qualityGate": {
    "status": "OK",
    "conditions": []
  },
  "measures": { "coverage": "26.9", "security_rating": "3.0" },
  "reliability_high": [
    {
      "key": "AY-issue-key",
      "message": "Example issue message…",
      "file": "src/systems/SaveSystem.js",
      "line": 123,
      "rule": "javascript:S1234",
      "impacts": [
        { "softwareQuality": "RELIABILITY", "severity": "HIGH" }
      ]
    }
  ],
  "security_high": [],
  "maintainability_high": [],
  "totals": {
    "reliability_high": 1,
    "reliability_medium": 0,
    "security_high": 0,
    "maintainability_high": 0,
    "hotspots": 0
  }
}
```

## Jenkins integration (recommended)

The main `Jenkinsfile` prints the Sonar report markdown into the console and archives the JSON/MD
under `reports/sonarqube/`.

Build result policy:
- SonarQube **Quality Gate** is logged as **informational** (does not fail or mark UNSTABLE).
- The pipeline marks the build **UNSTABLE only** when `sonar-report.json` reports any **HIGH-impact**
  Reliability or Security issues.

Optional: enable extra scanner logs by setting the Jenkins parameter `SONAR_VERBOSE=true` (default is off).

## Trivy FS Scan

### Requirements
- One of:
  - `docker` or `podman` available locally (for `aquasec/trivy:latest`)
  - local `trivy` binary in `$PATH`

### Run
```bash
npm run quality:trivy
```

### Outputs
- `reports/trivy/fs.json` (full Trivy JSON output)
- `docs/ci/TRIVY_FINDINGS.md` (summary + top findings for backlog)

## Pull both (recommended)
```bash
npm run quality:pull
```

By default, this runner is best-effort: if SonarQube credentials or Trivy runtime are missing,
it prints a skip message and continues without failing.

To enforce hard failure when required tooling/env is absent:

```bash
node scripts/quality/pull-findings.cjs --strict true
```

## Troubleshooting

- **Self-signed SonarQube TLS**: If your SonarQube uses a self-signed certificate, Node may fail TLS validation. Prefer fixing the cert chain; as a last resort for local use: `NODE_TLS_REJECT_UNAUTHORIZED=0 npm run quality:sonar`.
- **Large issue counts**: `docs/ci/SONARQUBE_ISSUES.md` lists only the “top” issues (default 200). The full list is always in `reports/sonarqube/issues.json`.

## Deployed staging scans (Jenkins artifacts)

When you deploy to staging via `jenkins/dorfgefluester-staging-deploy.Jenkinsfile`, the pipeline can run:
- **OWASP ZAP baseline (DAST)** against `http://dev-env-01/dorfgefluester/` and archive `reports/zap/*`.
- **k6 smoke load test** against `http://dev-env-01/dorfgefluester/` and archive `reports/k6/summary.json`.

In the main CI pipeline (`Jenkinsfile`), the repo also runs:
- **Gitleaks** secrets scan and archives `reports/gitleaks/gitleaks.json`.
