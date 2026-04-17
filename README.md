# dorfgefluester-infra

> Dorfgeflüster — Infrastructure, Helm, ArgoCD, Nginx, Jenkins, local dev

This repository was split from the [dorfgefluester monorepo](https://github.com/StephanOnTour/dorfgefluester).

## Related Repositories

| Repo | Purpose |
|------|---------|
| [dorfgefluester-frontend](https://github.com/StephanOnTour/dorfgefluester-frontend) | Phaser 3 game, Vite build, E2E tests |
| [dorfgefluester-backend](https://github.com/StephanOnTour/dorfgefluester-backend) | Node.js API, PostgreSQL, Redis |
| [dorfgefluester-infra](https://github.com/StephanOnTour/dorfgefluester-infra) | This repo — Helm, ArgoCD, Nginx, Jenkins, local dev compose |

## Local Development

Start the full stack locally:

```bash
podman compose up
```

This starts: PostgreSQL, Redis, API server, and worker. Frontend runs separately in [dorfgefluester-frontend](https://github.com/StephanOnTour/dorfgefluester-frontend).

## Contents

- `infra/helm/` — Helm chart for K3s deployment
- `infra/argocd/` — ArgoCD app definitions
- `infra/nginx/` — Nginx reverse proxy config
- `infra/jenkins/` — Jenkins agent configs
- `compose.yaml` — Local dev environment (Podman/Docker)
- `scripts/quality/` — SonarQube, Trivy, skill gate scripts
- `scripts/ci/` — CI helper scripts
- `tests/contract/` — Staging, GitOps, pipeline smoke contracts
- `tests/k6/` — Load tests
