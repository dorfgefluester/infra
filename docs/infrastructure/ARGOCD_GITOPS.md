# Argo CD GitOps Rollout

This is the target staging workflow for `dorfgefluester` on `dev-env-01`.

## Current Repo Assumptions

- Helm chart path: `helm/dorfgefluester`
- Staging values file: `helm/dorfgefluester/values-staging.yaml`
- Staging namespace: `staging`
- Staging ingress URL: `http://dev-env-01/dorfgefluester/`
- Runtime database secret expected by the chart: `dorfgefluester-postgres`
- Argo CD runs on the same k3s cluster, so no external cluster registration is required for staging

## Desired GitOps Flow

1. Jenkins builds and pushes immutable image tags.
2. Jenkins updates `helm/dorfgefluester/values-staging.yaml` with the new image tag(s).
3. Argo CD detects the Git change and shows `OutOfSync`.
4. Review the Argo CD diff.
5. Run a manual sync.
6. Verify the rollout on `dev-env-01`.

Argo CD does not deploy "latest image in the registry" by itself. A Git change must drive the deployment.

## Required Repo Manifests

- Argo CD application: `argocd/applications/dorfgefluester-staging.yaml`
- Sealed Secret example: `argocd/sealed-secrets/dorfgefluester-postgres.sealedsecret.yaml.example`

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

Apply the staging application manifest from this repo:

```bash
kubectl apply -f argocd/applications/dorfgefluester-staging.yaml
argocd app get dorfgefluester-staging
argocd app diff dorfgefluester-staging
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
  namespace: staging
type: Opaque
stringData:
  postgres-db: dorfgefluester
  postgres-user: dorfgefluester
  postgres-password: REPLACE_ME
  database-url: postgres://dorfgefluester:REPLACE_ME@dev-env-01:5432/dorfgefluester
EOF
```

Seal it against the cluster certificate and write the committed manifest:

```bash
kubeseal --format yaml --cert /tmp/sealed-secrets-cert.pem < /tmp/dorfgefluester-postgres.secret.yaml > argocd/sealed-secrets/dorfgefluester-postgres.sealedsecret.yaml
rm -f /tmp/dorfgefluester-postgres.secret.yaml
```

Commit the Argo CD app and Sealed Secret:

```bash
git add argocd/applications/dorfgefluester-staging.yaml argocd/sealed-secrets/dorfgefluester-postgres.sealedsecret.yaml
git commit -m "Add Argo CD staging app and sealed secret"
git push
```

### Host: `argocd-01`

Apply the sealed secret from the updated repo checkout:

```bash
kubectl apply -f argocd/sealed-secrets/dorfgefluester-postgres.sealedsecret.yaml
kubectl -n staging get sealedsecret,secrets | grep dorfgefluester-postgres
```

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
sudo k3s kubectl -n staging get all
sudo k3s kubectl -n staging get ingress
curl -I http://dev-env-01/dorfgefluester/
curl -fsS http://dev-env-01/dorfgefluester/healthz
curl -fsS http://dev-env-01/dorfgefluester/api/health
```

If a rollout is unhealthy:

```bash
sudo k3s kubectl -n staging describe deploy dorfgefluester
sudo k3s kubectl -n staging get pods
sudo k3s kubectl -n staging logs deploy/dorfgefluester -c api --previous
sudo k3s kubectl -n staging logs deploy/dorfgefluester -c web --previous
```

## Jenkins Follow-Up

After Argo-managed staging has succeeded once:

1. Stop using `jenkins/dorfgefluester-staging-deploy.Jenkinsfile` for deployments.
2. Keep Jenkins CI for build/test/push only.
3. Update `helm/dorfgefluester/values-staging.yaml` in Git with immutable image tags from Jenkins.
4. Review the Argo diff and sync manually.

Do not delete the old deploy pipeline until the first successful Argo-managed staging rollout is verified.
