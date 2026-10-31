// Diagnostic script for Schedule component issue
(function() {
    console.log('🔍 Diagnosing Schedule Component Issue...');
    
    // Wait for React to be ready
    const checkScheduleComponent = () => {
        // Check if we're on the Organiser interface
        const isOrganiserInterface = window.location.pathname === '/' && 
            document.querySelector('h1')?.textContent?.includes('Organiser');
        
        if (!isOrganiserInterface) {
            console.log('❌ Not on Organiser Interface. Please navigate there first.');
            return;
        }
        
        console.log('✅ On Organiser Interface');
        
        // Find the Schedule button
        const scheduleButton = Array.from(document.querySelectorAll('button')).find(
            btn => btn.textContent.trim() === 'Schedule' || btn.textContent.includes('Schedule')
        );
        
        if (!scheduleButton) {
            console.log('❌ Schedule button not found in sidebar');
            return;
        }
        
        console.log('✅ Schedule button found');
        
        // Add click listener to diagnose when clicked
        scheduleButton.addEventListener('click', () => {
            console.log('📍 Schedule button clicked');
            
            setTimeout(() => {
                // Check what's rendered
                const mainContent = document.querySelector('main');
                const contentText = mainContent?.textContent || '';
                
                console.log('📄 Main content area:', mainContent);
                console.log('📝 Content includes:', {
                    hasScheduleHeader: contentText.includes('Schedule'),
                    hasTimeline: contentText.includes('Timeline'),
                    hasSessionManagement: contentText.includes('Session Management'),
                    hasDevelopmentMessage: contentText.includes('under development')
                });
                
                // Check for error boundaries
                const errorBoundary = document.querySelector('[data-error-boundary]');
                if (errorBoundary) {
                    console.log('❌ Error boundary triggered:', errorBoundary);
                }
                
                // Check React component tree
                const reactFiber = mainContent?._reactRootContainer?._internalRoot?.current;
                if (reactFiber) {
                    console.log('🌳 React Fiber:', reactFiber);
                }
                
                // Check for specific component elements
                const hasEnhancedSchedule = document.querySelector('[class*="Enhanced Schedule Management"]');
                const hasCalendarIcon = document.querySelector('svg[size="28"]');
                const hasTabs = document.querySelectorAll('button[class*="pb-2"]').length > 0;
                
                console.log('🔍 Component checks:', {
                    hasEnhancedSchedule,
                    hasCalendarIcon,
                    hasTabs,
                    tabCount: document.querySelectorAll('button[class*="pb-2"]').length
                });
                
                // Check console for errors
                const originalError = console.error;
                console.error = function(...args) {
                    console.log('❌ Console error detected:', args);
                    originalError.apply(console, args);
                };
                
                // If showing "under development"
                if (contentText.includes('under development')) {
                    console.log('⚠️ Component showing "under development" message');
                    console.log('🔍 Checking activeSection value...');
                    
                    // Try to access React props/state
                    const reactInstance = mainContent?._reactRootContainer;
                    console.log('React instance:', reactInstance);
                }
                
            }, 500);
        });
        
        // Auto-click to test
        console.log('🤖 Auto-clicking Schedule button for testing...');
        scheduleButton.click();
    };
    
    // Run check when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkScheduleComponent);
    } else {
        setTimeout(checkScheduleComponent, 1000);
    }
})();