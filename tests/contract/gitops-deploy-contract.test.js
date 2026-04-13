import fs from 'fs';
import path from 'path';

import { describe, expect, test } from '@jest/globals';

const rootDir = path.resolve(process.cwd());

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('gitops deploy contract', () => {
  test('helm chart exposes shared defaults plus staging and production overlays', () => {
    expect(readRepoFile('infra/helm/dorfgefluester/Chart.yaml')).toContain('name: dorfgefluester');
    expect(readRepoFile('infra/helm/dorfgefluester/values.yaml')).toContain('fullnameOverride: dorfgefluester');
    expect(readRepoFile('infra/helm/dorfgefluester/values-staging.yaml')).toContain('namespace: dorfgefluester');
    expect(readRepoFile('infra/helm/dorfgefluester/values-staging.yaml')).toContain('deploymentMode: monolith');
    expect(readRepoFile('infra/helm/dorfgefluester/values-staging.yaml')).toContain('enabled: true');
    expect(readRepoFile('infra/helm/dorfgefluester/values-staging.yaml')).toContain('tag: master-latest');
    expect(readRepoFile('infra/helm/dorfgefluester/values-staging.yaml')).toContain('pullPolicy: Always');
    expect(readRepoFile('infra/helm/dorfgefluester/values-production.yaml')).toContain('namespace: production');
  });

  test('argocd staging application tracks master for manual post-jenkins deployments', () => {
    const appManifest = readRepoFile('infra/argocd/dorfgefluester-staging.application.yaml');

    expect(appManifest).toContain('name: dorfgefluester-staging');
    expect(appManifest).toContain('targetRevision: master');
    expect(appManifest).toContain('namespace: dorfgefluester');
  });

  test('helm templates support staging monolith mode and keep secrets outside git-managed manifests', () => {
    const monolithDeployment = readRepoFile('infra/helm/dorfgefluester/templates/deployment.yaml');
    const monolithService = readRepoFile('infra/helm/dorfgefluester/templates/service.yaml');
    const monolithNginxConfig = readRepoFile('infra/helm/dorfgefluester/templates/monolith-nginx-config.yaml');
    const apiDeployment = readRepoFile('infra/helm/dorfgefluester/templates/api-deployment.yaml');
    const webDeployment = readRepoFile('infra/helm/dorfgefluester/templates/web-deployment.yaml');
    const ingress = readRepoFile('infra/helm/dorfgefluester/templates/ingress.yaml');

    expect(monolithDeployment).toContain('{{- if eq .Values.deploymentMode "monolith" }}');
    expect(monolithService).toContain('{{- if eq .Values.deploymentMode "monolith" }}');
    expect(monolithDeployment).toContain('{{- include "dorfgefluester.monolithSelectorLabels" . | nindent 6 }}');
    expect(monolithService).toContain('{{- include "dorfgefluester.monolithSelectorLabels" . | nindent 4 }}');
    expect(monolithNginxConfig).toContain('proxy_pass http://127.0.0.1:3001/api/;');
    expect(monolithNginxConfig).toContain('location /dorfgefluester/api/');
    expect(monolithNginxConfig).toContain('rewrite ^/dorfgefluester/api/(.*)$ /api/$1 break;');
    expect(apiDeployment).toContain('name: {{ include "dorfgefluester.apiName" . }}');
    expect(apiDeployment).toContain('{{- include "dorfgefluester.apiSelectorLabels" . | nindent 6 }}');
    expect(apiDeployment).toContain('{{- if ne .Values.deploymentMode "monolith" }}');
    expect(apiDeployment).toContain('name: {{ .Values.api.runtimeSecret.name | quote }}');
    expect(webDeployment).toContain('name: {{ include "dorfgefluester.webName" . }}');
    expect(webDeployment).toContain('{{- include "dorfgefluester.webSelectorLabels" . | nindent 6 }}');
    expect(webDeployment).toContain('{{- if ne .Values.deploymentMode "monolith" }}');
    expect(ingress).toContain('name: {{ include "dorfgefluester.fullname" . }}');
    expect(fs.existsSync(path.join(rootDir, 'infra/infra/helm/dorfgefluester/templates/postgres-secret.yaml'))).toBe(false);
  });

  test('jenkins deploy jobs consume environment values files instead of inlining the whole deploy contract', () => {
    const stagingDeploy = readRepoFile('infra/jenkins/dorfgefluester-staging-deploy.Jenkinsfile');
    const productionDeploy = readRepoFile('infra/jenkins/dorfgefluester-production-deploy.Jenkinsfile');

    expect(stagingDeploy).toContain('values-staging.yaml');
    expect(stagingDeploy).toContain('required secret dorfgefluester-postgres is missing');
    expect(stagingDeploy).toContain('-f /tmp/dorfgefluester-chart/values.yaml -f /tmp/dorfgefluester-chart/values-staging.yaml');
    expect(productionDeploy).toContain('values-production.yaml');
    expect(productionDeploy).toContain('required secret dorfgefluester-postgres is missing');
    expect(productionDeploy).toContain('-f /tmp/dorfgefluester-chart/values.yaml -f /tmp/dorfgefluester-chart/values-production.yaml');
  });
});
