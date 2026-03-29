import fs from 'fs';
import path from 'path';

import { describe, expect, test } from '@jest/globals';

const rootDir = path.resolve(process.cwd());

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('staging deploy contracts', () => {
  test('registry tag verification keeps per-image tag lookups intact over ssh', () => {
    const jenkinsfile = readRepoFile('jenkins/dorfgefluester-staging-deploy.Jenkinsfile');

    expect(jenkinsfile).toContain("stage('Verify IMAGE_TAG Exists In Registry')");
    expect(jenkinsfile).toContain('for image in ${WEB_IMAGE_NAME} ${API_IMAGE_NAME}; do');
    expect(jenkinsfile).toContain("url='http://${REGISTRY_HOST}/v2/'\\\\\\\"\\$image\\\\\\\"'/tags/list'");
    expect(jenkinsfile).toContain('echo "Available tags (registry response):"');
    expect(jenkinsfile).toContain("curl -fsS 'http://${REGISTRY_HOST}/v2/'");
  });

  test('staging deploy cleanup uses values overlays, external secrets, and workspace cleanup', () => {
    const jenkinsfile = readRepoFile('jenkins/dorfgefluester-staging-deploy.Jenkinsfile');

    expect(jenkinsfile).toContain('archiveArtifacts artifacts: \'reports/**/*\'');
    expect(jenkinsfile).toContain('values-staging.yaml');
    expect(jenkinsfile).toContain('required secret dorfgefluester-postgres is missing');
    expect(jenkinsfile).toContain('rm -rf /tmp/dorfgefluester-chart');
    expect(jenkinsfile).toContain('docker image prune -f --filter "dangling=true" || true');
    expect(jenkinsfile).toContain('cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)');
  });

  test('production deploy uses the same per-image registry verification and values overlay pattern', () => {
    const jenkinsfile = readRepoFile('jenkins/dorfgefluester-production-deploy.Jenkinsfile');

    expect(jenkinsfile).toContain("stage('Verify IMAGE_TAG Exists In Registry')");
    expect(jenkinsfile).toContain('for image in ${WEB_IMAGE_NAME} ${API_IMAGE_NAME}; do');
    expect(jenkinsfile).toContain("url='http://${REGISTRY_HOST}/v2/'\\\\\\\"\\$image\\\\\\\"'/tags/list'");
    expect(jenkinsfile).toContain('values-production.yaml');
    expect(jenkinsfile).toContain('required secret dorfgefluester-postgres is missing');
    expect(jenkinsfile).toContain('rm -rf /tmp/dorfgefluester-chart');
    expect(jenkinsfile).toContain('cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)');
  });

  test('core vitals staging deploy also cleans remote chart state and the Jenkins workspace', () => {
    const jenkinsfile = readRepoFile('jenkins/core-vitals-staging-deploy.Jenkinsfile');

    expect(jenkinsfile).toContain('rm -rf /tmp/core-vitals-chart');
    expect(jenkinsfile).toContain('docker image prune -f --filter "dangling=true" || true');
    expect(jenkinsfile).toContain('cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)');
  });
});
