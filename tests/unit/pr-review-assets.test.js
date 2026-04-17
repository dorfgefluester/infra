const {
  buildPrompt,
  createReviewSchema,
  main,
  readSkillContents,
  renderChecklistReference,
} = require('../../scripts/quality/build-pr-review-assets.cjs');
const { renderComment } = require('../../scripts/quality/render-pr-review-comment.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('pr review assets', () => {
  test('review schema requires the checklist object and summary fields', () => {
    const schema = createReviewSchema();

    expect(schema.required).toEqual(
      expect.arrayContaining([
        'checklist',
        'review_outcome',
        'quality_score',
        'top_issues',
      ])
    );
    expect(schema.properties.review_outcome.enum).toEqual([
      'approve',
      'request_changes',
      'comment_only',
    ]);
    expect(Object.keys(schema.properties.checklist.properties)).toContain('security_dependencies');
  });

  test('checklist reference includes the requested review sections', () => {
    const reference = renderChecklistReference();

    expect(reference).toContain('## Scope');
    expect(reference).toContain('`testing_existing`: Existing tests pass');
    expect(reference).toContain('`ui_wcag`: No WCAG regressions introduced');
  });

  test('readSkillContents loads the configured skill markdown files', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const skills = readSkillContents(repoRoot);

    expect(skills.length).toBeGreaterThanOrEqual(5);
    expect(skills[0]).toEqual(
      expect.objectContaining({
        path: expect.stringMatching(/^config\/skills\//),
        content: expect.any(String),
      }),
    );
  });

  test('buildPrompt includes repository metadata, skills, and diff sections', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const headSha = require('child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
      .trim();

    const prompt = buildPrompt({
      repoRoot,
      promptTemplate: path.join(repoRoot, '.github/codex/review-prompt.md'),
      baseSha: headSha,
      headSha,
      repository: 'StephanOnTour/dorfgefluester',
      prNumber: '99',
      baseRef: 'master',
      headRef: 'feature/test',
    });

    expect(prompt).toContain('Repository:');
    expect(prompt).toContain('Pull Request #: 99');
    expect(prompt).toContain('# Required Review Checklist');
    expect(prompt).toContain('# Review Skills');
    expect(prompt).toContain('Unified diff (context=5):');
  });

  test('renderComment prints marked checklist items and outcome summary', () => {
    const checklist = {
      scope_description: { status: 'completed', rationale: 'Description explains the behavior change.' },
      scope_focus: { status: 'completed', rationale: 'Only one concern changed.' },
      scope_risks: { status: 'needs_attention', rationale: 'Risk notes are missing from the PR body.' },
      correctness_logic: { status: 'completed', rationale: 'The code path matches the expected behavior.' },
      correctness_edge_cases: { status: 'completed', rationale: 'Null and empty inputs are covered.' },
      correctness_types: { status: 'completed', rationale: 'Return shapes remain unchanged.' },
      correctness_async: { status: 'not_applicable', rationale: 'The change is synchronous.' },
      architecture_separation: { status: 'completed', rationale: 'Boundaries stayed intact.' },
      architecture_circular: { status: 'completed', rationale: 'No new imports were introduced.' },
      architecture_public_api: { status: 'completed', rationale: 'Public surface stayed stable.' },
      architecture_state: { status: 'completed', rationale: 'Side effects remain localized.' },
      quality_naming: { status: 'completed', rationale: 'Names match existing conventions.' },
      quality_function_size: { status: 'completed', rationale: 'No oversized functions added.' },
      quality_duplication: { status: 'completed', rationale: 'No duplicate logic introduced.' },
      quality_complexity: { status: 'completed', rationale: 'Control flow stayed simple.' },
      errors_boundaries: { status: 'completed', rationale: 'Errors are still handled at module boundaries.' },
      errors_empty_catch: { status: 'completed', rationale: 'No silent catch blocks added.' },
      errors_actionable: { status: 'completed', rationale: 'Messages remain actionable.' },
      errors_context: { status: 'completed', rationale: 'Original error details are preserved.' },
      security_vulns: { status: 'completed', rationale: 'No injection or auth changes in the diff.' },
      security_secrets: { status: 'completed', rationale: 'No secrets appear in the changed files.' },
      security_validation: { status: 'not_applicable', rationale: 'No new external input path was added.' },
      security_dependencies: { status: 'completed', rationale: 'Dependency changes were already validated.' },
      performance_regressions: { status: 'completed', rationale: 'No slower path was introduced.' },
      performance_renders: { status: 'not_applicable', rationale: 'The PR does not touch rendering.' },
      performance_expensive_work: { status: 'completed', rationale: 'No extra expensive work added.' },
      docs_updates: { status: 'needs_attention', rationale: 'Behavior changed but docs were not updated.' },
      docs_why: { status: 'completed', rationale: 'Code comments explain the intent.' },
      docs_config: { status: 'not_applicable', rationale: 'No config or env change exists.' },
      testing_new_behavior: { status: 'completed', rationale: 'The new path has coverage.' },
      testing_edge_cases: { status: 'completed', rationale: 'Edge cases are in the added tests.' },
      testing_existing: { status: 'completed', rationale: 'Targeted suites passed.' },
      testing_regression: { status: 'completed', rationale: 'A regression test was added.' },
      ui_consistency: { status: 'not_applicable', rationale: 'No UI surface changed.' },
      ui_states: { status: 'not_applicable', rationale: 'No load/error state changed.' },
      ui_accessibility: { status: 'not_applicable', rationale: 'Accessibility is unaffected.' },
      ui_wcag: { status: 'not_applicable', rationale: 'No visual regression risk in this change.' },
      annotations_reviewed: { status: 'completed', rationale: 'Touched files contain no stale TODO markers.' },
      annotations_stale: { status: 'completed', rationale: 'No stale annotations remain.' },
      annotations_tracked: { status: 'completed', rationale: 'No new untracked annotations added.' },
    };

    const markdown = renderComment({
      findings: [
        {
          title: 'Missing risk note',
          body: 'Document the rollout risk.',
          confidence_score: 0.76,
          priority: 1,
          code_location: {
            path: 'README.md',
            line_range: { start: 10, end: 10 },
          },
        },
      ],
      checklist,
      review_outcome: 'request_changes',
      quality_score: 'B',
      top_issues: [
        'Risk notes are missing from the PR description.',
        'Docs were not updated for the behavior change.',
        'No third issue.',
      ],
      overall_correctness: 'patch is incorrect',
      overall_explanation: 'The implementation is close, but rollout context is missing.',
      overall_confidence_score: 0.88,
    });

    expect(markdown).toContain('## PR Review Checklist');
    expect(markdown).toContain('- [x] PR description clearly explains what/why');
    expect(markdown).toContain('- [ ] Breaking changes and risks are documented');
    expect(markdown).toContain('- [N/A] Async/race conditions considered');
    expect(markdown).toContain('## Review Outcome');
    expect(markdown).toContain('- [x] Request changes');
    expect(markdown).toContain('1. Risk notes are missing from the PR description.');
  });

  test('main writes the generated prompt and schema files', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dorf-pr-review-'));
    const headSha = require('child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' })
      .trim();
    const promptPath = path.join(tempDir, 'codex-prompt.md');
    const schemaPath = path.join(tempDir, 'codex-schema.json');

    try {
      main([
        '--repo-root',
        repoRoot,
        '--prompt-template',
        '.github/codex/review-prompt.md',
        '--output-prompt',
        path.relative(repoRoot, promptPath),
        '--output-schema',
        path.relative(repoRoot, schemaPath),
        '--repository',
        'StephanOnTour/dorfgefluester',
        '--pr-number',
        '100',
        '--base-ref',
        'master',
        '--head-ref',
        'feature/test',
        '--base-sha',
        headSha,
        '--head-sha',
        headSha,
      ]);

      expect(fs.existsSync(promptPath)).toBe(true);
      expect(fs.existsSync(schemaPath)).toBe(true);
      expect(fs.readFileSync(promptPath, 'utf8')).toContain('Pull Request #: 100');
      expect(JSON.parse(fs.readFileSync(schemaPath, 'utf8')).properties.checklist).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
