# Staging Infrastructure Notes

## Current Working Path

- Jenkins CI builds and release-branch validation run from the repository `Jenkinsfile`.
- Staging deployment runs from `jenkins/dorfgefluester-staging-deploy.Jenkinsfile`.
- The staging target host is `dev-env-01`.
- Jenkins connects to the staging host via SSH as user `deploy`.
- Kubernetes on the staging host is `k3s`.
- The app image is pulled from the local registry `dev-env-01:5000`.
- Staging ingress is working at `http://dev-env-01/dorfgefluester/`.

## Deployment Flow

1. Jenkins checks that the requested image tag exists in `dev-env-01:5000/dorfgefluester`.
2. Jenkins copies the Helm chart to the staging host and runs `helm upgrade --install`.
3. The deployment is verified with `kubectl rollout status`.
4. Jenkins verifies the ingress URL and then runs a smoke check that also fetches the built JS asset.

## Known Good State

- The app is reachable through Traefik ingress at `http://dev-env-01/dorfgefluester/`.
- k3s cluster access from Jenkins is working.
- The local container registry is working for staging pulls.
- Helm-based deployment to the `staging` namespace is working.
- The deployment flow now forces a fresh rollout for mutable tags such as `master-latest` by using `imagePullPolicy=Always` and a rollout nonce.
- The container now runs as non-root, matching the Kubernetes security context.

## Jenkins Runtime Notes

- CI and staging jobs use local workspace caches instead of an external artifact service.
- npm cache paths live under `"$WORKSPACE@tmp"` so they are writable inside containerized Jenkins steps.
- Docker build cache is also kept locally on the Jenkins worker.
- Old caches and Docker artifacts still need periodic cleanup; the maintenance pipeline is the intended place for that.

## Yellow Build Caveat

- A staging build can be yellow even when deployment succeeded.
- `dorfgefluester-INT #23` is the reference case: deploy, rollout, and smoke checks passed, but post-deploy Playwright synthetics made the job `UNSTABLE`.
- The staging deploy pipeline now installs the locked Node dependencies before running Playwright so that the synthetic stage does not depend on pre-existing `node_modules` in the workspace.
