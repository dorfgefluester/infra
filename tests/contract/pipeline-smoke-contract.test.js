import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { describe, expect, test } from '@jest/globals';

import { createViteConfig } from '../../scripts/config/vite-config.shared.js';

const rootDir = path.resolve(process.cwd());

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function parseHtml(relativePath) {
  const parser = new DOMParser();
  return parser.parseFromString(readRepoFile(relativePath), 'text/html');
}

function readPlaywrightContract() {
  const script = `
    import config from './playwright.config.js';
    const webServers = Array.isArray(config.webServer) ? config.webServer : (config.webServer ? [config.webServer] : []);
    console.log(JSON.stringify({
      testDir: config.testDir,
      baseURL: config.use?.baseURL,
      webServerCommands: webServers.map((server) => server.command),
      webServerUrls: webServers.map((server) => server.url)
    }));
  `;

  return JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', script], {
      cwd: rootDir,
      encoding: 'utf8',
    }),
  );
}

describe('pipeline smoke contracts', () => {
  test('vite and playwright stay aligned on the local smoke-test server', () => {
    const viteConfig = createViteConfig();
    const playwrightContract = readPlaywrightContract();

    expect(viteConfig.server.port).toBe(3000);
    expect(playwrightContract.baseURL).toBe('http://localhost:3000');
    expect(playwrightContract.webServerCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining('node api/src/cli.js'),
        expect.stringContaining('vite'),
      ]),
    );
    expect(playwrightContract.webServerCommands.join(' ')).toContain('--strictPort');
    expect(playwrightContract.webServerUrls).toEqual(
      expect.arrayContaining([
        'http://127.0.0.1:3001/api/health',
        'http://localhost:3000',
      ]),
    );
    expect(playwrightContract.testDir).toBe('./tests/e2e');
  });

  test('package scripts expose the commands expected by CI smoke checks', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));

    expect(packageJson.scripts.dev).toBe('vite');
    expect(packageJson.scripts.build).toBe('vite build');
    expect(packageJson.scripts.test).toBe('jest');
    expect(packageJson.scripts['test:e2e']).toBe('playwright test');
    expect(packageJson.scripts.lint).toBe('node scripts/quality/lint.cjs');
  });

  test('jenkins bundle budget check runs in the same containerized build context', () => {
    const jenkinsfile = readRepoFile('Jenkinsfile');

    expect(jenkinsfile).toContain("cat > .jenkins-bundle-budget-check.cjs <<'EOF'");
    expect(jenkinsfile).toContain("sh -lc 'npm run build && node ./.jenkins-bundle-budget-check.cjs'");
    expect(jenkinsfile).toContain("trap 'rm -f .jenkins-bundle-budget-check.cjs' EXIT");
  });

  test('jenkins database migration smoke test allows slow postgres startup and runs the repo smoke script', () => {
    const jenkinsfile = readRepoFile('Jenkinsfile');

    expect(jenkinsfile).toContain("stage('Database Migration Smoke Test')");
    expect(jenkinsfile).toContain('for _ in $(seq 1 90); do');
    expect(jenkinsfile).toContain("sh -lc 'node scripts/quality/api-migration-smoke.cjs'");
  });

  test('nginx runtime exposes health endpoints for root and prefixed deployments', () => {
    const nginxConfig = readRepoFile('nginx/default.conf');

    expect(nginxConfig).toContain('location /api/');
    expect(nginxConfig).toContain('location = /health');
    expect(nginxConfig).toContain('location = /healthz');
    expect(nginxConfig).toContain('location = /dorfgefluester/health');
    expect(nginxConfig).toContain('location = /dorfgefluester/healthz');
    expect(nginxConfig).toContain('{"status":"healthy"}');
    expect(nginxConfig).toContain('{"status":"unhealthy"}');
  });

  test('html shell keeps the critical containers and controls used by smoke tests', () => {
    const doc = parseHtml('index.html');
    const requiredIds = [
      'app-container',
      'game-container',
      'btn-settings',
      'btn-help',
      'btn-quests',
      'btn-inventory',
      'settings-modal',
      'help-modal',
      'phone-modal',
      'start-location-modal',
      'use-last-location',
    ];

    for (const id of requiredIds) {
      const element = doc.getElementById(id);
      expect(element).not.toBeNull();
    }
  });

  test('content security policy keeps the protections and local dev allowances the app depends on', () => {
    const doc = parseHtml('index.html');
    const csp = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');

    expect(csp).toEqual(expect.any(String));
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('http://localhost:*');
    expect(csp).toContain('ws://localhost:*');
  });
});
