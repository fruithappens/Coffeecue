#!/usr/bin/env node

const TestOrchestrator = require('./testOrchestrator');
const chalk = require('chalk');

console.log(chalk.blue.bold(`
☕ Coffee Cue Comprehensive Test Framework
==========================================
`));

console.log(chalk.yellow('This framework will:'));
console.log('- Click every button and monitor results');
console.log('- Test every form field with multiple values');
console.log('- Track all console logs and errors');
console.log('- Monitor all API calls and responses');
console.log('- Verify database operations');
console.log('- Generate detailed reports');
console.log('');

console.log(chalk.green('Starting test framework...'));
console.log(chalk.gray('Open http://localhost:8080 to view real-time monitoring dashboard'));
console.log('');

const orchestrator = new TestOrchestrator();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\nShutting down test framework...'));
  await orchestrator.cleanup();
  process.exit(0);
});

// Run tests
(async () => {
  try {
    await orchestrator.initialize();
    await orchestrator.runAllTests();
    
    console.log(chalk.green.bold('\n✅ Testing completed successfully!'));
    console.log(chalk.blue('\nReports generated in:'));
    console.log('- ./reports/report.html (Full HTML report)');
    console.log('- ./reports/report.json (Raw data)');
    console.log('- ./reports/report.md (Markdown summary)');
    console.log('- ./reports/claude-summary.md (AI-friendly summary)');
    
  } catch (error) {
    console.error(chalk.red.bold('\n❌ Test framework error:'), error);
    process.exit(1);
  }
})();