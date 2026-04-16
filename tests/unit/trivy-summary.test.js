const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  formatSeverityCounts,
  normalizeSeverity,
  renderSummary,
  summarizeTrivyReport,
} = require('../../scripts/quality/trivy-summary.cjs');

describe('trivy-summary', () => {
  test('normalizes severities consistently', () => {
    expect(normalizeSeverity('critical')).toBe('CRITICAL');
    expect(normalizeSeverity('HIGH')).toBe('HIGH');
    expect(normalizeSeverity('weird')).toBe('UNKNOWN');
  });

  test('summarizes a Trivy report into counts, packages, and findings', () => {
    const summary = summarizeTrivyReport({
      Results: [
        {
          Target: 'image-layer-1',
          Vulnerabilities: [
            {
              Severity: 'CRITICAL',
              PkgName: 'openssl',
              InstalledVersion: '1.0.0',
              FixedVersion: '1.0.1',
              VulnerabilityID: 'CVE-1',
              Title: 'critical openssl issue',
            },
            {
              Severity: 'HIGH',
              PkgName: 'openssl',
              InstalledVersion: '1.0.0',
              FixedVersion: '',
              VulnerabilityID: 'CVE-2',
              Title: 'high openssl issue',
            },
          ],
        },
      ],
    });

    expect(summary.totalFindings).toBe(2);
    expect(summary.severityCounts.CRITICAL).toBe(1);
    expect(summary.severityCounts.HIGH).toBe(1);
    expect(summary.topPackages[0]).toEqual({ pkgName: 'openssl', count: 2 });
    expect(summary.findings[0]).toMatchObject({
      severity: 'CRITICAL',
      pkgName: 'openssl',
      vulnId: 'CVE-1',
    });
  });

  test('renders readable summary text', () => {
    const text = renderSummary({
      label: 'Trivy Image Scan',
      maxFindings: 5,
      maxPackages: 3,
      summary: {
        totalFindings: 2,
        targetCount: 1,
        severityCounts: { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
        topPackages: [{ pkgName: 'openssl', count: 2 }],
        findings: [
          {
            severity: 'CRITICAL',
            vulnId: 'CVE-1',
            pkgName: 'openssl',
            installedVersion: '1.0.0',
            fixedVersion: '1.0.1',
            target: 'image-layer-1',
            title: 'critical openssl issue',
          },
        ],
      },
    });

    expect(formatSeverityCounts({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0, UNKNOWN: 0 })).toBe(
      'CRITICAL=1, HIGH=1',
    );
    expect(text).toContain('=== Trivy Image Scan Summary ===');
    expect(text).toContain('Top packages: openssl (2)');
    expect(text).toContain('[CRITICAL] | CVE-1 | openssl@1.0.0');
  });

  test('handles empty reports and unknown severities', () => {
    const summary = summarizeTrivyReport({
      Results: [
        { Target: 'empty-target', Vulnerabilities: [] },
        {
          ArtifactName: 'artifact-only',
          Vulnerabilities: [
            {
              Severity: 'odd',
              InstalledVersion: '0.0.1',
              VulnerabilityID: 'CVE-X',
              PrimaryURL: 'https://example.invalid/CVE-X',
            },
          ],
        },
      ],
    });

    expect(summary.targetCount).toBe(2);
    expect(summary.severityCounts.UNKNOWN).toBe(1);
    expect(summary.topPackages[0]).toEqual({ pkgName: '(unknown package)', count: 1 });
    expect(summary.findings[0]).toMatchObject({
      severity: 'UNKNOWN',
      pkgName: '(unknown package)',
      fixedVersion: 'n/a',
      target: 'artifact-only',
      title: 'https://example.invalid/CVE-X',
    });

    const rendered = renderSummary({
      label: 'Empty-ish',
      maxFindings: 2,
      maxPackages: 2,
      summary,
    });

    expect(rendered).toContain('By severity: UNKNOWN=1');
    expect(rendered).toContain('Top packages: (unknown package) (1)');
  });

  test('cli writes summary artifacts', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-summary-'));
    const inputPath = path.join(tempDir, 'trivy.json');
    const outJson = path.join(tempDir, 'summary.json');
    const outMd = path.join(tempDir, 'summary.md');

    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        Results: [
          {
            Target: 'layer-a',
            Vulnerabilities: [
              {
                Severity: 'HIGH',
                PkgName: 'zlib',
                InstalledVersion: '1.2.3',
                FixedVersion: '1.2.4',
                VulnerabilityID: 'CVE-Z',
              },
            ],
          },
        ],
      }),
    );

    const stdout = execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/quality/trivy-summary.cjs'), '--input', inputPath, '--label', 'CLI Scan', '--out-json', outJson, '--out-md', outMd], {
      encoding: 'utf8',
    });

    expect(stdout).toContain('=== CLI Scan Summary ===');
    expect(fs.existsSync(outJson)).toBe(true);
    expect(fs.existsSync(outMd)).toBe(true);
    expect(JSON.parse(fs.readFileSync(outJson, 'utf8'))).toMatchObject({
      totalFindings: 1,
      severityCounts: expect.objectContaining({ HIGH: 1 }),
    });
    expect(fs.readFileSync(outMd, 'utf8')).toContain('Top findings:');
  });
});
