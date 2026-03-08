function parseArgs(argv) {
  const args = {};
  const positionals = [];

  const setArg = (key, value = true) => {
    args[key] = value;
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
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
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      setArg(key, true);
      continue;
    }

    setArg(key, next);
    index++;
  }

  return { args, positionals };
}

module.exports = { parseArgs };

