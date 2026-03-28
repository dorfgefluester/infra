const { renderChecklistReference } = require('./build-pr-review-assets.cjs');
const { writeText } = require('./fs-utils.cjs');

function main() {
  writeText('reports/pr-review/checklist-reference.md', `# PR Review Checklist\n\n${renderChecklistReference()}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
