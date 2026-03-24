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
    console.log(JSON.stringify({
      testDir: config.testDir,
      baseURL: config.use?.baseURL,
      webServerCommand: config.webServer?.command,
      webServerUrl: config.webServer?.url
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
    expect(playwrightContract.webServerCommand).toContain('npm run dev');
    expect(playwrightContract.webServerCommand).toContain('--strictPort');
    expect(playwrightContract.webServerUrl).toBe('http://localhost:3000');
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
