// Coffee Cue Automated UI Test Script
(function() {
    console.log('🤖 Coffee Cue Auto Test Script Loaded');
    
    window.CoffeeAutoTest = {
        results: [],
        running: false,
        
        log: function(message, type = 'info') {
            console.log(`[AutoTest] ${message}`);
            this.results.push({
                timestamp: new Date().toISOString(),
                message,
                type
            });
        },
        
        wait: function(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        
        runTest: async function(name, testFn) {
            this.log(`🧪 Running: ${name}`);
            try {
                const result = await testFn();
                if (result.success) {
                    this.log(`✅ ${name}: ${result.message}`, 'success');
                } else {
                    this.log(`❌ ${name}: ${result.message}`, 'error');
                }
                return result;
            } catch (error) {
                this.log(`❌ ${name}: ${error.message}`, 'error');
                return { success: false, message: error.message };
            }
        },
        
        testLogin: async function() {
            // Check if already logged in by looking for logout button or barista interface elements
            const logoutButton = Array.from(document.querySelectorAll('button')).find(b => 
                b.textContent.toLowerCase().includes('logout') || 
                b.textContent.toLowerCase().includes('sign out')
            );
            
            // Also check for barista interface elements
            const baristaElements = document.querySelectorAll('[role="tab"], .tab, .barista-interface, .order-list');
            
            if (logoutButton || baristaElements.length > 0) {
                return { success: true, message: 'Already logged in - found barista interface' };
            }
            
            // Find login form
            const usernameInput = document.querySelector('input[type="text"], input[placeholder*="username" i]');
            const passwordInput = document.querySelector('input[type="password"]');
            const loginButton = Array.from(document.querySelectorAll('button')).find(b => 
                b.textContent.toLowerCase().includes('login') || 
                b.textContent.toLowerCase().includes('sign in')
            );
            
            if (usernameInput && passwordInput && loginButton) {
                usernameInput.value = 'barista';
                passwordInput.value = 'barista123';
                
                // Trigger React events
                const inputEvent = new Event('input', { bubbles: true });
                const changeEvent = new Event('change', { bubbles: true });
                
                usernameInput.dispatchEvent(inputEvent);
                usernameInput.dispatchEvent(changeEvent);
                passwordInput.dispatchEvent(inputEvent);
                passwordInput.dispatchEvent(changeEvent);
                
                loginButton.click();
                
                await this.wait(2000); // Wait for login
                
                return { success: true, message: 'Login attempted with barista credentials' };
            }
            
            return { success: false, message: 'Login form not found' };
        },
        
        testNavigation: async function() {
            const tabs = document.querySelectorAll('[role="tab"], .tab, button[data-tab]');
            if (tabs.length === 0) {
                return { success: false, message: 'No tabs found' };
            }
            
            let clicked = 0;
            for (let i = 0; i < Math.min(tabs.length, 5); i++) {
                tabs[i].click();
                await this.wait(500);
                clicked++;
            }
            
            return { success: true, message: `Clicked ${clicked} tabs` };
        },
        
        testButtons: async function() {
            const buttons = Array.from(document.querySelectorAll('button'));
            const safeButtons = buttons.filter(b => {
                const text = b.textContent.toLowerCase();
                // Skip dangerous buttons
                return !text.includes('logout') && 
                       !text.includes('sign out') &&
                       !text.includes('log out') &&
                       !text.includes('delete') && 
                       !text.includes('remove') &&
                       !text.includes('clear') &&
                       !text.includes('reset') &&
                       !text.includes('cancel');
            });
            
            let clicked = 0;
            console.log(`Found ${safeButtons.length} safe buttons to test`);
            
            for (let i = 0; i < Math.min(safeButtons.length, 10); i++) {
                try {
                    const buttonText = safeButtons[i].textContent.trim();
                    console.log(`  Clicking button ${i+1}: "${buttonText}"`);
                    safeButtons[i].click();
                    await this.wait(200);
                    clicked++;
                } catch (e) {
                    console.log(`  ⚠️ Error clicking button: ${e.message}`);
                }
            }
            
            return { success: true, message: `Clicked ${clicked} buttons safely` };
        },
        
        testSettings: async function() {
            const toggles = document.querySelectorAll('input[type="checkbox"], button[role="switch"]');
            if (toggles.length === 0) {
                return { success: false, message: 'No settings toggles found' };
            }
            
            // Toggle first setting
            const firstToggle = toggles[0];
            const initialState = firstToggle.checked;
            firstToggle.click();
            
            // Check if saved
            const saved = localStorage.getItem('coffee_cue_barista_settings') || 
                         localStorage.getItem('balanceQueueEnabled') ||
                         localStorage.getItem('aiQueueManagementEnabled');
            
            return { 
                success: saved !== null, 
                message: saved ? 'Settings persisted to localStorage' : 'Settings not saved' 
            };
        },
        
        testAudio: function() {
            if (window.CoffeeSounds && window.CoffeeSounds.initialized) {
                return { success: true, message: 'Audio system initialized' };
            }
            return { success: false, message: 'Audio system not found' };
        },
        
        testDisplayTab: function() {
            // Look for QR codes
            const qrImages = document.querySelectorAll('img[src*="qr"], img[alt*="QR"]');
            if (qrImages.length > 0) {
                return { success: true, message: `Found ${qrImages.length} QR codes` };
            }
            
            // Look for display settings
            const displayElements = document.querySelectorAll('[class*="display"], [id*="display"]');
            if (displayElements.length > 0) {
                return { success: true, message: 'Display settings found' };
            }
            
            return { success: false, message: 'Display features not found' };
        },
        
        runAllTests: async function() {
            this.log('🚀 Starting automated UI tests', 'info');
            this.running = true;
            this.results = [];
            
            const tests = [
                { name: 'Login Test', fn: () => this.testLogin() },
                { name: 'Navigation Test', fn: () => this.testNavigation() },
                { name: 'Button Test', fn: () => this.testButtons() },
                { name: 'Settings Test', fn: () => this.testSettings() },
                { name: 'Audio Test', fn: () => this.testAudio() },
                { name: 'Display Tab Test', fn: () => this.testDisplayTab() }
            ];
            
            let passed = 0;
            let failed = 0;
            
            for (const test of tests) {
                const result = await this.runTest(test.name, test.fn);
                if (result.success) passed++;
                else failed++;
                
                await this.wait(1000); // Pause between tests
            }
            
            this.running = false;
            
            const summary = {
                total: tests.length,
                passed,
                failed,
                timestamp: new Date().toISOString(),
                results: this.results
            };
            
            this.log(`\n📊 Test Complete: ${passed}/${tests.length} passed`, passed === tests.length ? 'success' : 'error');
            
            // Save results
            localStorage.setItem('coffee_auto_test_results', JSON.stringify(summary));
            
            // Display in console
            console.table(this.results.filter(r => r.type !== 'info'));
            
            return summary;
        },
        
        showReport: function() {
            const results = JSON.parse(localStorage.getItem('coffee_auto_test_results') || '{}');
            console.log('📊 Coffee Cue Auto Test Report');
            console.log('============================');
            console.log(`Total Tests: ${results.total || 0}`);
            console.log(`Passed: ${results.passed || 0}`);
            console.log(`Failed: ${results.failed || 0}`);
            console.log(`Timestamp: ${results.timestamp || 'N/A'}`);
            console.log('\nDetailed Results:');
            console.table(results.results || []);
        }
    };
    
    // Auto-run tests after a delay if specified in URL
    if (window.location.search.includes('autotest=true')) {
        setTimeout(() => {
            window.CoffeeAutoTest.runAllTests();
        }, 3000);
    }
    
    console.log('💡 To run tests: window.CoffeeAutoTest.runAllTests()');
    console.log('💡 To see last report: window.CoffeeAutoTest.showReport()');
})();