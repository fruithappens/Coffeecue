const puppeteer = require('puppeteer');
const fs = require('fs');

class SimpleUITester {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = {
      timestamp: new Date().toISOString(),
      buttonsClicked: [],
      formsTest: [],
      screenshots: [],
      errors: []
    };
  }

  async initialize() {
    console.log('🌐 Launching Chrome browser...');
    this.browser = await puppeteer.launch({
      headless: false, // Show browser window
      devtools: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.page = await this.browser.newPage();
    
    // Set viewport for consistent screenshots
    await this.page.setViewport({ width: 1200, height: 800 });
    
    // Monitor console for errors
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`🔴 Console Error: ${msg.text()}`);
        this.results.errors.push({
          type: 'console',
          message: msg.text(),
          timestamp: new Date().toISOString()
        });
      }
    });

    console.log('✅ Browser ready!');
  }

  async navigateToApp() {
    console.log('📱 Navigating to Coffee Cue app...');
    await this.page.goto('http://localhost:3000', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    // Take initial screenshot
    await this.page.screenshot({
      path: '../test-results/screenshots/01-initial-load.png'
    });
    
    console.log('✅ App loaded successfully');
  }

  async testButtons() {
    console.log('🖱️ Testing button interactions...');
    
    const buttons = await this.page.$$('button');
    console.log(`Found ${buttons.length} buttons to test`);
    
    for (let i = 0; i < Math.min(buttons.length, 20); i++) { // Limit to first 20 buttons
      try {
        const button = buttons[i];
        
        // Get button info
        const buttonInfo = await this.page.evaluate(el => {
          return {
            text: el.textContent?.trim() || '',
            id: el.id,
            className: el.className,
            disabled: el.disabled,
            visible: el.offsetParent !== null
          };
        }, button);

        if (!buttonInfo.visible || buttonInfo.disabled) {
          console.log(`⏭️  Skipping: ${buttonInfo.text} (disabled/hidden)`);
          continue;
        }

        console.log(`🖱️  Clicking: ${buttonInfo.text || 'Unnamed button'}`);
        
        // Click and wait for reaction
        await button.click();
        await this.page.waitForTimeout(1000);
        
        // Take screenshot after click
        await this.page.screenshot({
          path: `../test-results/screenshots/button-${i}-${buttonInfo.text.replace(/[^a-zA-Z0-9]/g, '_')}.png`
        });
        
        this.results.buttonsClicked.push({
          index: i,
          text: buttonInfo.text,
          id: buttonInfo.id,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.log(`❌ Error clicking button ${i}: ${error.message}`);
        this.results.errors.push({
          type: 'button_click',
          message: error.message,
          buttonIndex: i
        });
      }
    }
    
    console.log(`✅ Tested ${this.results.buttonsClicked.length} buttons`);
  }

  async testForms() {
    console.log('📝 Testing form inputs...');
    
    const inputs = await this.page.$$('input, textarea, select');
    console.log(`Found ${inputs.length} form elements to test`);
    
    for (let i = 0; i < Math.min(inputs.length, 10); i++) { // Limit to first 10 inputs
      try {
        const input = inputs[i];
        
        const inputInfo = await this.page.evaluate(el => {
          return {
            type: el.type || el.tagName.toLowerCase(),
            name: el.name,
            id: el.id,
            placeholder: el.placeholder,
            value: el.value
          };
        }, input);

        console.log(`📝 Testing input: ${inputInfo.name || inputInfo.id || inputInfo.type}`);
        
        // Clear and type test value
        await input.click();
        await this.page.keyboard.down('Control');
        await this.page.keyboard.press('a');
        await this.page.keyboard.up('Control');
        await input.type('Test Value');
        
        this.results.formsTest.push({
          index: i,
          type: inputInfo.type,
          name: inputInfo.name,
          id: inputInfo.id,
          tested: true
        });
        
      } catch (error) {
        console.log(`❌ Error testing input ${i}: ${error.message}`);
      }
    }
    
    console.log(`✅ Tested ${this.results.formsTest.length} form elements`);
  }

  async testNavigation() {
    console.log('🧭 Testing navigation tabs...');
    
    // Look for common tab/navigation patterns
    const navElements = await this.page.$$('button[role="tab"], .tab, nav button, [data-tab]');
    
    for (let i = 0; i < Math.min(navElements.length, 8); i++) {
      try {
        const element = navElements[i];
        
        const elementInfo = await this.page.evaluate(el => {
          return {
            text: el.textContent?.trim() || '',
            role: el.getAttribute('role'),
            dataTab: el.getAttribute('data-tab')
          };
        }, element);

        console.log(`🧭 Clicking nav: ${elementInfo.text}`);
        
        await element.click();
        await this.page.waitForTimeout(2000);
        
        // Take screenshot of each tab
        await this.page.screenshot({
          path: `../test-results/screenshots/nav-${i}-${elementInfo.text.replace(/[^a-zA-Z0-9]/g, '_')}.png`
        });
        
      } catch (error) {
        console.log(`❌ Error with navigation ${i}: ${error.message}`);
      }
    }
  }

  async generateReport() {
    console.log('📊 Generating test report...');
    
    // Ensure results directory exists
    if (!fs.existsSync('../test-results')) {
      fs.mkdirSync('../test-results', { recursive: true });
    }
    
    const report = {
      ...this.results,
      summary: {
        totalButtons: this.results.buttonsClicked.length,
        totalForms: this.results.formsTest.length,
        totalErrors: this.results.errors.length,
        testDuration: new Date().toISOString()
      }
    };

    // Write JSON report
    fs.writeFileSync('../test-results/simple-ui-test-report.json', JSON.stringify(report, null, 2));
    
    // Write simple HTML report
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Coffee Cue UI Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .summary { background: #f0f0f0; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .section { margin: 20px 0; }
    .error { background: #ffe6e6; padding: 10px; margin: 5px 0; border-left: 3px solid #ff0000; }
    .success { background: #e6ffe6; padding: 10px; margin: 5px 0; border-left: 3px solid #00aa00; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>☕ Coffee Cue UI Test Report</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  
  <div class="summary">
    <h2>Summary</h2>
    <p>✅ Buttons Tested: ${report.summary.totalButtons}</p>
    <p>✅ Form Elements Tested: ${report.summary.totalForms}</p>
    <p>❌ Errors Found: ${report.summary.totalErrors}</p>
  </div>

  <div class="section">
    <h2>Buttons Tested</h2>
    <table>
      <tr><th>Button Text</th><th>ID</th><th>Time</th></tr>
      ${report.buttonsClicked.map(btn => `
        <tr>
          <td>${btn.text || 'Unnamed'}</td>
          <td>${btn.id || 'No ID'}</td>
          <td>${new Date(btn.timestamp).toLocaleTimeString()}</td>
        </tr>
      `).join('')}
    </table>
  </div>

  <div class="section">
    <h2>Form Elements Tested</h2>
    <table>
      <tr><th>Type</th><th>Name</th><th>ID</th></tr>
      ${report.formsTest.map(form => `
        <tr>
          <td>${form.type}</td>
          <td>${form.name || 'No name'}</td>
          <td>${form.id || 'No ID'}</td>
        </tr>
      `).join('')}
    </table>
  </div>

  ${report.errors.length > 0 ? `
  <div class="section">
    <h2>Errors Found</h2>
    ${report.errors.map(error => `
      <div class="error">
        <strong>${error.type}</strong>: ${error.message}
      </div>
    `).join('')}
  </div>
  ` : ''}
</body>
</html>`;

    fs.writeFileSync('../test-results/simple-ui-test-report.html', html);
    console.log('✅ Reports generated!');
  }
}

async function runTest() {
  console.log('🚀 Starting Simple Coffee Cue UI Test...\n');
  
  const tester = new SimpleUITester();
  
  try {
    await tester.initialize();
    await tester.navigateToApp();
    await tester.testNavigation();
    await tester.testButtons();
    await tester.testForms();
    await tester.generateReport();
    
    console.log('\n✅ Test completed successfully!');
    console.log('📋 Check ../test-results/simple-ui-test-report.html for results');
    console.log('📸 Screenshots saved in ../test-results/screenshots/');
    
    // Keep browser open for inspection
    console.log('\n🔍 Browser will close in 10 seconds...');
    await tester.page.waitForTimeout(10000);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('💡 Make sure backend (port 5001) and frontend (port 3000) are running');
  } finally {
    if (tester.browser) {
      await tester.browser.close();
    }
  }
}

runTest();