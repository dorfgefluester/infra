# Argo CD GitOps Rollout

This is the target staging workflow for `dorfgefluester` on `dev-env-01`.

## Current Repo Assumptions

- Helm chart path: `helm/dorfgefluester`
- Staging values file: `helm/dorfgefluester/values-staging.yaml`
- Staging namespace: `dorfgefluester`
- Staging ingress URL: `http://dev-env-01/dorfgefluester/`
- Runtime database secret expected by the chart: `dorfgefluester-postgres`
- Argo CD runs on `argocd-01` and deploys to the remote k3s cluster on `dev-env-01`

## Desired GitOps Flow

1. Manually merge the release branch into `master`.
2. Jenkins builds `master` and pushes immutable image tags.
3. Jenkins updates `helm/dorfgefluester/values-staging.yaml` on `master` with the new image tag(s).
4. Argo CD detects the Git change on `master` and shows `OutOfSync`.
5. Review the Argo CD diff.
6. Run a manual sync.
7. Verify the rollout on `dev-env-01`.

Argo CD does not deploy "latest image in the registry" by itself. A Git change must drive the deployment.

The staging Argo application must track `master`, not a release branch, if `master` is your deployment branch.

## Required Repo Manifests

- Argo CD application: `infra/argocd/dorfgefluester-staging.application.yaml`
- Sealed Secret example: `infra/argocd/sealed-secrets/dorfgefluester-postgres.sealedsecret.yaml.example`

## Step-By-Step Commands By Host

### Host: `argocd-01`

Install Argo CD if it is not already installed:

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl get pods -n argocd
```

Expose the UI temporarily:

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

Or use the existing Traefik path-based ingress:

```bash
kubectl -n argocd get ingress
```

Log in with the CLI:

```bash
argocd login argocd-01 --grpc-web --grpc-web-root-path /argocd --plaintext
```

Verify the remote cluster is registered in Argo CD and apply the staging application manifest:

```bash
argocd cluster list
sudo k3s kubectl apply -f infra/argocd/dorfgefluester-staging.application.yaml
argocd app get dorfgefluester-staging
argocd app diff dorfgefluester-staging
```

Confirm the app tracks `master`:

```bash
argocd app get dorfgefluester-staging | rg "Target:|Helm Values:"
```

Keep sync manual for the first rollout:

```bash
argocd app set dorfgefluester-staging --sync-policy none
argocd app get dorfgefluester-staging
```

Install Sealed Secrets if not already present:

```bash
kubectl create namespace sealed-secrets --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/latest/download/controller.yaml
kubectl -n sealed-secrets get pods
```

Fetch the controller certificate for sealing:

```bash
kubeseal --fetch-cert > /tmp/sealed-secrets-cert.pem
```

### Host: local repo workspace

Prepare the plain Secret manifest locally without committing it:

```bash
cat > /tmp/dorfgefluester-postgres.secret.yaml <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: dorfgefluester-postgres
  namespace: dorfgefluester
type: Opaque
stringData:
  postgres-db: dorfgefluester
  postgres-user: dorfgefluester
  postgres-password: REPLACE_ME
  database-url: postgres://dorfgefluester:REPLACE_ME@dorfgefluester-postgres:5432/dorfgefluester
EOF
```

Seal it against the cluster certificate and write the committed manifest:

```bash
kubeseal --format yaml --cert /tmp/sealed-secrets-cert.pem < /tmp/dorfgefluester-postgres.secret.yaml > infra/argocd/sealed-secrets/dorfgefluester-postgres.sealedsecret.yaml
rm -f /tmp/dorfgefluester-postgres.secret.yaml
```

Commit the Argo CD app and Sealed Secret:

```bash
git add infra/argocd/dorfgefluester-staging.application.yaml infra/argocd/sealed-secrets/dorfgefluester-postgres.sealedsecret.yaml
git commit -m "Add Argo CD staging app and sealed secret"
git push
```

### Host: `dev-env-01`

Apply the sealed secret on the target cluster:

```bash
sudo k3s kubectl create namespace dorfgefluester --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo k3s kubectl apply -f /tmp/dorfgefluester-postgres.sealedsecret.yaml
sudo k3s kubectl -n dorfgefluester get sealedsecret,secrets | grep dorfgefluester-postgres
```

### Host: `argocd-01`

Refresh and inspect the Argo app:

```bash
argocd app get dorfgefluester-staging
argocd app diff dorfgefluester-staging
```

Run the first manual sync only after the diff looks correct:

```bash
argocd app sync dorfgefluester-staging
argocd app wait dorfgefluester-staging --health --sync
```

### Host: `dev-env-01`

Verify the rollout:

```bash
sudo k3s kubectl -n dorfgefluester get all
sudo k3s kubectl -n dorfgefluester get ingress
curl -I http://dev-env-01/dorfgefluester/
curl -fsS http://dev-env-01/dorfgefluester/healthz
curl -fsS http://dev-env-01/api/health
```

If a rollout is unhealthy:

```bash
sudo k3s kubectl -n dorfgefluester describe deploy dorfgefluester
sudo k3s kubectl -n dorfgefluester get pods
sudo k3s kubectl -n dorfgefluester logs deploy/dorfgefluester -c api --previous
sudo k3s kubectl -n dorfgefluester logs deploy/dorfgefluester -c web --previous
```

## Jenkins Follow-Up

After Argo-managed staging has succeeded once:

1. Stop using `jenkins/dorfgefluester-staging-deploy.Jenkinsfile` for deployments.
2. Keep Jenkins CI for build/test/push only.
3. Update `helm/dorfgefluester/values-staging.yaml` in Git with immutable image tags from Jenkins.
4. Review the Argo diff and sync manually.

Do not delete the old deploy pipeline until the first successful Argo-managed staging rollout is verified.
