// Quick summary for Claude to understand test state
const fs = require('fs');

function generateClaudeSummary() {
  const report = JSON.parse(fs.readFileSync('./test-results/ui-test-report.json'));
  const logs = fs.readFileSync('./test-results/error-log.txt', 'utf8').split('\n');
  
  const summary = `
# Coffee Cue Test Summary for Claude

## 🎯 Test Status
- Total Buttons Tested: ${report.summary.totalButtonsClicked}
- Form Fields Validated: ${report.summary.totalFieldsTested}
- Console Errors Found: ${report.summary.consoleErrors}
- Network Failures: ${report.summary.networkFailures}
- Database Connections: ${report.summary.dbConnections}

## 🔴 Critical Issues Found
${report.consoleErrors.slice(0, 5).map(e => `- ${e.text}`).join('\n')}

## ⚠️ Fields Not Connected to Database
${report.fieldValidations
  .filter(f => !f.dbActivity)
  .map(f => `- ${f.field.name || f.field.id}: No database activity detected`)
  .join('\n')}

## 📝 Next Steps
1. Fix console errors in order of appearance
2. Connect non-functional form fields to backend
3. Resolve network failures (${report.summary.networkFailures} found)
4. Address validation issues

## 🔧 Quick Fix Commands
\`\`\`bash
# View detailed error log
cat test-results/error-log.txt | grep ERROR

# See which buttons do nothing
cat test-results/ui-test-report.json | jq '.elementsClicked[] | select(.networkCalls | length == 0)'

# Check database connection issues
cat test-results/backend-monitor.log | grep "db_query"
\`\`\`
`;

  fs.writeFileSync('./test-results/claude-summary.md', summary);
  console.log(summary);
}

generateClaudeSummary();