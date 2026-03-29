import fs from 'fs';
import path from 'path';

import { describe, expect, test } from '@jest/globals';

const rootDir = path.resolve(process.cwd());

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('gitops deploy contract', () => {
  test('helm chart exposes shared defaults plus staging and production overlays', () => {
    expect(readRepoFile('helm/dorfgefluester/Chart.yaml')).toContain('name: dorfgefluester');
    expect(readRepoFile('helm/dorfgefluester/values.yaml')).toContain('fullnameOverride: dorfgefluester');
    expect(readRepoFile('helm/dorfgefluester/values-staging.yaml')).toContain('namespace: staging');
    expect(readRepoFile('helm/dorfgefluester/values-production.yaml')).toContain('namespace: production');
  });

  test('helm templates are values-driven and keep secrets outside git-managed manifests', () => {
    const apiDeployment = readRepoFile('helm/dorfgefluester/templates/api-deployment.yaml');
    const webDeployment = readRepoFile('helm/dorfgefluester/templates/web-deployment.yaml');
    const ingress = readRepoFile('helm/dorfgefluester/templates/ingress.yaml');

    expect(apiDeployment).toContain('name: {{ include "dorfgefluester.apiName" . }}');
    expect(apiDeployment).toContain('name: {{ .Values.api.runtimeSecret.name | quote }}');
    expect(webDeployment).toContain('name: {{ include "dorfgefluester.webName" . }}');
    expect(ingress).toContain('name: {{ include "dorfgefluester.fullname" . }}');
    expect(fs.existsSync(path.join(rootDir, 'helm/dorfgefluester/templates/postgres-secret.yaml'))).toBe(false);
  });

  test('jenkins deploy jobs consume environment values files instead of inlining the whole deploy contract', () => {
    const stagingDeploy = readRepoFile('jenkins/dorfgefluester-staging-deploy.Jenkinsfile');
    const productionDeploy = readRepoFile('jenkins/dorfgefluester-production-deploy.Jenkinsfile');

    expect(stagingDeploy).toContain('values-staging.yaml');
    expect(stagingDeploy).toContain('required secret dorfgefluester-postgres is missing');
    expect(stagingDeploy).toContain('-f /tmp/dorfgefluester-chart/values.yaml -f /tmp/dorfgefluester-chart/values-staging.yaml');
    expect(productionDeploy).toContain('values-production.yaml');
    expect(productionDeploy).toContain('required secret dorfgefluester-postgres is missing');
    expect(productionDeploy).toContain('-f /tmp/dorfgefluester-chart/values.yaml -f /tmp/dorfgefluester-chart/values-production.yaml');
  });
});
