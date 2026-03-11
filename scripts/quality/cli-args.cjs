function parseArgs(argv) {
  const args = {};
  const positionals = [];

  const setArg = (key, value = true) => {
    args[key] = value;
  };

  const remainingTokens = [...argv];
  while (remainingTokens.length > 0) {
    const token = remainingTokens.shift();
    if (typeof token !== 'string') {
      continue;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf('=');
    if (eqIndex !== -1) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      setArg(key, value);
      continue;
    }

    const key = token.slice(2);
    const next = remainingTokens[0];
    if (!next || next.startsWith('--')) {
      setArg(key, true);
      continue;
    }

    setArg(key, next);
    remainingTokens.shift();
  }

  return { args, positionals };
}

module.exports = { parseArgs };
