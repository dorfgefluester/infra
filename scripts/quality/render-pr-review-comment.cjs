const path = require('path');
const { parseArgs } = require('./cli-args.cjs');
const { readJson, writeText } = require('./fs-utils.cjs');
const {
  CHECKLIST_SECTIONS,
  REVIEW_OUTCOME_VALUES,
  getRepoRoot,
} = require('./pr-review-config.cjs');

function statusMarker(status) {
  if (status === 'completed') {
    return '[x]';
  }
  if (status === 'not_applicable') {
    return '[N/A]';
  }
  return '[ ]';
}

function formatOutcomeLine(selectedOutcome, outcome, label) {
  return `- ${selectedOutcome === outcome ? '[x]' : '[ ]'} ${label}`;
}

function renderChecklistSection(section, checklist) {
  const lines = [`### ${section.title}`];

  for (const item of section.items) {
    const result = checklist[item.id] || {
      status: 'needs_attention',
      rationale: 'No review result returned for this checklist item.',
    };
    lines.push(`- ${statusMarker(result.status)} ${item.label}`);
    lines.push(`  Reason: ${result.rationale}`);
  }

  return lines.join('\n');
}

function renderComment(review) {
  const lines = [
    '**Codex automated review**',
    '',
    `Verdict: ${review.overall_correctness}`,
    `Review outcome: ${review.review_outcome}`,
    `Quality score: ${review.quality_score}`,
    `Confidence: ${review.overall_confidence_score}`,
    '',
    review.overall_explanation,
    '',
    '## PR Review Checklist',
  ];

  for (const section of CHECKLIST_SECTIONS) {
    lines.push('');
    lines.push(renderChecklistSection(section, review.checklist || {}));
  }

  lines.push('');
  lines.push('## Review Outcome');
  lines.push(formatOutcomeLine(review.review_outcome, REVIEW_OUTCOME_VALUES[0], 'Approve'));
  lines.push(formatOutcomeLine(review.review_outcome, REVIEW_OUTCOME_VALUES[1], 'Request changes'));
  lines.push(formatOutcomeLine(review.review_outcome, REVIEW_OUTCOME_VALUES[2], 'Comment only'));
  lines.push('');
  lines.push('## Summary');
  lines.push(`Quality score: ${review.quality_score}`);
  lines.push('Top 3 issues:');

  for (const [index, issue] of review.top_issues.entries()) {
    lines.push(`${index + 1}. ${issue}`);
  }

  if (Array.isArray(review.findings) && review.findings.length > 0) {
    lines.push('');
    lines.push('## Findings');
    for (const finding of review.findings) {
      lines.push(`- ${finding.title} ([${finding.code_location.path}:${finding.code_location.line_range.start}])`);
    }
  }

  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const { args } = parseArgs(argv);
  const repoRoot = args['repo-root'] ? path.resolve(String(args['repo-root'])) : getRepoRoot();
  const inputPath = path.resolve(repoRoot, String(args.input || 'codex-output.json'));
  const outputPath = path.resolve(repoRoot, String(args.output || 'codex-review-comment.md'));
  const review = readJson(inputPath);

  writeText(outputPath, renderComment(review) + '\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  renderComment,
  renderChecklistSection,
  statusMarker,
};
