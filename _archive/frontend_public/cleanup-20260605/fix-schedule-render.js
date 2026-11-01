// Fix for Schedule component rendering issue
(function() {
    console.log('🔧 Applying Schedule Component Fix...');
    
    // Monitor for React errors
    const originalError = console.error;
    console.error = function(...args) {
        if (args[0] && typeof args[0] === 'string') {
            // Check for common React errors
            if (args[0].includes('EnhancedScheduleManagement') || 
                args[0].includes('ScheduleService') ||
                args[0].includes('schedule')) {
                console.log('❌ Schedule-related error detected:', args);
                
                // Try to provide helpful debugging info
                if (args[0].includes('Cannot read properties of undefined')) {
                    console.log('💡 Tip: Check if all required props are being passed to the component');
                }
                if (args[0].includes('Module not found')) {
                    console.log('💡 Tip: Check import paths and ensure all files exist');
                }
            }
        }
        originalError.apply(console, args);
    };
    
    // Wait for page to load
    setTimeout(() => {
        // Check current state
        const activeSection = localStorage.getItem('organiser_active_section');
        console.log('📍 Current active section:', activeSection);
        
        // If we're trying to view schedule but it's showing "under development"
        if (activeSection === 'schedule') {
            const mainContent = document.querySelector('main');
            const contentText = mainContent?.textContent || '';
            
            if (contentText.includes('under development')) {
                console.log('⚠️ Schedule showing as "under development" - this is the bug!');
                console.log('🔍 Checking component state...');
                
                // Force a re-render by programmatically clicking another tab and back
                console.log('🔧 Attempting to force re-render...');
                
                const dashboardBtn = Array.from(document.querySelectorAll('button')).find(
                    btn => btn.textContent.includes('Live Ops')
                );
                const scheduleBtn = Array.from(document.querySelectorAll('button')).find(
                    btn => btn.textContent.trim() === 'Schedule'
                );
                
                if (dashboardBtn && scheduleBtn) {
                    dashboardBtn.click();
                    setTimeout(() => {
                        scheduleBtn.click();
                        console.log('✅ Forced re-render complete');
                    }, 100);
                }
            } else if (contentText.includes('Enhanced Schedule Management')) {
                console.log('✅ Schedule component is rendering correctly!');
            }
        }
        
        // Add diagnostic info to console
        console.log('📊 Page diagnostics:', {
            hasReactRoot: !!document.getElementById('root'),
            hasOrganiserInterface: document.querySelector('h1')?.textContent?.includes('Organiser'),
            totalButtons: document.querySelectorAll('button').length,
            sidebarButtons: Array.from(document.querySelectorAll('button')).filter(
                btn => btn.textContent.trim().length > 0 && btn.textContent.trim().length < 20
            ).map(btn => btn.textContent.trim())
        });
        
    }, 2000);
})();