const {
  buildPlanningSummary,
  renderPlanningMarkdown,
  toPathArea,
} = require('../../scripts/quality/sonar-plan-export.cjs');

describe('sonar-plan-export', () => {
  test('groups findings into planning tasks and top files', () => {
    const summary = buildPlanningSummary({
      issuesPayload: {
        hostUrl: 'http://sonarqube:9000',
        projectKey: 'dorfgefluester',
        measures: {
          bugs: '2',
          vulnerabilities: '1',
          code_smells: '6',
        },
        summary: { total: 9 },
        issues: [
          {
            component: 'dorfgefluester:src/ui/MenuUI.js',
            rule: 'javascript:S1481',
            type: 'CODE_SMELL',
            severity: 'MAJOR',
          },
          {
            component: 'dorfgefluester:src/ui/MenuUI.js',
            rule: 'javascript:S1481',
            type: 'CODE_SMELL',
            severity: 'MAJOR',
          },
          {
            component: 'dorfgefluester:src/systems/SaveSystem.js',
            rule: 'javascript:S112',
            type: 'BUG',
            severity: 'CRITICAL',
          },
        ],
      },
      report: {
        hostUrl: 'http://sonarqube:9000',
        projectKey: 'dorfgefluester',
        qualityGate: { status: 'WARN' },
        totals: {
          reliability_high: 1,
          reliability_medium: 0,
          security_high: 1,
          maintainability_high: 2,
          hotspots: 1,
        },
        reliability_high: [
          { file: 'src/systems/SaveSystem.js', rule: 'javascript:S2259', message: 'null deref' },
        ],
        security_high: [
          { file: 'scripts/quality/trivy-fs-scan.cjs', rule: 'javascript:S2083', message: 'path traversal' },
        ],
        maintainability_high: [
          { file: 'src/ui/MenuUI.js', rule: 'javascript:S1481', message: 'unused var' },
          { file: 'src/ui/MenuUI.js', rule: 'javascript:S1067', message: 'complex expression' },
        ],
        hotspots: {
          total: 1,
          hotspots: [
            { file: 'src/network/Auth.js', message: 'review token handling', vulnerabilityProbability: 'HIGH' },
          ],
        },
      },
    });

    expect(summary.qualityGateStatus).toBe('WARN');
    expect(summary.totals.securityHigh).toBe(1);
    expect(summary.totals.securityHotspots).toBe(1);
    expect(summary.topFiles.map((file) => file.file)).toEqual(
      expect.arrayContaining([
        'src/ui/MenuUI.js',
        'src/systems/SaveSystem.js',
        'scripts/quality/trivy-fs-scan.cjs',
      ]),
    );
    expect(summary.planningTasks.map((task) => task.id)).toEqual(
      expect.arrayContaining([
        'security-high',
        'reliability-high',
        'security-hotspots',
        'maintainability-high',
        'open-issues-triage',
      ]),
    );
  });

  test('renders a readable markdown summary', () => {
    const markdown = renderPlanningMarkdown({
      generatedAt: '2026-03-19T00:00:00.000Z',
      projectKey: 'dorfgefluester',
      hostUrl: 'http://sonarqube:9000',
      qualityGateStatus: 'OK',
      totals: {
        openIssues: 5,
        bugs: 1,
        vulnerabilities: 0,
        codeSmells: 4,
        securityHotspots: 2,
        reliabilityHigh: 1,
        reliabilityMedium: 0,
        securityHigh: 0,
        maintainabilityHigh: 2,
      },
      planningTasks: [
        {
          id: 'maintainability-high',
          title: 'Reduce high-impact maintainability debt',
          priority: 'medium',
          rationale: 'Two findings are clustered in one file.',
          nextAction: 'Group them into one refactor.',
          count: 2,
          files: ['src/ui/MenuUI.js'],
          rules: ['javascript:S1481'],
        },
      ],
      topAreas: [{ name: 'src/ui', count: 4 }],
      topFiles: [
        {
          file: 'src/ui/MenuUI.js',
          openIssues: 4,
          reliabilityHigh: 0,
          securityHigh: 0,
          maintainabilityHigh: 2,
          hotspots: 0,
        },
      ],
      topRules: [{ rule: 'javascript:S1481', count: 3, sampleFiles: ['src/ui/MenuUI.js'] }],
      suggestedPlanningWorkflow: ['Review and curate before editing IMPLEMENTATION_PLAN.md.'],
    });

    expect(markdown).toContain('# SonarQube Planning Summary');
    expect(markdown).toContain('## Plan Next');
    expect(markdown).toContain('Reduce high-impact maintainability debt');
    expect(markdown).toContain('src/ui/MenuUI.js');
    expect(markdown).toContain('javascript:S1481');
  });

  test('derives a stable path area', () => {
    expect(toPathArea('src/ui/MenuUI.js')).toBe('src/ui');
    expect(toPathArea('Jenkinsfile')).toBe('Jenkinsfile');
  });
});
