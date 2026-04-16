const path = require('path');

const {
  assertPathInsideCwd,
  buildContainerTrivyArgs,
  parseBoolean,
  renderTrivyMarkdown,
  summarizeTrivy,
} = require('../../scripts/quality/trivy-fs-scan.cjs');

const PINNED_TRIVY_IMAGE =
  'docker.io/aquasec/trivy@sha256:7228e304ae0f610a1fad937baa463598cadac0c2ac4027cc68f3a8b997115689';

describe('trivy-fs-scan helpers', () => {
  describe('parseBoolean', () => {
    test('returns default value for undefined and unknown input', () => {
      expect(parseBoolean(undefined, true)).toBe(true);
      expect(parseBoolean(undefined, false)).toBe(false);
      expect(parseBoolean('maybe', false)).toBe(false);
    });

    test('parses supported truthy and falsy strings', () => {
      expect(parseBoolean('true', false)).toBe(true);
      expect(parseBoolean('1', false)).toBe(true);
      expect(parseBoolean('yes', false)).toBe(true);
      expect(parseBoolean('false', true)).toBe(false);
      expect(parseBoolean('0', true)).toBe(false);
      expect(parseBoolean('no', true)).toBe(false);
    });
  });

  describe('assertPathInsideCwd', () => {
    test('resolves a relative path within the workspace', () => {
      expect(assertPathInsideCwd('reports/trivy/fs.json', '--out-json')).toBe(
        path.join(process.cwd(), 'reports', 'trivy', 'fs.json'),
      );
    });

    test('allows the workspace root when explicitly requested', () => {
      expect(assertPathInsideCwd('.', '--path', { allowCwd: true })).toBe(process.cwd());
    });

    test('rejects paths that escape the workspace', () => {
      expect(() => assertPathInsideCwd('../outside.json', '--out-json')).toThrow(
        '--out-json must stay within the workspace: ../outside.json',
      );
    });
  });

  describe('summarizeTrivy', () => {
    test('returns an empty summary for missing payloads', () => {
      const summary = summarizeTrivy(null);

      expect(summary.generatedAt).toEqual(expect.any(String));
      expect(summary.vulnerabilityCount).toBe(0);
      expect(summary.fixableCount).toBe(0);
      expect(summary.unfixableCount).toBe(0);
      expect(summary.bySeverity).toEqual({});
      expect(summary.topFindings).toEqual([]);
      expect(summary.topPackages).toEqual([]);
      expect(summary.topTargets).toEqual([]);
    });

    test('aggregates severities, packages, targets, and fixability', () => {
      const payload = {
        Results: [
          {
            Target: 'package-lock.json',
            Type: 'npm',
            Vulnerabilities: [
              {
                VulnerabilityID: 'CVE-0001',
                PkgName: 'alpha',
                InstalledVersion: '1.0.0',
                FixedVersion: '1.2.0',
                Severity: 'CRITICAL',
                Title: 'critical alpha issue',
              },
              {
                VulnerabilityID: 'CVE-0002',
                PkgName: 'alpha',
                InstalledVersion: '1.0.0',
                FixedVersion: '',
                Severity: 'HIGH',
                Title: 'high alpha issue',
              },
            ],
          },
          {
            Target: 'node_modules/beta/package.json',
            Type: 'npm',
            Vulnerabilities: [
              {
                VulnerabilityID: 'CVE-0003',
                PkgName: 'beta',
                InstalledVersion: '2.0.0',
                FixedVersion: '2.1.0',
                Severity: 'MEDIUM',
                Title: 'beta medium issue',
              },
            ],
          },
        ],
      };

      const summary = summarizeTrivy(payload);

      expect(summary.vulnerabilityCount).toBe(3);
      expect(summary.fixableCount).toBe(2);
      expect(summary.unfixableCount).toBe(1);
      expect(summary.bySeverity).toEqual({
        CRITICAL: 1,
        HIGH: 1,
        MEDIUM: 1,
      });

      expect(summary.topFindings[0]).toMatchObject({
        severity: 'CRITICAL',
        pkg: 'alpha',
        installed: '1.0.0',
        fixed: '1.2.0',
        id: 'CVE-0001',
        target: 'package-lock.json',
      });
      expect(summary.topFindings[1]).toMatchObject({
        severity: 'HIGH',
        pkg: 'alpha',
      });

      expect(summary.topPackages[0]).toMatchObject({
        packageName: 'alpha',
        ecosystem: 'npm',
        installedVersion: '1.0.0',
        fixedVersions: ['1.2.0'],
        vulnerabilities: ['CVE-0001', 'CVE-0002'],
        vulnerabilityCount: 2,
        critical: 1,
        high: 1,
      });
      expect(summary.topTargets[0]).toMatchObject({
        target: 'package-lock.json',
        type: 'npm',
        count: 2,
        critical: 1,
        high: 1,
      });
    });
  });

  describe('renderTrivyMarkdown', () => {
    test('renders the current markdown sections', () => {
      const markdown = renderTrivyMarkdown({
        maxList: 3,
        summary: {
          generatedAt: '2026-03-12T12:00:00.000Z',
          vulnerabilityCount: 2,
          fixableCount: 1,
          unfixableCount: 1,
          bySeverity: { CRITICAL: 1, HIGH: 1 },
          topFindings: [
            {
              severity: 'CRITICAL',
              pkg: 'alpha',
              installed: '1.0.0',
              fixed: '1.1.0',
              title: 'critical alpha issue',
              id: 'CVE-0001',
              target: 'package-lock.json',
            },
          ],
          topPackages: [
            {
              packageName: 'alpha',
              ecosystem: 'npm',
              installedVersion: '1.0.0',
              fixedVersions: ['1.1.0'],
              vulnerabilities: ['CVE-0001'],
              vulnerabilityCount: 1,
              critical: 1,
              high: 0,
            },
          ],
          topTargets: [
            {
              target: 'package-lock.json',
              type: 'npm',
              count: 1,
              critical: 1,
              high: 0,
            },
          ],
        },
      });

      expect(markdown).toContain('# Trivy Findings (FS Scan Snapshot)');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('## Fix First Packages');
      expect(markdown).toContain('## Hotspot Targets');
      expect(markdown).toContain('## Top Findings (for backlog)');
      expect(markdown).toContain('## Suggested Triage');
      expect(markdown).toContain('## Full Report');
      expect(markdown).toContain('alpha');
      expect(markdown).toContain('CVE-0001');
      expect(markdown).toContain('package-lock.json');
    });
  });

  describe('buildContainerTrivyArgs', () => {
    test('builds docker runtime args with uid/gid and skip dirs', () => {
      const args = buildContainerTrivyArgs({
        runtime: 'docker',
        absScanPath: '/workspace',
        cacheDirAbs: '/tmp/trivy-cache',
        containerScanPath: '/src',
        containerCacheDir: '/cache',
        containerOutPath: '/src/reports/trivy.json',
        severity: 'HIGH,CRITICAL',
        ignoreUnfixed: true,
        skipDirs: ['node_modules', 'coverage'],
      });

      expect(args).toEqual(
        expect.arrayContaining([
          'run',
          '--rm',
          '-u',
          `${
            typeof process.getuid === 'function' ? process.getuid() : 1000
          }:${
            typeof process.getgid === 'function' ? process.getgid() : 1000
          }`,
          '-v',
          '/workspace:/src',
          '-v',
          '/tmp/trivy-cache:/cache',
          PINNED_TRIVY_IMAGE,
          'fs',
          '/src',
          '--cache-dir',
          '/cache',
          '--format',
          'json',
          '--output',
          '/src/reports/trivy.json',
          '--severity',
          'HIGH,CRITICAL',
          '--no-progress',
          '--exit-code',
          '0',
          '--ignore-unfixed',
          '--skip-dirs',
          '/src/node_modules,/src/coverage',
        ])
      );
    });

    test('builds podman runtime args with keep-id userns', () => {
      const args = buildContainerTrivyArgs({
        runtime: 'podman',
        absScanPath: '/workspace',
        cacheDirAbs: '/tmp/trivy-cache',
        containerScanPath: '/src',
        containerCacheDir: '/cache',
        containerOutPath: '/src/reports/trivy.json',
        severity: 'MEDIUM,HIGH,CRITICAL',
        ignoreUnfixed: false,
        skipDirs: [],
      });

      expect(args).toEqual(
        expect.arrayContaining([
          'run',
          '--rm',
          '--userns=keep-id',
          '-v',
          '/workspace:/src',
          '-v',
          '/tmp/trivy-cache:/cache',
          PINNED_TRIVY_IMAGE,
          'fs',
          '/src',
        ])
      );
      expect(args).not.toContain('-u');
      expect(args).not.toContain('--ignore-unfixed');
      expect(args).not.toContain('--skip-dirs');
    });
  });
});
