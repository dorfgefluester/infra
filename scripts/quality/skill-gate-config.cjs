const path = require('path');

const SKILL_GATE_CHECKS = [
  {
    id: 'git_hygiene',
    title: 'Git Hygiene',
    skillFile: 'skills/git-hygiene.md',
    description: 'Reject whitespace/conflict-marker breakage before code leaves the branch.',
    requiredModes: ['local', 'ci'],
  },
  {
    id: 'code_review',
    title: 'Code Review',
    skillFile: 'skills/code-review.md',
    description: 'Keep the branch lint-clean.',
    requiredModes: ['local'],
  },
  {
    id: 'architecture',
    title: 'Architecture',
    skillFile: 'skills/architecture.md',
    description: 'Run the structural/type-level static check.',
    requiredModes: ['local', 'ci'],
  },
  {
    id: 'testing',
    title: 'Testing',
    skillFile: 'skills/testing.md',
    description: 'Require test evidence before push and in CI artifacts.',
    requiredModes: ['local', 'ci'],
  },
  {
    id: 'performance',
    title: 'Performance',
    skillFile: 'skills/performance.md',
    description: 'Build the app and enforce the bundle budget.',
    requiredModes: ['local', 'ci'],
  },
  {
    id: 'documentation',
    title: 'Documentation',
    skillFile: 'skills/documentation.md',
    description: 'Validate content/translation consistency.',
    requiredModes: ['local', 'ci'],
  },
  {
    id: 'security',
    title: 'Security',
    skillFile: 'skills/security.md',
    description: 'Surface Trivy/Sonar high-impact findings when available.',
    requiredModes: [],
  },
  {
    id: 'ui_ux',
    title: 'UI/UX',
    skillFile: 'skills/ui-ux.md',
    description: 'Track whether browser-level UX/accessibility evidence exists.',
    requiredModes: [],
  },
  {
    id: 'code_health',
    title: 'Code Health',
    skillFile: 'skills/code-health.md',
    description: 'Highlight TODO/FIXME/HACK/XXX annotations that need review.',
    requiredModes: [],
  },
];

function getRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

module.exports = {
  SKILL_GATE_CHECKS,
  getRepoRoot,
};
