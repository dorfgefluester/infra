const path = require('path');

const REVIEW_STATUS_VALUES = ['completed', 'needs_attention', 'not_applicable'];
const REVIEW_OUTCOME_VALUES = ['approve', 'request_changes', 'comment_only'];
const QUALITY_SCORE_VALUES = ['A', 'B', 'C', 'D', 'E', 'F'];

const SKILL_FILES = [
  'config/skills/code-review.md',
  'config/skills/architecture.md',
  'config/skills/code-health.md',
  'config/skills/security.md',
  'config/skills/performance.md',
  'config/skills/documentation.md',
  'config/skills/testing.md',
  'config/skills/ui-ux.md',
  'config/skills/git-hygiene.md',
];

const CHECKLIST_SECTIONS = [
  {
    title: 'Scope',
    items: [
      { id: 'scope_description', label: 'PR description clearly explains what/why' },
      { id: 'scope_focus', label: 'Change is focused and not mixing unrelated concerns' },
      { id: 'scope_risks', label: 'Breaking changes and risks are documented' },
    ],
  },
  {
    title: 'Correctness',
    items: [
      { id: 'correctness_logic', label: 'Logic is correct' },
      { id: 'correctness_edge_cases', label: 'Edge cases are handled' },
      { id: 'correctness_types', label: 'Types/return values are correct' },
      { id: 'correctness_async', label: 'Async/race conditions considered' },
    ],
  },
  {
    title: 'Architecture',
    items: [
      { id: 'architecture_separation', label: 'Separation of concerns is preserved' },
      { id: 'architecture_circular', label: 'No circular dependencies introduced' },
      { id: 'architecture_public_api', label: 'Public APIs are clear and stable' },
      { id: 'architecture_state', label: 'State/side effects are managed predictably' },
    ],
  },
  {
    title: 'Code Quality',
    items: [
      { id: 'quality_naming', label: 'Naming is clear and consistent' },
      { id: 'quality_function_size', label: 'Functions are reasonably small and focused' },
      { id: 'quality_duplication', label: 'No duplication or dead code' },
      { id: 'quality_complexity', label: 'No unnecessary complexity or abstractions' },
    ],
  },
  {
    title: 'Error Handling',
    items: [
      { id: 'errors_boundaries', label: 'Failures are handled at the right boundaries' },
      { id: 'errors_empty_catch', label: 'No empty catch blocks' },
      { id: 'errors_actionable', label: 'Errors are actionable and do not leak sensitive data' },
      { id: 'errors_context', label: 'Original error context is preserved where needed' },
    ],
  },
  {
    title: 'Security',
    items: [
      { id: 'security_vulns', label: 'No injection/XSS/auth/access-control issues introduced' },
      { id: 'security_secrets', label: 'No secrets committed' },
      { id: 'security_validation', label: 'Input validation/sanitization is present' },
      { id: 'security_dependencies', label: 'Dependency additions are safe and justified' },
    ],
  },
  {
    title: 'Performance',
    items: [
      { id: 'performance_regressions', label: 'No obvious performance regressions' },
      { id: 'performance_renders', label: 'No unnecessary renders/network calls' },
      { id: 'performance_expensive_work', label: 'Expensive work is optimized or deferred where needed' },
    ],
  },
  {
    title: 'Documentation',
    items: [
      { id: 'docs_updates', label: 'Docs/README/API docs updated if behavior changed' },
      { id: 'docs_why', label: 'Comments/docs explain why when needed' },
      { id: 'docs_config', label: 'Config/env changes are documented' },
    ],
  },
  {
    title: 'Testing',
    items: [
      { id: 'testing_new_behavior', label: 'New behavior is covered by tests' },
      { id: 'testing_edge_cases', label: 'Failure/edge cases are tested' },
      { id: 'testing_existing', label: 'Existing tests pass' },
      { id: 'testing_regression', label: 'Regression tests added for bug fixes' },
    ],
  },
  {
    title: 'UI/UX & Accessibility',
    items: [
      { id: 'ui_consistency', label: 'Responsive and consistent with design patterns' },
      { id: 'ui_states', label: 'Loading/error/empty states handled' },
      { id: 'ui_accessibility', label: 'Keyboard/focus/accessibility basics covered' },
      { id: 'ui_wcag', label: 'No WCAG regressions introduced' },
    ],
  },
  {
    title: 'Code Annotations',
    items: [
      { id: 'annotations_reviewed', label: 'TODO/FIXME/HACK/XXX in touched files reviewed' },
      { id: 'annotations_stale', label: 'Stale annotations removed' },
      { id: 'annotations_tracked', label: 'New annotations are justified and tracked' },
    ],
  },
];

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function flattenChecklistItems() {
  return CHECKLIST_SECTIONS.flatMap((section) => section.items);
}

module.exports = {
  CHECKLIST_SECTIONS,
  QUALITY_SCORE_VALUES,
  REVIEW_OUTCOME_VALUES,
  REVIEW_STATUS_VALUES,
  SKILL_FILES,
  flattenChecklistItems,
  getRepoRoot,
};
