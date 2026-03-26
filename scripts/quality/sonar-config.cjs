const { spawnSync } = require('child_process');

const REPO_LOCAL_TOKEN_KEY = 'dorfgefluester.sonar.token';

function readRepoLocalGitConfig(key) {
  try {
    const result = spawnSync('git', ['config', '--local', '--get', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0) {
      return '';
    }
    return String(result.stdout || '').trim();
  } catch (_error) {
    return '';
  }
}

function resolveSonarToken(cliToken = '') {
  return (
    cliToken ||
    process.env.SONAR_TOKEN ||
    process.env.SONAR_AUTH_TOKEN ||
    readRepoLocalGitConfig(REPO_LOCAL_TOKEN_KEY) ||
    ''
  );
}

module.exports = {
  REPO_LOCAL_TOKEN_KEY,
  readRepoLocalGitConfig,
  resolveSonarToken,
};
