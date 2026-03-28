const fs = require('fs');
const { parseArgs } = require('./cli-args.cjs');

function main(argv = process.argv.slice(2)) {
  const { args } = parseArgs(argv);
  const reportPath = args.input || 'reports/sonarqube/sonar-report.json';

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const qg = report?.qualityGate?.status || 'UNKNOWN';
    const relHigh = Number(report?.totals?.reliability_high ?? report?.reliability_high?.length ?? 0);
    const secHigh = Number(report?.totals?.security_high ?? report?.security_high?.length ?? 0);
    const maintHigh = Number(
      report?.totals?.maintainability_high ?? report?.maintainability_high?.length ?? 0,
    );
    const hotspots = report?.hotspots?.unavailable
      ? `unavailable (${report.hotspots.unavailable})`
      : String(report?.totals?.hotspots ?? report?.hotspots?.total ?? 0);
    const nextAction =
      relHigh > 0 || secHigh > 0
        ? 'Fix high-impact reliability/security findings.'
        : maintHigh > 0
          ? 'Group maintainability cleanup by file/module.'
          : 'No high-impact findings in this snapshot.';

    console.log(`- Quality gate: ${qg}`);
    console.log(`- Reliability high: ${relHigh}`);
    console.log(`- Security high: ${secHigh}`);
    console.log(`- Maintainability high: ${maintHigh}`);
    console.log(`- Security hotspots: ${hotspots}`);
    console.log(`- Next action: ${nextAction}`);
  } catch (error) {
    console.log(`- Unable to summarize ${reportPath}: ${error.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
