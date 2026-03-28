const fs = require('fs');
const path = require('path');

function listArtifacts(root) {
  const reportsDir = path.join(root, 'reports');
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        found.push(path.relative(root, absolute));
      }
    }
  };

  walk(reportsDir);
  return found.sort();
}

function main() {
  const root = process.cwd();
  const payload = {
    gitSha: process.env.GIT_SHA || '',
    imageTag: process.env.IMAGE_TAG || '',
    branch: process.env.BRANCH_NAME || '',
    buildNumber: process.env.BUILD_NUMBER || '',
    registry: process.env.REGISTRY || '',
    webImage: `${process.env.IMAGE_REPO || ''}:${process.env.IMAGE_TAG || ''}`,
    apiImage: `${process.env.API_IMAGE_REPO || ''}:${process.env.IMAGE_TAG || ''}`,
  };

  fs.writeFileSync(path.join(root, 'build-meta.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const md = [
    '# Build Metadata',
    '',
    `- Branch: ${payload.branch}`,
    `- Build: ${payload.buildNumber}`,
    `- Git SHA: ${payload.gitSha}`,
    `- Image tag: ${payload.imageTag}`,
    `- Web image: ${payload.webImage}`,
    `- API image: ${payload.apiImage}`,
    '',
    '## Investigation Artifacts',
    '',
    ...listArtifacts(root).map((artifact) => `- ${artifact}`),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(root, 'build-meta.md'), md, 'utf8');
}

if (require.main === module) {
  main();
}

module.exports = { listArtifacts, main };
