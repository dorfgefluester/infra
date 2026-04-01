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
    expect(readRepoFile('helm/dorfgefluester/values-staging.yaml')).toContain('namespace: dorfgefluester');
    expect(readRepoFile('helm/dorfgefluester/values-staging.yaml')).toContain('deploymentMode: monolith');
    expect(readRepoFile('helm/dorfgefluester/values-staging.yaml')).toContain('enabled: true');
    expect(readRepoFile('helm/dorfgefluester/values-staging.yaml')).toContain('tag: master-latest');
    expect(readRepoFile('helm/dorfgefluester/values-staging.yaml')).toContain('pullPolicy: Always');
    expect(readRepoFile('helm/dorfgefluester/values-production.yaml')).toContain('namespace: production');
  });

  test('helm templates support staging monolith mode and keep secrets outside git-managed manifests', () => {
    const monolithDeployment = readRepoFile('helm/dorfgefluester/templates/deployment.yaml');
    const monolithService = readRepoFile('helm/dorfgefluester/templates/service.yaml');
    const monolithNginxConfig = readRepoFile('helm/dorfgefluester/templates/monolith-nginx-config.yaml');
    const apiDeployment = readRepoFile('helm/dorfgefluester/templates/api-deployment.yaml');
    const webDeployment = readRepoFile('helm/dorfgefluester/templates/web-deployment.yaml');
    const ingress = readRepoFile('helm/dorfgefluester/templates/ingress.yaml');

    expect(monolithDeployment).toContain('{{- if eq .Values.deploymentMode "monolith" }}');
    expect(monolithService).toContain('{{- if eq .Values.deploymentMode "monolith" }}');
    expect(monolithNginxConfig).toContain('proxy_pass http://127.0.0.1:3001/api/;');
    expect(apiDeployment).toContain('name: {{ include "dorfgefluester.apiName" . }}');
    expect(apiDeployment).toContain('{{- if ne .Values.deploymentMode "monolith" }}');
    expect(apiDeployment).toContain('name: {{ .Values.api.runtimeSecret.name | quote }}');
    expect(webDeployment).toContain('name: {{ include "dorfgefluester.webName" . }}');
    expect(webDeployment).toContain('{{- if ne .Values.deploymentMode "monolith" }}');
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
