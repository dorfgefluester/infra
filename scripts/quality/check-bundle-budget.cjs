const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./cli-args.cjs');

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function main(argv = process.argv.slice(2)) {
  const { args } = parseArgs(argv);
  const maxIndexKb = toNumber(args['max-index-kb'], 550);
  const maxPhaserKb = toNumber(args['max-phaser-kb'], 1700);
  const maxTotalKb = toNumber(args['max-total-kb'], 2300);
  const dir = path.join('dist', 'assets');

  if (!fs.existsSync(dir)) {
    console.error('Bundle budget check failed: dist/assets not found.');
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'));
  const stats = files.map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size }));
  const findByPrefix = (prefix) => stats.find((entry) => entry.name.startsWith(prefix));
  const indexChunk = findByPrefix('index-');
  const phaserChunk = findByPrefix('phaser-');
  const totalBytes = stats.reduce((sum, entry) => sum + entry.bytes, 0);

  const limits = {
    index: maxIndexKb * 1024,
    phaser: maxPhaserKb * 1024,
    total: maxTotalKb * 1024,
  };

  const violations = [];
  if (!indexChunk) {
    violations.push('Missing index-* chunk in dist/assets.');
  } else if (indexChunk.bytes > limits.index) {
    violations.push(
      `index chunk ${(indexChunk.bytes / 1024).toFixed(2)} KiB exceeds ${maxIndexKb} KiB.`,
    );
  }

  if (!phaserChunk) {
    violations.push('Missing phaser-* chunk in dist/assets.');
  } else if (phaserChunk.bytes > limits.phaser) {
    violations.push(
      `phaser chunk ${(phaserChunk.bytes / 1024).toFixed(2)} KiB exceeds ${maxPhaserKb} KiB.`,
    );
  }

  if (totalBytes > limits.total) {
    violations.push(`total JS bundle ${(totalBytes / 1024).toFixed(2)} KiB exceeds ${maxTotalKb} KiB.`);
  }

  console.log(
    `Bundle sizes: index=${indexChunk ? (indexChunk.bytes / 1024).toFixed(2) : 'n/a'} KiB, ` +
      `phaser=${phaserChunk ? (phaserChunk.bytes / 1024).toFixed(2) : 'n/a'} KiB, ` +
      `total=${(totalBytes / 1024).toFixed(2)} KiB.`,
  );

  if (violations.length > 0) {
    console.error(`Bundle budget violations:\n - ${violations.join('\n - ')}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
