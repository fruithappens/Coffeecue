const CoffeeCueUITester = require('./browser-automation');

async function runQuickTest() {
  console.log('🚀 Starting Quick Coffee Cue UI Test...\n');
  
  const tester = new CoffeeCueUITester();
  
  try {
    // Initialize browser
    console.log('🌐 Launching browser...');
    await tester.initialize();
    
    // Navigate to the app
    console.log('📱 Navigating to Coffee Cue app...');
    await tester.page.goto('http://localhost:3000');
    await tester.page.waitForTimeout(3000);
    
    // Test login/access
    console.log('🔐 Testing app access...');
    
    // Take initial screenshot
    await tester.page.screenshot({
      path: '../test-results/screenshots/initial-load.png'
    });
    
    // Test button clicking
    console.log('🖱️ Testing button interactions...');
    await tester.clickEveryButton();
    
    // Test form fields
    console.log('📝 Testing form inputs...');
    await tester.testEveryFormField();
    
    // Verify API connections
    console.log('🔍 Verifying API connections...');
    await tester.verifyDatabaseConnections();
    
    // Generate report
    console.log('📊 Generating test report...');
    await tester.generateReport();
    
    console.log('\n✅ Quick test completed!');
    console.log('📋 Check ../test-results/ui-test-report.html for results');
    
    // Keep browser open for 10 seconds to see results
    console.log('🔍 Keeping browser open for inspection...');
    await tester.page.waitForTimeout(10000);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    if (tester.browser) {
      await tester.browser.close();
    }
  }
}

runQuickTest();