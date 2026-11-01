// Fix corrupted localStorage entries
(function() {
    console.log('🔧 Checking and fixing localStorage...');
    
    const keysToCheck = [
        'coffee_cue_barista_settings',
        'coffeeCueSettings',
        'balanceQueueEnabled',
        'aiQueueManagementEnabled',
        'displayConfiguration'
    ];
    
    keysToCheck.forEach(key => {
        try {
            const value = localStorage.getItem(key);
            if (value === 'undefined' || value === 'null' || value === null) {
                console.log(`✅ Removing invalid value for ${key}`);
                localStorage.removeItem(key);
            } else if (value) {
                // Try to parse it
                try {
                    JSON.parse(value);
                    console.log(`✓ ${key} is valid JSON`);
                } catch (e) {
                    console.log(`❌ Removing corrupted JSON for ${key}`);
                    localStorage.removeItem(key);
                }
            }
        } catch (e) {
            console.error(`Error checking ${key}:`, e);
        }
    });
    
    console.log('✅ localStorage cleanup complete');
})();