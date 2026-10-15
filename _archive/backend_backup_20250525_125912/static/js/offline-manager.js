/**
 * Offline Manager for Barista Interface
 * Handles action queueing and synchronization when offline
 */
(function(window) {
    // Check if offline manager is already defined to prevent multiple initializations
    if (window.offlineManager) {
        return;
    }

    // Private variables
    let offlineQueue = [];
    let isProcessingQueue = false;

    /**
     * Load offline queue from localStorage
     * @returns {Array} Loaded queue or empty array
     */
    function loadOfflineQueue() {
        try {
            const savedQueue = localStorage.getItem('offlineActionQueue');
            return savedQueue ? JSON.parse(savedQueue) : [];
        } catch (error) {
            console.error('Error loading offline queue:', error);
            return [];
        }
    }

    /**
     * Save offline queue to localStorage
     * @param {Array} queue - Queue to save
     */
    function saveOfflineQueue(queue) {
        try {
            localStorage.setItem('offlineActionQueue', JSON.stringify(queue));
        } catch (error) {
            console.error('Error saving offline queue:', error);
        }
    }

    /**
     * Create the offline indicator element
     */
    function createOfflineIndicator() {
        // Create indicator if it doesn't exist
        let indicator = document.getElementById('offline-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            indicator.className = 'offline-indicator';
            indicator.style.display = 'none';
            document.body.appendChild(indicator);
        }
        
        updateOfflineIndicator();
    }

    /**
     * Update the offline indicator display
     */
    function updateOfflineIndicator() {
        const indicator = document.getElementById('offline-indicator');
        if (!indicator) return;
        
        if (offlineQueue.length > 0) {
            indicator.textContent = `${offlineQueue.length} pending ${offlineQueue.length === 1 ? 'action' : 'actions'}`;
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }

    /**
     * Add an action to the offline queue
     * @param {Object} action - The action to queue
     */
    function addToOfflineQueue(action) {
        // Validate action
        if (!action || !action.type) {
            console.warn('Invalid action. Action must have a type.', action);
            return;
        }

        // Add timestamp if not present
        action.timestamp = action.timestamp || new Date().toISOString();
        
        // Add to queue
        offlineQueue.push(action);
        
        // Save updated queue
        saveOfflineQueue(offlineQueue);
        
        // Update indicator
        updateOfflineIndicator();
        
        console.log(`Added action to offline queue: ${action.type}`);
    }

    /**
     * Process the offline action queue when back online
     */
    function processOfflineQueue() {
        // Check if already processing or queue is empty
        if (isProcessingQueue || offlineQueue.length === 0) return;
        
        // Set processing flag
        isProcessingQueue = true;
        console.log(`Processing ${offlineQueue.length} offline actions`);
        
        // Create a copy of the queue
        const actionsToProcess = [...offlineQueue];
        
        // Clear original queue
        offlineQueue = [];
        saveOfflineQueue(offlineQueue);
        updateOfflineIndicator();
        
        // Process each action in sequence
        processNextAction(actionsToProcess, 0)
            .then(() => {
                console.log('All offline actions processed successfully');
                isProcessingQueue = false;
            })
            .catch(error => {
                console.error('Error processing offline queue:', error);
                isProcessingQueue = false;
                
                // Restore failed actions to queue
                offlineQueue = actionsToProcess;
                saveOfflineQueue(offlineQueue);
                updateOfflineIndicator();
            });
    }

    /**
     * Process actions one at a time in sequence
     * @param {Array} actions - Array of actions to process
     * @param {number} index - Current index to process
     * @returns {Promise} Promise resolving when all actions are processed
     */
    async function processNextAction(actions, index) {
        // Check if all actions processed
        if (index >= actions.length) return;
        
        const action = actions[index];
        console.log(`Processing offline action ${index + 1}/${actions.length}: ${action.type}`);
        
        try {
            // Process based on action type
            switch (action.type) {
                case 'statusUpdate':
                    await processStatusUpdate(action);
                    break;
                case 'orderCreate':
                    await processOrderCreate(action);
                    break;
                case 'payment':
                    await processPayment(action);
                    break;
                default:
                    console.warn(`Unknown action type: ${action.type}`);
            }
            
            // Process next action
            return processNextAction(actions, index + 1);
        } catch (error) {
            console.error(`Failed to process action: ${action.type}`, error);
            
            // Optionally re-add failed action to queue
            if (action.retryCount === undefined) {
                action.retryCount = 1;
                actions.push(action);
            }
            
            // Continue with next action
            return processNextAction(actions, index + 1);
        }
    }

    /**
     * Process a status update action
     * @param {Object} action - The status update action
     * @returns {Promise} Promise resolving when status is updated
     */
    async function processStatusUpdate(action) {
        const response = await fetch(`/barista/orders/${action.orderId}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ status: action.status })
        });
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to update order status');
        }
        
        console.log(`Successfully processed offline status update for order ${action.orderId}`);
    }

    /**
     * Process order creation action
     * @param {Object} action - The order creation action
     * @returns {Promise} Promise resolving when order is created
     */
    async function processOrderCreate(action) {
        const response = await fetch('/barista/orders/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify(action.orderData)
        });
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to create order');
        }
        
        console.log(`Successfully processed offline order creation: ${data.order.order_number}`);
    }

    /**
     * Process a payment action
     * @param {Object} action - The payment action
     * @returns {Promise} Promise resolving when payment is processed
     */
    async function processPayment(action) {
        const response = await fetch(`/barista/orders/${action.orderId}/payment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            }
        });
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to process payment');
        }
        
        console.log(`Successfully processed offline payment for order ${action.orderId}`);
    }

    /**
     * Register the service worker for offline support
     */
    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                navigator.serviceWorker.register('/static/js/service-worker.js')
                    .then(registration => {
                        console.log('ServiceWorker registered with scope:', registration.scope);
                    })
                    .catch(error => {
                        console.error('ServiceWorker registration failed:', error);
                    });
            });
        }
    }

    /**
     * Get CSRF token from cookies
     * @returns {string} CSRF token
     */
    function getCsrfToken() {
        const name = 'csrftoken';
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return '';
    }

    // Initialize on page load
    function init() {
        // Load existing queue
        offlineQueue = loadOfflineQueue();
        
        // Create offline indicator
        createOfflineIndicator();
        
        // Register service worker
        registerServiceWorker();
        
        // Event listeners for online/offline status
        window.addEventListener('online', processOfflineQueue);
        window.addEventListener('offline', () => {
            console.log('Offline: Requests will be queued');
        });
    }

    // Expose public methods
    window.offlineManager = {
        addToOfflineQueue,
        processOfflineQueue,
        getQueueLength: () => offlineQueue.length
    };

    // Initialize when document is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);
