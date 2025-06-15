/**
 * Barista Interface JavaScript
 * Handles real-time order management, station communication, and barista performance tracking
 */

// Global variables
let socket;
let currentBarista = {};
let currentStationId = null;
let orderRefreshInterval = null;
let performanceUpdateInterval = null;
let chatUpdateInterval = null;
let handoverUpdateInterval = null;
let stockUpdateInterval = null;
let orderSounds = {};
let isBatchMode = false;
let selectedOrders = new Set();

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', function() {
    try {
        // Get barista and station info from page with safe fallbacks
        const stationIdEl = document.getElementById('station-id');
        const baristaIdEl = document.getElementById('barista-id');
        const baristaNameEl = document.getElementById('barista-name');

        // Set default values if elements are not found
        currentStationId = stationIdEl ? stationIdEl.value : 'default_station';
        currentBarista.id = baristaIdEl ? baristaIdEl.value : 'default_barista';
        currentBarista.name = baristaNameEl ? baristaNameEl.textContent.trim() : 'Default Barista';
        
        console.log('Initialization Values:', {
            stationId: currentStationId,
            baristaId: currentBarista.id,
            baristaName: currentBarista.name
        });

        // Check if critical elements exist before proceeding
        if (!stationIdEl || !baristaIdEl) {
            console.warn('Station or Barista ID elements are missing. Using default values.');
        }
        
        // Initialize UI components
        initializeUI();
        
        // Initialize WebSocket
        initializeWebSocket();
        
        // Initialize all order cards
        initializeOrderCards();
        
        // Set up event handlers
        setupEventHandlers();
        
        // Start periodic updates
        startTimers();
        
        // Load sounds
        loadSounds();
        
        // Check for batching opportunities
        highlightSimilarOrders();
        
        // Initial smart preparation check
        checkSmartPreparation();

        console.log('Barista interface initialized successfully');
    } catch (error) {
        console.error('Error initializing barista interface:', error);
        
        // Show user-friendly error notification
        const errorNotification = document.createElement('div');
        errorNotification.className = 'alert alert-danger fixed-top text-center';
        errorNotification.textContent = 'Failed to load barista interface. Please refresh the page.';
        document.body.insertBefore(errorNotification, document.body.firstChild);
    }
});

/**
 * Initialize UI components
 */
function initializeUI() {
    // Initialize Bootstrap tooltips
    const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    tooltips.forEach(tooltip => {
        new bootstrap.Tooltip(tooltip);
    });
    
    // Initialize tabs
    const tabLinks = document.querySelectorAll('[data-tab-target]');
    tabLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Deactivate all tabs
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            
            document.querySelectorAll('[data-tab-target]').forEach(link => {
                link.classList.remove('active');
            });
            
            // Activate selected tab
            const targetId = this.dataset.tabTarget;
            document.getElementById(targetId).classList.add('active');
            this.classList.add('active');
            
            // Update URL hash
            window.location.hash = targetId;
        });
    });
    
    // Activate tab from URL hash if present
    const hash = window.location.hash.substring(1);
    if (hash && document.getElementById(hash)) {
        document.querySelector(`[data-tab-target="${hash}"]`).click();
    }
    
    // Initialize counter badges
    updateCountBadges();
    
    // Setup toggle for expanded metrics
    const metricsToggle = document.querySelector('.wait-time-display');
    if (metricsToggle) {
        metricsToggle.addEventListener('click', function() {
            const metricsPanel = document.querySelector('.expanded-metrics');
            if (metricsPanel) {
                metricsPanel.classList.toggle('active');
            }
        });
    }
}

/**
 * Initialize WebSocket connection for real-time updates
 */
function initializeWebSocket() {
    // Create socket connection with improved connection options
    socket = io({
        reconnectionDelayMax: 10000,
        reconnectionAttempts: 5,
        transports: ['websocket', 'polling'],  // Try websocket first, fall back to polling
        timeout: 20000,  // Increase timeout
        forceNew: true
    });
    
    // Connection events
    socket.on('connect', function() {
        console.log('Connected to WebSocket server');
        
        // Join station room
        socket.emit('join', { 
            room: `station_${currentStationId}`,
            barista_id: currentBarista.id
        });
        
        // Update connection status
        updateConnectionStatus(true);
    });
    
    socket.on('disconnect', function() {
        console.log('Disconnected from WebSocket server');
        updateConnectionStatus(false);
    });
    
    socket.on('connect_error', function(error) {
        console.error('Connection error:', error);
        updateConnectionStatus(false);
        
        // Attempt reconnection after a delay
        setTimeout(function() {
            console.log('Attempting to reconnect...');
            socket.connect();
        }, 5000);
    });
    
    // Message handling
    
    // New order
    socket.on('new_order', function(data) {
        console.log('New order received:', data);
        addNewOrder(data);
        playSound('new-order');
        showNotification('New order received', `Order #${data.order_number} - ${data.coffee_type}`, 'info');
    });
    
    // Order update
    socket.on('order_update', function(data) {
        console.log('Order update received:', data);
        updateOrder(data);
    });
    
    // Order assignment
    socket.on('order_assignment', function(data) {
        console.log('Order assignment received:', data);
        if (data.station_id == currentStationId) {
            addNewOrder(data);
            playSound('new-order');
            showNotification('New order assigned', `Order #${data.order_number} assigned to this station`, 'info');
        }
    });
    
    // Batch recommendation
    socket.on('batch_recommendation', function(data) {
        console.log('Batch recommendation received:', data);
        showBatchRecommendation(data);
    });
    
    // Customer message
    socket.on('customer_message', function(data) {
        console.log('Customer message received:', data);
        playSound('message');
        showNotification('Customer message', `From order #${data.order_number}: ${data.message.substring(0, 30)}...`, 'message');
    });
    
    // Station message
    socket.on('station_message', function(data) {
        console.log('Station message received:', data);
        addChatMessage(data);
        
        if (data.is_urgent) {
            playSound('alert');
            showNotification('URGENT STATION MESSAGE', data.content, 'urgent');
        } else {
            playSound('message');
            showNotification('Station message', `From ${data.sender}: ${data.content.substring(0, 30)}...`, 'message');
        }
        
        // Update chat badge
        updateChatBadge();
    });
    
    // Handover note
    socket.on('handover_note', function(data) {
        console.log('Handover note received:', data);
        addHandoverNote(data);
        
        // Update handover badge
        updateHandoverBadge();
    });
    
    // Help response
    socket.on('help_response', function(data) {
        console.log('Help response received:', data);
        playSound('help-response');
        showNotification('Help request update', data.message, 'info');
    });
    
    // Stock alert
    socket.on('stock_alert', function(data) {
        console.log('Stock alert received:', data);
        showStockAlert(data);
        
        if (data.critical) {
            playSound('alert');
        }
    });
    
    // Performance update
    socket.on('performance_update', function(data) {
        console.log('Performance update received:', data);
        updatePerformanceMetrics(data);
    });
}

/**
 * Initialize order cards with all event handlers
 */
function initializeOrderCards() {
    // Initialize existing order cards
    const orderCards = document.querySelectorAll('.order-card');
    orderCards.forEach(card => {
        initOrderCard(card);
    });
    
    // Set up drag and drop for order lists
    const orderLists = document.querySelectorAll('.orders-list');
    orderLists.forEach(list => {
        setupOrderListDragDrop(list);
    });
}

/**
 * Initialize a single order card
 * @param {HTMLElement} card - The order card element
 */
function initOrderCard(card) {
    // Add action button handlers
    const startBtn = card.querySelector('.btn-start-order');
    if (startBtn) {
        startBtn.addEventListener('click', function() {
            const orderId = card.dataset.orderId;
            startOrder(orderId);
        });
    }
    
    const completeBtn = card.querySelector('.btn-complete-order');
    if (completeBtn) {
        completeBtn.addEventListener('click', function() {
            const orderId = card.dataset.orderId;
            completeOrder(orderId);
        });
    }
    
    const cancelBtn = card.querySelector('.btn-cancel-order');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            const orderId = card.dataset.orderId;
            showCancelConfirmation(orderId);
        });
    }
    
    const messageBtn = card.querySelector('.btn-message-customer');
    if (messageBtn) {
        messageBtn.addEventListener('click', function() {
            const orderId = card.dataset.orderId;
            showMessageDialog(orderId);
        });
    }
    
    const printBtn = card.querySelector('.btn-print-label');
    if (printBtn) {
        printBtn.addEventListener('click', function() {
            const orderId = card.dataset.orderId;
            printOrderLabel(orderId);
        });
    }
    
    const pickupBtn = card.querySelector('.btn-pickup-order');
    if (pickupBtn) {
        pickupBtn.addEventListener('click', function() {
            const orderId = card.dataset.orderId;
            markOrderPickedUp(orderId);
        });
    }
    
    const reminderBtn = card.querySelector('.btn-send-reminder');
    if (reminderBtn) {
        reminderBtn.addEventListener('click', function() {
            const orderId = card.dataset.orderId;
            sendPickupReminder(orderId);
        });
    }
    
    const recipeBtn = card.querySelector('.recipe-btn');
    if (recipeBtn) {
        recipeBtn.addEventListener('click', function(e) {
            e.stopPropagation(); // Don't trigger card click
            const coffeeType = card.dataset.coffeeType;
            showRecipeGuide(coffeeType);
        });
    }
    
    // Add click handler to show order details
    card.addEventListener('click', function(e) {
        // Don't show details if clicking a button
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return;
        }
        
        const orderId = card.dataset.orderId;
        
        if (isBatchMode) {
            toggleOrderSelection(orderId, card);
        } else {
            showOrderDetails(orderId);
        }
    });
    
    // If in batch mode, make selectable
    if (isBatchMode && card.closest('.pending-orders')) {
        card.classList.add('selectable');
        if (selectedOrders.has(card.dataset.orderId)) {
            card.classList.add('selected');
        }
    }
    
    // Initialize progress timer if applicable
    if (card.closest('.in-progress-orders')) {
        initOrderTimer(card);
    }
    
    // Initialize pickup timer if applicable
    if (card.closest('.completed-orders')) {
        initPickupTimer(card);
    }
}

/**
 * Set up drag and drop for order lists
 * @param {HTMLElement} list - The order list container
 */
function setupOrderListDragDrop(list) {
    // Initialize Sortable.js for drag and drop
    new Sortable(list, {
        group: 'orders',
        animation: 150,
        ghostClass: 'order-card-ghost',
        dragClass: 'order-card-drag',
        handle: '.order-drag-handle',
        onStart: function(evt) {
            document.body.classList.add('dragging-active');
        },
        onEnd: function(evt) {
            document.body.classList.remove('dragging-active');
            
            // If order moved to a different list
            if (evt.from !== evt.to) {
                const orderId = evt.item.dataset.orderId;
                const newStatus = getStatusFromContainer(evt.to);
                
                if (newStatus) {
                    updateOrderStatus(orderId, newStatus);
                }
            }
        }
    });
}

/**
 * Set up event handlers for the interface
 */
function setupEventHandlers() {
    // Performance metrics toggle
    const waitTimeDisplay = document.querySelector('.wait-time-display');
    if (waitTimeDisplay) {
        waitTimeDisplay.addEventListener('click', function() {
            showPerformanceModal();
        });
    }
    
    // Action bar buttons
    const scanQrBtn = document.getElementById('scan-qr-btn');
    if (scanQrBtn) {
        scanQrBtn.addEventListener('click', startQrScanner);
    }
    
    const newOrderBtn = document.getElementById('new-order-btn');
    if (newOrderBtn) {
        newOrderBtn.addEventListener('click', showNewOrderDialog);
    }
    
    const waitTimeBtn = document.getElementById('adjust-wait-btn');
    if (waitTimeBtn) {
        waitTimeBtn.addEventListener('click', showWaitTimeDialog);
    }
    
    const batchOrdersBtn = document.getElementById('batch-orders-btn');
    if (batchOrdersBtn) {
        batchOrdersBtn.addEventListener('click', toggleBatchMode);
    }
    
    const stockBtn = document.getElementById('update-stock-btn');
    if (stockBtn) {
        stockBtn.addEventListener('click', showStockModal);
    }
    
    const breakBtn = document.getElementById('break-btn');
    if (breakBtn) {
        breakBtn.addEventListener('click', toggleBreakMode);
    }
    
    const helpBtn = document.getElementById('help-btn');
    if (helpBtn) {
        helpBtn.addEventListener('click', showHelpRequestDialog);
    }
    
    // Filter and sort controls
    const orderFilterBtns = document.querySelectorAll('[data-order-filter]');
    orderFilterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const filter = this.dataset.orderFilter;
            filterOrders(filter);
            
            // Update active state
            orderFilterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    const orderSortBtns = document.querySelectorAll('[data-order-sort]');
    orderSortBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const sort = this.dataset.orderSort;
            sortOrders(sort);
            
            // Update active state
            orderSortBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // Search box
    const searchBox = document.getElementById('order-search');
    if (searchBox) {
        searchBox.addEventListener('input', function() {
            searchOrders(this.value);
        });
    }
    
    // Station chat button
    const chatBtn = document.getElementById('station-chat-btn');
    if (chatBtn) {
        chatBtn.addEventListener('click', showChatDialog);
    }
    
    // Handover notes button
    const handoverBtn = document.getElementById('handover-notes-btn');
    if (handoverBtn) {
        handoverBtn.addEventListener('click', showHandoverDialog);
    }
    
    // Recipe buttons
    const coffeeRecipeBtns = document.querySelectorAll('.recipe-btn');
    coffeeRecipeBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const coffeeType = this.dataset.coffeeType;
            showRecipeGuide(coffeeType);
        });
    });
    
    // Form submissions
    const messageForm = document.getElementById('customer-message-form');
    if (messageForm) {
        messageForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitCustomerMessage();
        });
    }
    
    const helpForm = document.getElementById('help-request-form');
    if (helpForm) {
        helpForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitHelpRequest();
        });
    }
    
    const newOrderForm = document.getElementById('new-order-form');
    if (newOrderForm) {
        newOrderForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitNewOrder();
        });
    }
    
    const chatForm = document.getElementById('station-chat-form');
    if (chatForm) {
        chatForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitChatMessage();
        });
    }
    
    const handoverForm = document.getElementById('handover-form');
    if (handoverForm) {
        handoverForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitHandoverNote();
        });
    }
    
    // Quick message buttons
    const quickMsgBtns = document.querySelectorAll('.quick-message-btn');
    quickMsgBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const message = this.dataset.message;
            const messageInput = document.getElementById('customer-message-text');
            if (messageInput) {
                messageInput.value = message;
            }
        });
    });
    
    // Smart preparation buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('smart-prep-btn') || e.target.closest('.smart-prep-btn')) {
            const btn = e.target.classList.contains('smart-prep-btn') ? e.target : e.target.closest('.smart-prep-btn');
            const type = btn.dataset.type;
            const id = btn.dataset.id;
            
            if (type === 'batch') {
                startBatchPreparation(id);
            } else if (type === 'pre_order') {
                startPreOrderPreparation(id);
            }
        }
    });
    
    // Reconnect when page becomes visible again
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && socket && !socket.connected) {
            console.log('Page became visible, attempting to reconnect WebSocket');
            socket.connect();
        }
    });
}

/**
 * Start timers for various updates
 */
function startTimers() {
    // Update wait times every minute
    setInterval(updateWaitTimes, 60000);
    
    // Update order timers every 30 seconds
    setInterval(updateOrderTimers, 30000);
    
    // Update pickup timers every minute
    setInterval(updatePickupTimers, 60000);
    
    // Check for similar orders every 2 minutes
    setInterval(highlightSimilarOrders, 120000);
    
    // Periodically refresh connection status
    setInterval(function() {
        updateConnectionStatus(socket && socket.connected);
    }, 30000);
    
    // Check for stock level warnings every 5 minutes
    setInterval(checkStockLevels, 300000);
    
    // Update performance metrics every 5 minutes
    setInterval(fetchPerformanceMetrics, 300000);
    
    // Check smart preparation recommendations every 2 minutes
    setInterval(checkSmartPreparation, 120000);
    
    // Update chat messages every minute
    setInterval(fetchChatMessages, 60000);
    
    // Update handover notes every 5 minutes
    setInterval(fetchHandoverNotes, 300000);
    
    // ADD THIS NEW CODE HERE:
    // Keep Socket.IO connection alive with periodic pings
    setInterval(function() {
        if (socket && socket.connected) {
            socket.emit('ping', {});
        }
    }, 25000);
}

/**
 * Load audio files for notifications
 */
function loadSounds() {
    const sounds = {
        'new-order': '/static/audio/scan-success.mp3',
        'order-complete': '/static/audio/order-ready.mp3',
        'order-pickup': '/static/audio/order-ready.mp3',
        'message': '/static/audio/notification.mp3',
        'batch-start': '/static/audio/notification.mp3',
        'help-response': '/static/audio/notification.mp3',
        'alert': '/static/audio/error.mp3'
    };
    
    for (const [name, path] of Object.entries(sounds)) {
        try {
            orderSounds[name] = new Audio(path);
            orderSounds[name].load();
            
            // Add error logging
            orderSounds[name].onerror = function() {
                console.error(`Error loading sound: ${name} at ${path}`);
            };
        } catch (error) {
            console.error(`Failed to load sound ${name}:`, error);
        }
    }
}

/*************************
 * Order Action Functions
 *************************/

/**
 * Start processing an order
 * @param {string} orderId - The order ID
 */
function startOrder(orderId) {
    updateOrderStatus(orderId, 'in_progress');
}

/**
 * Mark an order as completed
 * @param {string} orderId - The order ID
 */
function completeOrder(orderId) {
    updateOrderStatus(orderId, 'completed');
}

/**
 * Show confirmation dialog for cancelling an order
 * @param {string} orderId - The order ID
 */
function showCancelConfirmation(orderId) {
    const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
    if (!orderCard) return;
    
    // Get order details for confirmation
    const orderNumber = orderCard.querySelector('.order-number').textContent;
    const coffeeType = orderCard.querySelector('.coffee-name').textContent;
    const customerName = orderCard.querySelector('.customer-name').textContent;
    
    // Set values in modal
    const modal = document.getElementById('cancel-modal');
    modal.querySelector('#cancel-order-id').value = orderId;
    modal.querySelector('#cancel-order-details').textContent = 
        `${orderNumber} - ${coffeeType} for ${customerName}`;
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Cancel an order after confirmation
 */
function confirmCancelOrder() {
    const orderId = document.getElementById('cancel-order-id').value;
    const reason = document.getElementById('cancel-reason').value;
    
    fetch(`/barista/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ reason: reason })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Remove order card from UI
            const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
            if (orderCard) {
                orderCard.remove();
            }
            
            // Update counts
            updateCountBadges();
            
            // Close modal
            const modal = document.getElementById('cancel-modal');
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();
            
            // Show notification
            showNotification('Order cancelled', `Order ${orderId} has been cancelled`, 'info');
        } else {
            showNotification('Error', data.error || 'Failed to cancel order', 'error');
        }
    })
    .catch(error => {
        console.error('Error cancelling order:', error);
        showNotification('Error', 'Failed to cancel order. Please try again.', 'error');
    });
}

/**
 * Show dialog to message a customer
 * @param {string} orderId - The order ID
 */
function showMessageDialog(orderId) {
    const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
    if (!orderCard) return;
    
    // Get order details for the message dialog
    const orderNumber = orderCard.querySelector('.order-number').textContent;
    const coffeeType = orderCard.querySelector('.coffee-name').textContent;
    const customerName = orderCard.querySelector('.customer-name').textContent;
    const phoneLastDigits = orderCard.dataset.phoneLastDigits || '';
    
    // Set values in modal
    const modal = document.getElementById('message-modal');
    modal.querySelector('#message-order-id').value = orderId;
    modal.querySelector('#message-order-details').innerHTML = 
        `${orderNumber} - ${coffeeType} for ${customerName}<br>Phone: xxx-xxx-${phoneLastDigits}`;
    
    // Clear previous message
    modal.querySelector('#customer-message-text').value = '';
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Submit a message to a customer
 */
function submitCustomerMessage() {
    const orderId = document.getElementById('message-order-id').value;
    const message = document.getElementById('customer-message-text').value;
    
    if (!message.trim()) {
        showNotification('Error', 'Please enter a message', 'error');
        return;
    }
    
    fetch(`/barista/orders/${orderId}/message`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ message: message })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close modal
            const modal = document.getElementById('message-modal');
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();
            
            // Show confirmation
            showNotification('Message sent', 'Your message has been sent to the customer', 'success');
        } else {
            showNotification('Error', data.error || 'Failed to send message', 'error');
        }
    })
    .catch(error => {
        console.error('Error sending message:', error);
        showNotification('Error', 'Failed to send message. Please try again.', 'error');
    });
}

/**
 * Print label for an order
 * @param {string} orderId - The order ID
 */
function printOrderLabel(orderId) {
    fetch(`/barista/orders/${orderId}/print-label`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Label Printed', `Label for order ${orderId} sent to printer`, 'success');
            
            // Update UI to reflect label printed
            const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
            if (orderCard) {
                orderCard.classList.add('label-printed');
                
                const printBtn = orderCard.querySelector('.btn-print-label');
                if (printBtn) {
                    printBtn.innerHTML = '<i class="bi bi-printer-check"></i> Reprint';
                }
            }
        } else {
            showNotification('Printing Error', data.error || 'Failed to print label', 'error');
        }
    })
    .catch(error => {
        console.error('Error printing label:', error);
        showNotification('Printing Error', 'Failed to print label. Please try again.', 'error');
    });
}

/**
 * Mark an order as picked up
 * @param {string} orderId - The order ID
 */
function markOrderPickedUp(orderId) {
    updateOrderStatus(orderId, 'picked_up');
}

/**
 * Send pickup reminder to customer
 * @param {string} orderId - The order ID
 */
function sendPickupReminder(orderId) {
    fetch(`/barista/orders/${orderId}/remind`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Reminder Sent', `Reminder sent to customer for order ${orderId}`, 'success');
            
            // Update UI to reflect reminder sent
            const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
            if (orderCard) {
                orderCard.classList.add('reminder-sent');
                
                const reminderBtn = orderCard.querySelector('.btn-send-reminder');
                if (reminderBtn) {
                    reminderBtn.disabled = true;
                    reminderBtn.innerHTML = '<i class="bi bi-check-lg"></i> Reminded';
                    
                    // Re-enable after 10 minutes
                    setTimeout(() => {
                        if (reminderBtn) {
                            reminderBtn.disabled = false;
                            reminderBtn.innerHTML = '<i class="bi bi-bell"></i> Remind';
                        }
                    }, 600000);
                }
            }
        } else {
            showNotification('Error', data.error || 'Failed to send reminder', 'error');
        }
    })
    .catch(error => {
        console.error('Error sending reminder:', error);
        showNotification('Error', 'Failed to send reminder. Please try again.', 'error');
    });
}

/**
 * Update order status on the server
 * @param {string} orderId - The order ID
 * @param {string} status - The new status
 */
function updateOrderStatus(orderId, status) {
    fetch(`/barista/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({ status: status })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update UI immediately for better user experience
            updateOrderUI(orderId, status);
            
            // Play appropriate sound
            if (status === 'completed') {
                playSound('order-complete');
            } else if (status === 'picked_up') {
                playSound('order-pickup');
            }
            
            // Show notification for picked up orders
            if (status === 'picked_up') {
                showNotification('Order Picked Up', `Order ${orderId} has been picked up`, 'success');
            }
        } else {
            showNotification('Error', data.error || 'Failed to update order status', 'error');
        }
    })
    .catch(error => {
        console.error('Error updating order status:', error);
        showNotification('Error', 'Failed to update order status. Please try again.', 'error');
    });
}

/**
 * Toggle batch ordering mode
 */
function toggleBatchMode() {
    isBatchMode = !isBatchMode;
    
    const batchBtn = document.getElementById('batch-orders-btn');
    const pendingCards = document.querySelectorAll('.pending-orders .order-card');
    
    if (isBatchMode) {
        // Enter batch mode
        batchBtn.classList.add('active');
        batchBtn.innerHTML = '<i class="bi bi-check-lg"></i> Confirm Batch';
        
        // Make pending cards selectable
        pendingCards.forEach(card => {
            card.classList.add('selectable');
        });
        
        // Show batch mode explanation toast
        showNotification('Batch Mode Active', 'Click orders to select them for batch processing, then click Confirm Batch', 'info');
    } else {
        // Exit batch mode
        batchBtn.classList.remove('active');
        batchBtn.innerHTML = '<i class="bi bi-stack"></i> Batch Orders';
        
        // Remove selectable class
        pendingCards.forEach(card => {
            card.classList.remove('selectable');
            card.classList.remove('selected');
        });
        
        // Process selected orders if any
        if (selectedOrders.size > 0) {
            processBatchOrders();
        }
        
        // Clear selection
        selectedOrders.clear();
    }
}

/**
 * Toggle selection of an order for batch processing
 * @param {string} orderId - The order ID
 * @param {HTMLElement} card - The order card element
 */
function toggleOrderSelection(orderId, card) {
    if (selectedOrders.has(orderId)) {
        selectedOrders.delete(orderId);
        card.classList.remove('selected');
    } else {
        selectedOrders.add(orderId);
        card.classList.add('selected');
    }
    
    // Update batch button count
    const batchBtn = document.getElementById('batch-orders-btn');
    if (batchBtn) {
        batchBtn.innerHTML = selectedOrders.size > 0
            ? `<i class="bi bi-check-lg"></i> Confirm Batch (${selectedOrders.size})`
            : '<i class="bi bi-check-lg"></i> Confirm Batch';
    }
}

/**
 * Process batch of selected orders
 */
function processBatchOrders() {
    if (selectedOrders.size === 0) {
        showNotification('No Orders Selected', 'Please select at least one order to batch process', 'warning');
        return;
    }
    
    fetch('/barista/orders/batch-process', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            order_ids: Array.from(selectedOrders),
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update UI for all selected orders
            selectedOrders.forEach(orderId => {
                updateOrderUI(orderId, 'in_progress');
            });
            
            // Show notification
            showNotification('Batch Started', `Started processing ${selectedOrders.size} orders as a batch`, 'success');
            
            // Play sound
            playSound('batch-start');
            
            // Clear selection
            selectedOrders.clear();
        } else {
            showNotification('Error', data.error || 'Failed to start batch processing', 'error');
        }
    })
    .catch(error => {
        console.error('Error processing batch:', error);
        showNotification('Error', 'Failed to process batch. Please try again.', 'error');
    });
}

/**
 * Show recipe guide for a coffee type
 * @param {string} coffeeType - The coffee type to show recipe for
 */
function showRecipeGuide(coffeeType) {
    fetch(`/barista/recipes/${encodeURIComponent(coffeeType)}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Populate recipe modal
                const modal = document.getElementById('recipe-modal');
                modal.querySelector('.modal-title').textContent = data.recipe.name;
                
                // Fill in recipe details
                const recipeTable = modal.querySelector('.recipe-details');
                recipeTable.innerHTML = `
                    <tr>
                        <td>Ratio:</td>
                        <td>${data.recipe.ratio}</td>
                    </tr>
                    <tr>
                        <td>Milk Temperature:</td>
                        <td>${data.recipe.milk_temp_min}°C - ${data.recipe.milk_temp_max}°C</td>
                    </tr>
                    <tr>
                        <td>Technique:</td>
                        <td>${data.recipe.technique}</td>
                    </tr>
                    <tr>
                        <td>Art Suggestion:</td>
                        <td>${data.recipe.art_suggestions}</td>
                    </tr>
                    <tr>
                        <td>Notes:</td>
                        <td>${data.recipe.recipe_notes}</td>
                    </tr>
                `;
                
                // Show latte art guide if available
                const artGuide = modal.querySelector('.art-guide');
                if (data.recipe.art_images && data.recipe.art_images.length > 0) {
                    let artHtml = '';
                    data.recipe.art_images.forEach(art => {
                        artHtml += `
                            <div class="art-example">
                                <img src="${art.image_url}" alt="${art.name}">
                                <div class="art-name">${art.name}</div>
                            </div>
                        `;
                    });
                    artGuide.innerHTML = artHtml;
                    artGuide.style.display = 'block';
                } else {
                    artGuide.style.display = 'none';
                }
                
                // Show modal
                const bsModal = new bootstrap.Modal(modal);
                bsModal.show();
            } else {
                showNotification('Error', data.error || 'Failed to load recipe', 'error');
            }
        })
        .catch(error => {
            console.error('Error loading recipe:', error);
            showNotification('Error', 'Failed to load recipe. Please try again.', 'error');
        });
}

/**
 * Show performance metrics
 */
function showPerformanceModal() {
    fetchPerformanceMetrics()
        .then(() => {
            // Show modal
            const modal = document.getElementById('performance-modal');
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
        });
}

/**
 * Fetch performance metrics from server
 * @returns {Promise} Promise that resolves when metrics are updated
 */
function fetchPerformanceMetrics() {
    return fetch(`/barista/metrics/${currentBarista.id}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updatePerformanceMetrics(data.metrics);
            } else {
                console.error('Error fetching metrics:', data.error);
            }
        })
        .catch(error => {
            console.error('Error fetching performance metrics:', error);
        });
}

/**
 * Show station chat dialog
 */
function showChatDialog() {
    fetchChatMessages()
        .then(() => {
            // Show modal
            const modal = document.getElementById('chat-modal');
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
            
            // Focus the input field
            setTimeout(() => {
                const input = document.getElementById('chat-message');
                if (input) input.focus();
            }, 500);
            
            // Reset chat badge
            const chatBadge = document.querySelector('#station-chat-btn .badge');
            if (chatBadge) {
                chatBadge.textContent = '0';
                chatBadge.style.display = 'none';
            }
        });
}

/**
 * Fetch chat messages from server
 * @returns {Promise} Promise that resolves when messages are updated
 */
function fetchChatMessages() {
    return fetch('/barista/chat/messages')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateChatMessages(data.messages);
            } else {
                console.error('Error fetching chat messages:', data.error);
            }
        })
        .catch(error => {
            console.error('Error fetching chat messages:', error);
        });
}

/**
 * Submit chat message
 */
function submitChatMessage() {
    const message = document.getElementById('chat-message').value;
    const isUrgent = document.getElementById('chat-urgent').checked;
    
    if (!message.trim()) {
        showNotification('Error', 'Please enter a message', 'error');
        return;
    }
    
    fetch('/barista/chat/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            message: message,
            is_urgent: isUrgent,
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Clear input
            document.getElementById('chat-message').value = '';
            document.getElementById('chat-urgent').checked = false;
            
            // Add message to UI
            addChatMessage({
                sender: currentBarista.name + ' (You)',
                content: message,
                created_at: new Date().toISOString(),
                is_urgent: isUrgent
            });
            
            // Scroll to bottom
            const chatContainer = document.querySelector('.chat-messages');
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        } else {
            showNotification('Error', data.error || 'Failed to send message', 'error');
        }
    })
    .catch(error => {
        console.error('Error sending chat message:', error);
        showNotification('Error', 'Failed to send message. Please try again.', 'error');
    });
}

/**
 * Show handover notes dialog
 */
function showHandoverDialog() {
    fetchHandoverNotes()
        .then(() => {
            // Show modal
            const modal = document.getElementById('handover-modal');
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
            
            // Reset handover badge
            const handoverBadge = document.querySelector('#handover-notes-btn .badge');
            if (handoverBadge) {
                handoverBadge.textContent = '0';
                handoverBadge.style.display = 'none';
            }
        });
}

/**
 * Fetch handover notes from server
 * @returns {Promise} Promise that resolves when notes are updated
 */
function fetchHandoverNotes() {
    return fetch(`/barista/handover/notes/${currentStationId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateHandoverNotes(data.notes);
            } else {
                console.error('Error fetching handover notes:', data.error);
            }
        })
        .catch(error => {
            console.error('Error fetching handover notes:', error);
        });
}

/**
 * Submit handover note
 */
function submitHandoverNote() {
    const note = document.getElementById('handover-note').value;
    
    if (!note.trim()) {
        showNotification('Error', 'Please enter a note', 'error');
        return;
    }
    
    fetch('/barista/handover/add', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            note: note,
            station_id: currentStationId,
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Clear input
            document.getElementById('handover-note').value = '';
            
            // Add note to UI
            addHandoverNote({
                author: currentBarista.name + ' (You)',
                content: note,
                created_at: new Date().toISOString(),
                time_ago: 'Just now'
            });
            
            showNotification('Note Added', 'Your handover note has been saved', 'success');
        } else {
            showNotification('Error', data.error || 'Failed to save note', 'error');
        }
    })
    .catch(error => {
        console.error('Error saving handover note:', error);
        showNotification('Error', 'Failed to save note. Please try again.', 'error');
    });
}

/**
 * Show help request dialog
 */
function showHelpRequestDialog() {
    const modal = document.getElementById('help-modal');
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Submit help request
 */
function submitHelpRequest() {
    const helpType = document.getElementById('help-type').value;
    const urgency = document.getElementById('help-urgency').value;
    const details = document.getElementById('help-details').value;
    
    fetch('/barista/help/request', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            help_type: helpType,
            urgency: urgency,
            details: details,
            station_id: currentStationId,
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close modal
            const modal = document.getElementById('help-modal');
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();
            
            // Show confirmation
            showNotification('Help Requested', 'Your help request has been submitted', 'success');
            
            // Clear form
            document.getElementById('help-details').value = '';
        } else {
            showNotification('Error', data.error || 'Failed to submit help request', 'error');
        }
    })
    .catch(error => {
        console.error('Error submitting help request:', error);
        showNotification('Error', 'Failed to submit help request. Please try again.', 'error');
    });
}

/**
 * Show stock levels modal
 */
function showStockModal() {
    // Fetch latest stock levels
    fetch('/barista/stock/levels')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Populate stock modal
                const modal = document.getElementById('stock-modal');
                const stockContainer = modal.querySelector('.stock-items');
                
                stockContainer.innerHTML = '';
                
                data.items.forEach(item => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'mb-3';
                    
                    // Format percentage
                    const percentage = Math.max(0, Math.min(100, (item.current_quantity / item.capacity) * 100));
                    
                    // Determine status class
                    let statusClass = 'bg-success';
                    if (item.status === 'warning') {
                        statusClass = 'bg-warning';
                    } else if (item.status === 'danger') {
                        statusClass = 'bg-danger';
                    }
                    
                    itemEl.innerHTML = `
                        <div class="d-flex justify-content-between mb-1">
                            <span class="font-medium">${item.name}</span>
                            <span class="text-sm ${item.status === 'danger' ? 'text-danger font-weight-bold' : ''}">
                                ${item.current_quantity}${item.unit} / ${item.capacity}${item.unit}
                            </span>
                        </div>
                        <div class="progress">
                            <div class="progress-bar ${statusClass}" role="progressbar" 
                                style="width: ${percentage}%" aria-valuenow="${percentage}" 
                                aria-valuemin="0" aria-valuemax="100"></div>
                        </div>
                        ${item.predicted_empty ? `
                            <div class="text-sm mt-1 text-muted">
                                ${item.predicted_empty}
                            </div>
                        ` : ''}
                    `;
                    
                    stockContainer.appendChild(itemEl);
                });
                
                // Show modal
                const bsModal = new bootstrap.Modal(modal);
                bsModal.show();
            } else {
                showNotification('Error', data.error || 'Failed to load stock levels', 'error');
            }
        })
        .catch(error => {
            console.error('Error loading stock levels:', error);
            showNotification('Error', 'Failed to load stock levels. Please try again.', 'error');
        });
}

/**
 * Request stock replenishment
 */
function requestStockReplenishment() {
    // Get selected items
    const selectedItems = Array.from(document.querySelectorAll('.stock-item-checkbox:checked')).map(checkbox => checkbox.value);
    
    if (selectedItems.length === 0) {
        showNotification('No Items Selected', 'Please select at least one item to request', 'warning');
        return;
    }
    
    fetch('/barista/stock/request', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            item_ids: selectedItems,
            station_id: currentStationId,
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close modal
            const modal = document.getElementById('stock-modal');
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();
            
            // Show confirmation
            showNotification('Stock Requested', 'Your stock request has been submitted', 'success');
        } else {
            showNotification('Error', data.error || 'Failed to request stock', 'error');
        }
    })
    .catch(error => {
        console.error('Error requesting stock:', error);
        showNotification('Error', 'Failed to request stock. Please try again.', 'error');
    });
}

/**
 * Check stock levels and show warnings
 */
function checkStockLevels() {
    fetch('/barista/stock/check')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.warnings.length > 0) {
                showStockAlert(data.warnings);
            }
        })
        .catch(error => {
            console.error('Error checking stock levels:', error);
        });
}

/**
 * Check for smart preparation opportunities
 */
function checkSmartPreparation() {
    fetch('/barista/preparation/recommendations')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateSmartPreparationRecommendations(data.recommendations);
            }
        })
        .catch(error => {
            console.error('Error checking smart preparation:', error);
        });
}

/**
 * Start batch preparation
 * @param {string} batchId - Identifier for batch group
 */
function startBatchPreparation(batchId) {
    fetch('/barista/preparation/batch', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            batch_id: batchId,
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Show confirmation
            showNotification('Batch Started', 'Batch preparation started successfully', 'success');
            
            // Play sound
            playSound('batch-start');
            
            // Remove recommendation
            const recommendation = document.querySelector(`.smart-preparation-item[data-id="${batchId}"]`);
            if (recommendation) {
                recommendation.remove();
            }
            
            // Update affected orders
            if (data.affected_orders) {
                data.affected_orders.forEach(orderId => {
                    updateOrderUI(orderId, 'in_progress');
                });
            }
        } else {
            showNotification('Error', data.error || 'Failed to start batch preparation', 'error');
        }
    })
    .catch(error => {
        console.error('Error starting batch preparation:', error);
        showNotification('Error', 'Failed to start batch preparation. Please try again.', 'error');
    });
}

/**
 * Start pre-order preparation
 * @param {string} orderId - Order ID for pre-order
 */
function startPreOrderPreparation(orderId) {
    fetch('/barista/preparation/pre-order', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            order_id: orderId,
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Show confirmation
            showNotification('Pre-order Started', 'Pre-order preparation started successfully', 'success');
            
            // Remove recommendation
            const recommendation = document.querySelector(`.smart-preparation-item[data-id="${orderId}"]`);
            if (recommendation) {
                recommendation.remove();
            }
            
            // Update affected orders
            if (data.affected_orders) {
                data.affected_orders.forEach(orderId => {
                    updateOrderUI(orderId, 'in_progress');
                });
            }
        } else {
            showNotification('Error', data.error || 'Failed to start pre-order preparation', 'error');
        }
    })
    .catch(error => {
        console.error('Error starting pre-order preparation:', error);
        showNotification('Error', 'Failed to start pre-order preparation. Please try again.', 'error');
    });
}

/**
 * Toggle break mode for barista
 */
function toggleBreakMode() {
    const breakBtn = document.getElementById('break-btn');
    const isOnBreak = breakBtn.classList.contains('active');
    
    fetch('/barista/break', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            barista_id: currentBarista.id,
            on_break: !isOnBreak
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update button state
            if (!isOnBreak) {
                breakBtn.classList.add('active');
                breakBtn.innerHTML = '<i class="bi bi-cup-hot"></i> End Break';
                breakBtn.classList.remove('bg-amber-500');
                breakBtn.classList.add('bg-green-500');
                
                // Show notification
                showNotification('Break Started', 'You are now on break. New orders will be redirected.', 'info');
            } else {
                breakBtn.classList.remove('active');
                breakBtn.innerHTML = '<i class="bi bi-cup"></i> Break';
                breakBtn.classList.remove('bg-green-500');
                breakBtn.classList.add('bg-amber-500');
                
                // Show notification
                showNotification('Break Ended', 'You are now back from break', 'info');
            }
        } else {
            showNotification('Error', data.error || 'Failed to update break status', 'error');
        }
    })
    .catch(error => {
        console.error('Error toggling break mode:', error);
        showNotification('Error', 'Failed to update break status. Please try again.', 'error');
    });
}

/*************************
 * UI Update Functions
 *************************/

/**
 * Add a new order to the UI
 * @param {Object} orderData - Order data from server
 */
function addNewOrder(orderData) {
    // Clone template
    const template = document.getElementById('order-card-template');
    const clone = document.importNode(template.content, true);
    
    const orderCard = clone.querySelector('.order-card');
    
    // Set order data
    orderCard.dataset.orderId = orderData.id;
    orderCard.dataset.coffeeType = orderData.coffee_type;
    orderCard.dataset.phoneLastDigits = orderData.phone_last_digits;
    
    // Set priority class if VIP
    if (orderData.priority === 'vip') {
        orderCard.classList.add('priority-vip');
        
        // Add VIP badge
        const vipBadge = document.createElement('div');
        vipBadge.className = 'vip-badge';
        vipBadge.innerHTML = `<i class="bi bi-star-fill"></i> VIP${orderData.vip_id ? ` #${orderData.vip_id}` : ''}`;
        orderCard.appendChild(vipBadge);
    }
    
    // Fill in order details
    orderCard.querySelector('.order-number').textContent = `#${orderData.order_number}`;
    orderCard.querySelector('.coffee-name').textContent = orderData.coffee_type;
    orderCard.querySelector('.coffee-size').textContent = orderData.size;
    orderCard.querySelector('.milk-type').textContent = orderData.milk_type;
    orderCard.querySelector('.customer-name').textContent = orderData.customer_name;
    
    // Set temperature indicator
    const tempIndicator = orderCard.querySelector('.temperature-indicator');
    if (tempIndicator) {
        const waitingTime = orderData.waiting_time || 0;
        const promisedTime = orderData.promised_time || 10;
        const ratio = waitingTime / promisedTime;
        
        if (ratio < 0.5) {
            tempIndicator.classList.add('temp-cool');
        } else if (ratio < 0.9) {
            tempIndicator.classList.add('temp-warm');
        } else {
            tempIndicator.classList.add('temp-hot');
        }
    }
    
    // Set wait time
    const waitTimeElement = orderCard.querySelector('.wait-time');
    if (waitTimeElement) {
        waitTimeElement.textContent = `${orderData.wait_time || 10} min`;
    }
    
    const sugarEl = orderCard.querySelector('.sugar-amount');
    if (sugarEl) {
        if (orderData.sugar > 0) {
            sugarEl.textContent = `${orderData.sugar} sugar`;
            sugarEl.style.display = 'inline-block';
        } else {
            sugarEl.style.display = 'none';
        }
    }
    
    // Special instructions
    const specialEl = orderCard.querySelector('.special-instructions');
    if (specialEl) {
        if (orderData.special_instructions) {
            specialEl.textContent = orderData.special_instructions;
            specialEl.style.display = 'block';
        } else {
            specialEl.style.display = 'none';
        }
    }
    
    // Set timestamp
    const timestampEl = orderCard.querySelector('.order-time');
    if (timestampEl) {
        timestampEl.textContent = 'Just now';
        timestampEl.dataset.timestamp = new Date().toISOString();
    }
    
    // Add recipe button
    const recipeBtn = orderCard.querySelector('.recipe-btn');
    if (recipeBtn) {
        recipeBtn.dataset.coffeeType = orderData.coffee_type;
    }
    
    // Add to pending orders list
    const pendingList = document.querySelector('.pending-orders .orders-list');
    pendingList.prepend(orderCard);
    
    // Initialize the card
    initOrderCard(orderCard);
    
    // Update counts
    updateCountBadges();
    
    // Check for similar orders
    highlightSimilarOrders();
    
    // Apply entrance animation
    orderCard.classList.add('order-card-enter');
    setTimeout(() => {
        orderCard.classList.remove('order-card-enter');
    }, 500);
}

/**
 * Update an existing order in the UI
 * @param {Object} orderData - Updated order data
 */
function updateOrder(orderData) {
    const orderCard = document.querySelector(`.order-card[data-order-id="${orderData.id}"]`);
    
    if (!orderCard) {
        // Order not in UI, add it
        addNewOrder(orderData);
        return;
    }
    
    // Update status if changed
    if (orderData.status) {
        updateOrderUI(orderData.id, orderData.status);
    }
    
    // Update details if needed
    if (orderData.coffee_type) {
        orderCard.querySelector('.coffee-name').textContent = orderData.coffee_type;
        orderCard.dataset.coffeeType = orderData.coffee_type;
        
        const recipeBtn = orderCard.querySelector('.recipe-btn');
        if (recipeBtn) {
            recipeBtn.dataset.coffeeType = orderData.coffee_type;
        }
    }
    
    if (orderData.size) {
        orderCard.querySelector('.coffee-size').textContent = orderData.size;
    }
    
    if (orderData.milk_type) {
        orderCard.querySelector('.milk-type').textContent = orderData.milk_type;
    }
    
    if (orderData.customer_name) {
        orderCard.querySelector('.customer-name').textContent = orderData.customer_name;
    }
    
    if (orderData.phone_last_digits) {
        orderCard.dataset.phoneLastDigits = orderData.phone_last_digits;
    }
    
    if (orderData.hasOwnProperty('sugar')) {
        const sugarEl = orderCard.querySelector('.sugar-amount');
        if (sugarEl) {
            if (orderData.sugar > 0) {
                sugarEl.textContent = `${orderData.sugar} sugar`;
                sugarEl.style.display = 'inline-block';
            } else {
                sugarEl.style.display = 'none';
            }
        }
    }
    
    if (orderData.hasOwnProperty('special_instructions')) {
        const specialEl = orderCard.querySelector('.special-instructions');
        if (specialEl) {
            if (orderData.special_instructions) {
                specialEl.textContent = orderData.special_instructions;
                specialEl.style.display = 'block';
            } else {
                specialEl.style.display = 'none';
            }
        }
    }
    
    if (orderData.hasOwnProperty('wait_time')) {
        const waitTimeElement = orderCard.querySelector('.wait-time');
        if (waitTimeElement) {
            waitTimeElement.textContent = `${orderData.wait_time} min`;
        }
    }
    
    // Update temperature indicator if waiting time changed
    if (orderData.hasOwnProperty('waiting_time') && orderData.hasOwnProperty('promised_time')) {
        const tempIndicator = orderCard.querySelector('.temperature-indicator');
        if (tempIndicator) {
            // Remove existing classes
            tempIndicator.classList.remove('temp-cool', 'temp-warm', 'temp-hot');
            
            const ratio = orderData.waiting_time / orderData.promised_time;
            
            if (ratio < 0.5) {
                tempIndicator.classList.add('temp-cool');
            } else if (ratio < 0.9) {
                tempIndicator.classList.add('temp-warm');
            } else {
                tempIndicator.classList.add('temp-hot');
            }
        }
    }
    
    // Check for similar orders
    highlightSimilarOrders();
}

/**
 * Update order UI based on new status
 * @param {string} orderId - The order ID
 * @param {string} status - The new status
 */
function updateOrderUI(orderId, status) {
    const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
    
    if (!orderCard) {
        return;
    }
    
    // Determine target container
    let targetContainer;
    
    switch (status) {
        case 'pending':
            targetContainer = document.querySelector('.pending-orders .orders-list');
            break;
        case 'in_progress':
            targetContainer = document.querySelector('.in-progress-orders .orders-list');
            break;
        case 'completed':
            targetContainer = document.querySelector('.completed-orders .orders-list');
            break;
        case 'picked_up':
            // For picked up, we'll fade out and remove
            orderCard.classList.add('order-card-exit');
            setTimeout(() => {
                orderCard.remove();
                updateCountBadges();
            }, 500);
            return;
        default:
            return;
    }
    
    if (!targetContainer) {
        return;
    }
    
    const currentContainer = orderCard.parentElement;
    
    // If not already in the right container
    if (currentContainer !== targetContainer) {
        // Clone and move to new container
        const clone = orderCard.cloneNode(true);
        targetContainer.prepend(clone);
        
        // Apply animation
        clone.classList.add('order-card-enter');
        setTimeout(() => {
            clone.classList.remove('order-card-enter');
        }, 500);
        
        // Apply exit animation to original
        orderCard.classList.add('order-card-exit');
        setTimeout(() => {
            orderCard.remove();
        }, 500);
        
        // Initialize the new card
        initOrderCard(clone);
    }
    
    // Update counts
    updateCountBadges();
    
    // Update timers if needed
    if (status === 'in_progress') {
        const newCard = targetContainer.querySelector(`.order-card[data-order-id="${orderId}"]`);
        if (newCard) {
            initOrderTimer(newCard);
        }
    } else if (status === 'completed') {
        const newCard = targetContainer.querySelector(`.order-card[data-order-id="${orderId}"]`);
        if (newCard) {
            initPickupTimer(newCard);
        }
    }
    
    // Check for similar orders
    highlightSimilarOrders();
}

/**
 * Initialize timer for an in-progress order
 * @param {HTMLElement} orderCard - The order card element
 */
function initOrderTimer(orderCard) {
    // Set start time if not already set
    const timerEl = orderCard.querySelector('.order-timer');
    if (timerEl && !timerEl.dataset.startTime) {
        timerEl.dataset.startTime = new Date().toISOString();
        updateOrderTimer(orderCard);
    }
}

/**
 * Initialize pickup timer for a completed order
 * @param {HTMLElement} orderCard - The order card element
 */
function initPickupTimer(orderCard) {
    // Set completion time if not already set
    const timerEl = orderCard.querySelector('.pickup-timer');
    if (timerEl && !timerEl.dataset.completeTime) {
        timerEl.dataset.completeTime = new Date().toISOString();
        updatePickupTimer(orderCard);
    }
}

/**
 * Update in-progress timer display
 * @param {HTMLElement} orderCard - The order card element
 */
function updateOrderTimer(orderCard) {
    const timerEl = orderCard.querySelector('.order-timer');
    if (!timerEl || !timerEl.dataset.startTime) {
        return;
    }
    
    const startTime = new Date(timerEl.dataset.startTime);
    const now = new Date();
    const elapsed = Math.floor((now - startTime) / 1000 / 60); // minutes
    
    timerEl.textContent = `${elapsed}m`;
    
    // Update progress bar if exists
    const progressBar = orderCard.querySelector('.progress-bar');
    if (progressBar) {
        // Assume average completion time is 5 minutes
        const progress = Math.min(elapsed / 5 * 100, 100);
        progressBar.style.width = `${progress}%`;
        
        // Change color based on time
        if (elapsed > 8) {
            progressBar.classList.remove('bg-success', 'bg-warning');
            progressBar.classList.add('bg-danger');
        } else if (elapsed > 5) {
            progressBar.classList.remove('bg-success', 'bg-danger');
            progressBar.classList.add('bg-warning');
        } else {
            progressBar.classList.remove('bg-warning', 'bg-danger');
            progressBar.classList.add('bg-success');
        }
    }
}

/**
 * Update pickup timer display
 * @param {HTMLElement} orderCard - The order card element
 */
function updatePickupTimer(orderCard) {
    const timerEl = orderCard.querySelector('.pickup-timer');
    if (!timerEl || !timerEl.dataset.completeTime) {
        return;
    }
    
    const completeTime = new Date(timerEl.dataset.completeTime);
    const now = new Date();
    const elapsed = Math.floor((now - completeTime) / 1000 / 60); // minutes
    
    timerEl.textContent = `${elapsed}m`;
    
    // Update UI based on waiting time
    if (elapsed > 15) {
        // Order has been waiting a long time
        orderCard.classList.add('long-wait');
        
        // Enable reminder button if exists and not already reminded
        const reminderBtn = orderCard.querySelector('.btn-send-reminder');
        if (reminderBtn && !orderCard.classList.contains('reminder-sent')) {
            reminderBtn.disabled = false;
        }
    }
}

/**
 * Update all order timers
 */
function updateOrderTimers() {
    const inProgressCards = document.querySelectorAll('.in-progress-orders .order-card');
    inProgressCards.forEach(updateOrderTimer);
}

/**
 * Update all pickup timers
 */
function updatePickupTimers() {
    const completedCards = document.querySelectorAll('.completed-orders .order-card');
    completedCards.forEach(updatePickupTimer);
}

/**
 * Update count badges for each order section
 */
function updateCountBadges() {
    // Update pending count
    const pendingCards = document.querySelectorAll('.pending-orders .order-card');
    const pendingBadge = document.querySelector('.pending-count');
    if (pendingBadge) {
        pendingBadge.textContent = pendingCards.length;
        
        // Update color based on count
        if (pendingCards.length > 10) {
            pendingBadge.classList.remove('bg-primary', 'bg-warning');
            pendingBadge.classList.add('bg-danger');
        } else if (pendingCards.length > 5) {
            pendingBadge.classList.remove('bg-primary', 'bg-danger');
            pendingBadge.classList.add('bg-warning');
        } else {
            pendingBadge.classList.remove('bg-warning', 'bg-danger');
            pendingBadge.classList.add('bg-primary');
        }
    }
    
    // Update in-progress count
    const inProgressCards = document.querySelectorAll('.in-progress-orders .order-card');
    const inProgressBadge = document.querySelector('.in-progress-count');
    if (inProgressBadge) {
        inProgressBadge.textContent = inProgressCards.length;
    }
    
    // Update completed count
    const completedCards = document.querySelectorAll('.completed-orders .order-card');
    const completedBadge = document.querySelector('.completed-count');
    if (completedBadge) {
        completedBadge.textContent = completedCards.length;
    }
    
    // Update pre-orders count if exists
    const preOrderCards = document.querySelectorAll('.pre-orders .order-card');
    const preOrderBadge = document.querySelector('.pre-orders-count');
    if (preOrderBadge && preOrderCards.length) {
        preOrderBadge.textContent = preOrderCards.length;
    }
    
    // Update wait time
    updateWaitTime();
}

/**
 * Update the estimated wait time based on order queue
 */
function updateWaitTime() {
    const pendingCount = document.querySelectorAll('.pending-orders .order-card').length;
    const inProgressCount = document.querySelectorAll('.in-progress-orders .order-card').length;
    
    // Rough estimate: 3 minutes per pending order, 2 minutes per in-progress
    let waitTime = (pendingCount * 3) + (inProgressCount * 2);
    
    // Cap at reasonable maximum
    waitTime = Math.min(waitTime, 30);
    
    // Minimum wait time of 5 minutes
    waitTime = Math.max(waitTime, 5);
    
    // Update wait time display
    const waitTimeEl = document.querySelector('.wait-time');
    if (waitTimeEl) {
        waitTimeEl.textContent = `${waitTime} min`;
    }
    
    // Update wait time in server (if changed)
    if (waitTimeEl && waitTimeEl.dataset.currentWait != waitTime) {
        waitTimeEl.dataset.currentWait = waitTime;
        
        // Update on server
        fetch(`/barista/stations/${currentStationId}/wait-time`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ wait_time: waitTime })
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                console.error('Failed to update wait time:', data.error);
            }
        })
        .catch(error => {
            console.error('Error updating wait time:', error);
        });
    }
}

/**
 * Highlight similar orders for batch processing
 */
function highlightSimilarOrders() {
    // Get all pending orders
    const pendingCards = document.querySelectorAll('.pending-orders .order-card');
    
    // Reset all batch classes
    pendingCards.forEach(card => {
        card.classList.remove('batch-order');
        card.removeAttribute('data-batch-id');
    });
    
    // Group by coffee type and milk type
    const groups = {};
    
    pendingCards.forEach(card => {
        const coffeeType = card.querySelector('.coffee-name').textContent;
        const milkType = card.querySelector('.milk-type').textContent;
        
        const key = `${coffeeType}|${milkType}`;
        
        if (!groups[key]) {
            groups[key] = {
                coffeeType: coffeeType,
                milkType: milkType,
                cards: []
            };
        }
        
        groups[key].cards.push(card);
    });
    
    // Assign batch classes for groups with more than 1 order
    const batchColors = ['#fff3cd', '#d1e7dd', '#cfe2ff', '#f8d7da'];
    let colorIndex = 0;
    
    for (const key in groups) {
        if (groups[key].cards.length > 1) {
            const batchId = `batch-${key.replace(/\s+/g, '-').toLowerCase()}`;
            const batchColor = batchColors[colorIndex % batchColors.length];
            
            groups[key].cards.forEach(card => {
                card.classList.add('batch-order');
                card.dataset.batchId = batchId;
                card.style.backgroundColor = batchColor;
            });
            
            // Create or update batch indicator
            const firstCard = groups[key].cards[0];
            const batchContainer = firstCard.closest('.orders-list');
            
            let batchGroup = batchContainer.querySelector(`.batch-group[data-batch-id="${batchId}"]`);
            
            if (!batchGroup) {
                batchGroup = document.createElement('div');
                batchGroup.className = 'batch-group';
                batchGroup.dataset.batchId = batchId;
                batchGroup.dataset.coffeeType = groups[key].coffeeType;
                batchGroup.dataset.milkType = groups[key].milkType;
                batchContainer.appendChild(batchGroup);
            }
            
            colorIndex++;
        }
    }
    
    // Show or hide batch button
    const batchBtn = document.getElementById('batch-orders-btn');
    if (batchBtn) {
        const hasBatches = document.querySelectorAll('.batch-group').length > 0;
        batchBtn.style.display = hasBatches ? 'block' : 'none';
    }
}

/**
 * Update connection status indicator
 * @param {boolean} connected - Whether the websocket is connected
 */
function updateConnectionStatus(connected) {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status-text');
    
    if (statusIndicator) {
        if (connected) {
            statusIndicator.classList.remove('offline');
            statusIndicator.classList.add('online');
        } else {
            statusIndicator.classList.remove('online');
            statusIndicator.classList.add('offline');
        }
    }
    
    if (statusText) {
        statusText.textContent = connected ? 'Online' : 'Offline';
    }
    
    // If disconnected, attempt to reconnect
    if (!connected && socket) {
        setTimeout(function() {
            if (!socket.connected) {
                console.log('Attempting to reconnect WebSocket...');
                socket.connect();
            }
        }, 3000);
    }
}

/**
 * Show notification toast
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} type - Notification type (success, error, warning, info)
 */
function showNotification(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast notification-toast notification-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    toast.innerHTML = `
        <div class="toast-header">
            <strong class="me-auto">${title}</strong>
            <small>${new Date().toLocaleTimeString()}</small>
            <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
            ${message}
        </div>
    `;
    
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer) {
        toastContainer.appendChild(toast);
        
        // Initialize Bootstrap toast
        const bsToast = new bootstrap.Toast(toast, {
            autohide: true,
            delay: 5000
        });
        bsToast.show();
        
        // Auto-remove after hiding
        toast.addEventListener('hidden.bs.toast', function() {
            toast.remove();
        });
    }
}

/**
 * Play a sound effect
 * @param {string} soundName - Name of the sound to play
 */
function playSound(soundName) {
    if (!orderSounds[soundName]) {
        return;
    }
    
    // Stop and reset if already playing
    orderSounds[soundName].pause();
    orderSounds[soundName].currentTime = 0;
    
    // Play the sound
    orderSounds[soundName].play().catch(e => {
        console.error('Error playing sound:', e);
    });
}

/**
 * Update performance metrics display
 * @param {Object} metrics - Performance metrics data
 */
function updatePerformanceMetrics(metrics) {
    // Update simple metrics in header
    document.getElementById('orders-completed').textContent = metrics.orders_completed;
    document.getElementById('avg-prep-time').textContent = metrics.avg_preparation_time + 'm';
    document.getElementById('efficiency').textContent = metrics.efficiency + '%';
    document.getElementById('perfection-rate').textContent = metrics.perfection_rate + '%';
    
    // Update hourly load heatmap if in performance modal
    const heatmap = document.getElementById('hourly-heatmap');
    if (heatmap && metrics.hourly_load) {
        let heatmapHtml = '';
        
        metrics.hourly_load.forEach(hour => {
            const loadClass = hour.load < 40 ? 'light-load' : 
                              hour.load < 70 ? 'medium-load' : 'heavy-load';
            
            heatmapHtml += `
                <div class="hour-block">
                    <div class="hour-label">${hour.hour}</div>
                    <div class="hour-bar ${loadClass}" style="height: ${hour.load}%">
                        <div class="hour-value">${hour.count}</div>
                    </div>
                </div>
            `;
        });
        
        heatmap.innerHTML = heatmapHtml;
    }
}

/**
 * Update chat messages display
 * @param {Array} messages - Chat messages array
 */
function updateChatMessages(messages) {
    const chatContainer = document.querySelector('.chat-messages');
    if (!chatContainer) return;
    
    // Clear existing messages
    chatContainer.innerHTML = '';
    
    // Add each message
    messages.forEach(message => {
        addChatMessage(message, false);
    });
    
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Add a single chat message to the display
 * @param {Object} message - Message data
 * @param {boolean} scroll - Whether to scroll to the message
 */
function addChatMessage(message, scroll = true) {
    const chatContainer = document.querySelector('.chat-messages');
    if (!chatContainer) return;
    
    const isCurrentBarista = message.sender.includes(currentBarista.name);
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isCurrentBarista ? 'own-message' : ''}`;
    
    // Format timestamp
    const timestamp = new Date(message.created_at);
    const formattedTime = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageEl.innerHTML = `
        <div class="message-header">
            <span class="message-sender">${message.sender}</span>
            <span class="message-time">${formattedTime}</span>
        </div>
        <div class="message-content ${message.is_urgent ? 'urgent-message' : ''}">
            ${message.content}
        </div>
    `;
    
    chatContainer.appendChild(messageEl);
    
    // Scroll if needed
    if (scroll) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

/**
 * Update chat badge count
 */
function updateChatBadge() {
    const chatBadge = document.querySelector('#station-chat-btn .badge');
    if (!chatBadge) return;
    
    // Get current count
    let count = parseInt(chatBadge.textContent) || 0;
    count += 1;
    
    // Update badge
    chatBadge.textContent = count;
    chatBadge.style.display = count > 0 ? 'inline-flex' : 'none';
}

/**
 * Update handover notes display
 * @param {Array} notes - Handover notes array
 */
function updateHandoverNotes(notes) {
    const notesContainer = document.querySelector('.handover-notes');
    if (!notesContainer) return;
    
    // Clear existing notes
    notesContainer.innerHTML = '';
    
    // Add each note
    notes.forEach(note => {
        addHandoverNote(note, false);
    });
}

/**
 * Add a single handover note to the display
 * @param {Object} note - Note data
 * @param {boolean} prepend - Whether to prepend to the list
 */
function addHandoverNote(note, prepend = true) {
    const notesContainer = document.querySelector('.handover-notes');
    if (!notesContainer) return;
    
    const noteEl = document.createElement('div');
    noteEl.className = 'handover-note';
    
    noteEl.innerHTML = `
        <div class="note-header">
            <span class="note-author">${note.author}</span>
            <span class="note-time">${note.time_ago}</span>
        </div>
        <div class="note-content">
            ${note.content}
        </div>
    `;
    
    if (prepend) {
        notesContainer.prepend(noteEl);
    } else {
        notesContainer.appendChild(noteEl);
    }
}

/**
 * Update handover badge count
 */
function updateHandoverBadge() {
    const handoverBadge = document.querySelector('#handover-notes-btn .badge');
    if (!handoverBadge) return;
    
    // Get current count
    let count = parseInt(handoverBadge.textContent) || 0;
    count += 1;
    
    // Update badge
    handoverBadge.textContent = count;
    handoverBadge.style.display = count > 0 ? 'inline-flex' : 'none';
}

/**
 * Show stock alert
 * @param {Array} warnings - Stock warnings data
 */
function showStockAlert(warnings) {
    if (!warnings || warnings.length === 0) return;
    
    // Create alert element
    const alertEl = document.createElement('div');
    alertEl.className = 'stock-alert';
    
    // Find critical items
    const criticalItems = warnings.filter(item => item.status === 'critical');
    const lowItems = warnings.filter(item => item.status !== 'critical');
    
    // Build alert HTML
    let alertHtml = '';
    
    if (criticalItems.length > 0) {
        alertHtml += `
            <div class="alert-header critical">
                <i class="bi bi-exclamation-triangle-fill"></i>
                Critical Stock Alert
            </div>
            <div class="alert-body">
                <p>The following items are critically low:</p>
                <ul>
        `;
        
        criticalItems.forEach(item => {
            alertHtml += `<li><strong>${item.name}:</strong> ${item.current_quantity}${item.unit} remaining (${item.depletion_text})</li>`;
        });
        
        alertHtml += `
                </ul>
                <button class="btn btn-danger request-stock-btn">Request Supplies Now</button>
            </div>
        `;
    } else if (lowItems.length > 0) {
        alertHtml += `
            <div class="alert-header warning">
                <i class="bi bi-exclamation-circle-fill"></i>
                Stock Warning
            </div>
            <div class="alert-body">
                <p>The following items are running low:</p>
                <ul>
        `;
        
        lowItems.forEach(item => {
            alertHtml += `<li><strong>${item.name}:</strong> ${item.current_quantity}${item.unit} remaining (${item.depletion_text})</li>`;
        });
        
        alertHtml += `
                </ul>
                <button class="btn btn-warning request-stock-btn">Request Supplies</button>
            </div>
        `;
    }
    
    alertEl.innerHTML = alertHtml;
    
    // Add to container
    const alertContainer = document.getElementById('alerts-container');
    if (alertContainer) {
        alertContainer.appendChild(alertEl);
        
        // Add dismiss button
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'alert-dismiss';
        dismissBtn.innerHTML = '<i class="bi bi-x"></i>';
        dismissBtn.addEventListener('click', function() {
            alertEl.remove();
        });
        alertEl.appendChild(dismissBtn);
        
        // Add request button handler
        const requestBtn = alertEl.querySelector('.request-stock-btn');
        if (requestBtn) {
            requestBtn.addEventListener('click', function() {
                showStockModal();
                alertEl.remove();
            });
        }
        
        // Auto-dismiss after 60 seconds if not critical
        if (criticalItems.length === 0) {
            setTimeout(() => {
                if (alertEl.parentNode) {
                    alertEl.remove();
                }
            }, 60000);
        }
    }
}

/**
 * Update smart preparation recommendations
 * @param {Array} recommendations - Preparation recommendations
 */
function updateSmartPreparationRecommendations(recommendations) {
    const smartPrepContainer = document.getElementById('smart-preparation');
    if (!smartPrepContainer) return;
    
    // Clear existing recommendations
    smartPrepContainer.innerHTML = '';
    
    // If no recommendations, hide container
    if (!recommendations || recommendations.length === 0) {
        smartPrepContainer.style.display = 'none';
        return;
    }
    
    // Show container
    smartPrepContainer.style.display = 'block';
    
    // Add each recommendation
    recommendations.forEach(rec => {
        const recEl = document.createElement('div');
        recEl.className = `smart-preparation-item priority-${rec.priority}`;
        recEl.dataset.id = rec.id || '';
        recEl.dataset.type = rec.type;
        
        recEl.innerHTML = `
            <div class="prep-icon">
                ${rec.type === 'batch' ? '<i class="bi bi-cup-hot-fill"></i>' : 
                  rec.type === 'pre_order' ? '<i class="bi bi-clock-fill"></i>' : 
                  '<i class="bi bi-lightning-fill"></i>'}
            </div>
            <div class="prep-content">
                <div class="prep-title">${rec.description}</div>
                <div class="prep-details">${rec.details}</div>
            </div>
            <div class="prep-action">
                <button class="btn smart-prep-btn btn-${rec.priority}" data-type="${rec.type}" data-id="${rec.id || ''}">
                    ${rec.type === 'batch' ? 'Start Batch' : 
                      rec.type === 'pre_order' ? 'Prepare Pre-order' : 
                      'Prepare'}
                </button>
            </div>
        `;
        
        smartPrepContainer.appendChild(recEl);
    });
}

/**
 * Show batch recommendation
 * @param {Object} recommendation - Batch recommendation data
 */
function showBatchRecommendation(recommendation) {
    // Update smart preparation container
    updateSmartPreparationRecommendations([recommendation]);
    
    // Show notification
    showNotification(
        'Batch Opportunity', 
        'Similar orders detected that could be prepared together',
        'info'
    );
}

/*************************
 * Helper Functions
 *************************/

/**
 * Get CSRF token from cookie
 * @returns {string} The CSRF token
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

/**
 * Get status name from container element
 * @param {HTMLElement} container - The container element
 * @returns {string|null} The status name or null if not found
 */
function getStatusFromContainer(container) {
    if (container.closest('.pending-orders')) {
        return 'pending';
    } else if (container.closest('.in-progress-orders')) {
        return 'in_progress';
    } else if (container.closest('.completed-orders')) {
        return 'completed';
    }
    return null;
}

/**
 * Filter orders by text
 * @param {string} searchText - Text to search for
 */
function searchOrders(searchText) {
    const orderCards = document.querySelectorAll('.order-card');
    
    if (!searchText.trim()) {
        // Show all
        orderCards.forEach(card => {
            card.style.display = '';
        });
        return;
    }
    
    const searchLower = searchText.toLowerCase();
    
    orderCards.forEach(card => {
        const orderNum = card.querySelector('.order-number').textContent;
        const coffeeName = card.querySelector('.coffee-name').textContent;
        const customerName = card.querySelector('.customer-name').textContent;
        const milkType = card.querySelector('.milk-type').textContent;
        const phoneLastDigits = card.dataset.phoneLastDigits || '';
        
        const match = 
            orderNum.toLowerCase().includes(searchLower) ||
            coffeeName.toLowerCase().includes(searchLower) ||
            customerName.toLowerCase().includes(searchLower) ||
            milkType.toLowerCase().includes(searchLower) ||
            phoneLastDigits.includes(searchLower);
        
        card.style.display = match ? '' : 'none';
    });
}

/**
 * Filter orders by criteria
 * @param {string} filter - Filter criteria
 */
function filterOrders(filter) {
    const orderCards = document.querySelectorAll('.order-card');
    
    orderCards.forEach(card => {
        let show = true;
        
        switch (filter) {
            case 'vip':
                show = card.classList.contains('priority-vip');
                break;
            case 'batch':
                show = card.classList.contains('batch-order');
                break;
            case 'urgent':
                show = card.querySelector('.temp-hot') !== null;
                break;
            default:
                show = true;
        }
        
        card.style.display = show ? '' : 'none';
    });
}

/**
 * Sort orders by criteria
 * @param {string} sort - Sort criteria
 */
function sortOrders(sort) {
    const pendingList = document.querySelector('.pending-orders .orders-list');
    const inProgressList = document.querySelector('.in-progress-orders .orders-list');
    
    const sortOrderCards = (container, sortType) => {
        if (!container) return;
        
        const cards = Array.from(container.querySelectorAll('.order-card'));
        
        cards.sort((a, b) => {
            switch (sortType) {
                case 'time':
                    // Sort by wait time (oldest first)
                    const aTime = new Date(a.querySelector('.order-time').dataset.timestamp);
                    const bTime = new Date(b.querySelector('.order-time').dataset.timestamp);
                    return aTime - bTime;
                case 'time-desc':
                    // Sort by wait time (newest first)
                    const aTimeDesc = new Date(a.querySelector('.order-time').dataset.timestamp);
                    const bTimeDesc = new Date(b.querySelector('.order-time').dataset.timestamp);
                    return bTimeDesc - aTimeDesc;
                case 'name':
                    // Sort by customer name
                    const aName = a.querySelector('.customer-name').textContent;
                    const bName = b.querySelector('.customer-name').textContent;
                    return aName.localeCompare(bName);
                case 'type':
                    // Sort by coffee type
                    const aType = a.querySelector('.coffee-name').textContent;
                    const bType = b.querySelector('.coffee-name').textContent;
                    return aType.localeCompare(bType);
                case 'priority':
                    // Sort by priority (VIP first)
                    const aVip = a.classList.contains('priority-vip');
                    const bVip = b.classList.contains('priority-vip');
                    return bVip - aVip; // true (1) comes before false (0)
                case 'order-number':
                    // Sort by order number
                    const aNum = parseInt(a.querySelector('.order-number').textContent.replace('#', ''));
                    const bNum = parseInt(b.querySelector('.order-number').textContent.replace('#', ''));
                    return aNum - bNum;
                default:
                    return 0;
            }
        });
        
        // Re-append in sorted order
        cards.forEach(card => {
            container.appendChild(card);
        });
    };
    
    // Apply sort to pending and in-progress lists
    sortOrderCards(pendingList, sort);
    sortOrderCards(inProgressList, sort);
}

/**
 * Update estimated wait times for all orders
 */
function updateWaitTimes() {
    // Get current station wait time
    const waitTimeEl = document.querySelector('.wait-time');
    const currentWaitTime = waitTimeEl ? parseInt(waitTimeEl.textContent) : 10;
    
    // Update pending orders with current wait time
    const pendingCards = document.querySelectorAll('.pending-orders .order-card');
    pendingCards.forEach(card => {
        const waitTimeEl = card.querySelector('.wait-time');
        if (waitTimeEl) {
            waitTimeEl.textContent = `${currentWaitTime} min`;
        }
    });
}

/**
 * Format relative time (e.g., "5 minutes ago")
 * @param {Date|string} date - The date to format
 * @returns {string} Formatted relative time
 */
function formatRelativeTime(date) {
    if (typeof date === 'string') {
        date = new Date(date);
    }
    
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    
    if (diffSec < 60) {
        return 'Just now';
    } else if (diffMin < 60) {
        return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffHour < 24) {
        return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`;
    } else {
        return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
    }
}

/**
 * Start QR code scanner
 */
function startQrScanner() {
    // Create scanner container if it doesn't exist
    let scannerContainer = document.getElementById('qr-scanner-container');
    
    if (!scannerContainer) {
        scannerContainer = document.createElement('div');
        scannerContainer.id = 'qr-scanner-container';
        scannerContainer.className = 'qr-scanner-overlay';
        
        scannerContainer.innerHTML = `
            <div class="scanner-content">
                <h3>Scan Order QR Code</h3>
                <div id="qr-scanner-viewport"></div>
                <p class="text-center mt-3">Position the QR code within the frame</p>
                <button id="close-scanner-btn" class="btn btn-secondary">Cancel</button>
            </div>
        `;
        
        document.body.appendChild(scannerContainer);
        
        // Add close button handler
        document.getElementById('close-scanner-btn').addEventListener('click', function() {
            stopQrScanner();
        });
    } else {
        scannerContainer.style.display = 'flex';
    }
    
    // Initialize scanner with camera
    try {
        const scanner = new Html5QrcodeScanner(
            "qr-scanner-viewport",
            { fps: 10, qrbox: { width: 250, height: 250 } }
        );
        
        scanner.render((decodedText) => {
            // QR code detected - process it
            console.log("QR Code detected:", decodedText);
            
            // Handle order number or ID format
            if (decodedText.startsWith("order:")) {
                const orderId = decodedText.substring(6);
                processScannedOrderId(orderId);
            } else {
                // Try to parse as order number
                try {
                    const orderData = JSON.parse(decodedText);
                    if (orderData.orderId) {
                        processScannedOrderId(orderData.orderId);
                    }
                } catch (e) {
                    // Show invalid QR code notification
                    showNotification('Invalid QR Code', 'The scanned code is not a valid order code', 'warning');
                }
            }
            
            // Stop scanner after processing
            stopQrScanner();
        });
        
        // Save scanner instance for cleanup
        window.currentQrScanner = scanner;
    } catch (error) {
        console.error('Error initializing QR scanner:', error);
        showNotification('Scanner Error', 'Could not access camera or initialize scanner', 'error');
    }
}

/**
 * Stop QR code scanner
 */
function stopQrScanner() {
    const scannerContainer = document.getElementById('qr-scanner-container');
    if (scannerContainer) {
        scannerContainer.style.display = 'none';
    }
    
    // Clear scanner instance
    if (window.currentQrScanner) {
        window.currentQrScanner.clear();
        window.currentQrScanner = null;
    }
}

/**
 * Process scanned order ID from QR code
 * @param {string} orderId - The scanned order ID
 */
function processScannedOrderId(orderId) {
    // Look for existing order card
    const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
    
    if (orderCard) {
        // Highlight the order card
        orderCard.classList.add('highlight-pulse');
        setTimeout(() => {
            orderCard.classList.remove('highlight-pulse');
        }, 2000);
        
        // Show notification
        showNotification('Order Found', `Found order #${orderId}`, 'success');
        
        // If order is completed, offer to mark as picked up
        if (orderCard.closest('.completed-orders')) {
            if (confirm('Mark this order as picked up?')) {
                markOrderPickedUp(orderId);
            }
        }
    } else {
        // Fetch order details from server
        fetch(`/barista/orders/${orderId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Show order details
                    showOrderDetails(orderId, data.order);
                    
                    showNotification('Order Found', `Found order #${data.order.order_number}`, 'success');
                } else {
                    showNotification('Order Not Found', `No order found with ID ${orderId}`, 'warning');
                }
            })
            .catch(error => {
                console.error('Error fetching order details:', error);
                showNotification('Error', 'Failed to fetch order details', 'error');
            });
    }
}

/**
 * Show order details modal
 * @param {string} orderId - The order ID
 * @param {Object} orderData - Optional order data to display
 */
function showOrderDetails(orderId, orderData = null) {
    // If no order data provided, get it from the card or fetch from server
    if (!orderData) {
        const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
        
        if (orderCard) {
            // Get data from card
            orderData = {
                id: orderId,
                order_number: orderCard.querySelector('.order-number').textContent.replace('#', ''),
                coffee_type: orderCard.querySelector('.coffee-name').textContent,
                size: orderCard.querySelector('.coffee-size').textContent,
                milk_type: orderCard.querySelector('.milk-type').textContent,
                customer_name: orderCard.querySelector('.customer-name').textContent,
                created_at: orderCard.querySelector('.order-time').dataset.timestamp,
                status: getStatusFromContainer(orderCard)
            };
            
            // Show details modal with data from card
            populateOrderDetailsModal(orderData, orderCard);
        } else {
            // Fetch from server
            fetch(`/barista/orders/${orderId}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        populateOrderDetailsModal(data.order);
                    } else {
                        showNotification('Error', data.error || 'Failed to load order details', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error fetching order details:', error);
                    showNotification('Error', 'Failed to load order details', 'error');
                });
        }
    } else {
        // Use provided data
        populateOrderDetailsModal(orderData);
    }
}

/**
 * Populate order details modal with order data
 * @param {Object} order - Order data
 * @param {HTMLElement} orderCard - Optional order card element
 */
function populateOrderDetailsModal(order, orderCard = null) {
    const modal = document.getElementById('order-details-modal');
    if (!modal) return;
    
    // Set order details
    modal.querySelector('.modal-title').textContent = `Order #${order.order_number}`;
    
    const detailsContainer = modal.querySelector('.order-details-content');
    detailsContainer.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <h5>Order Information</h5>
                <p><strong>Coffee:</strong> ${order.size} ${order.coffee_type}</p>
                <p><strong>Milk:</strong> ${order.milk_type || 'None'}</p>
                <p><strong>Sugar:</strong> ${order.sugar || '0'}</p>
                ${order.special_instructions ? `<p><strong>Special Instructions:</strong> ${order.special_instructions}</p>` : ''}
                <p><strong>Order Time:</strong> ${new Date(order.created_at).toLocaleTimeString()}</p>
                <p><strong>Status:</strong> <span class="badge bg-${getStatusBadgeColor(order.status)}">${formatStatus(order.status)}</span></p>
            </div>
            <div class="col-md-6">
                <h5>Customer Information</h5>
                <p><strong>Name:</strong> ${order.customer_name}</p>
                ${order.phone_number ? `<p><strong>Phone:</strong> xxx-xxx-${order.phone_number.substring(order.phone_number.length - 4)}</p>` : ''}
                ${order.loyalty_points ? `<p><strong>Loyalty Points:</strong> ${order.loyalty_points}</p>` : ''}
                ${order.is_vip ? `<p><strong>VIP Status:</strong> <span class="badge bg-warning text-dark">VIP Customer</span></p>` : ''}
            </div>
        </div>
        
        <div class="order-history mt-4">
            <h5>Order History</h5>
            <ul class="timeline">
                ${order.history ? order.history.map(item => `
                    <li>
                        <div class="timeline-time">${new Date(item.timestamp).toLocaleTimeString()}</div>
                        <div class="timeline-content">
                            <p>${item.action}</p>
                            ${item.notes ? `<p class="text-muted">${item.notes}</p>` : ''}
                        </div>
                    </li>
                `).join('') : `
                    <li>
                        <div class="timeline-time">${new Date(order.created_at).toLocaleTimeString()}</div>
                        <div class="timeline-content">
                            <p>Order created</p>
                        </div>
                    </li>
                `}
            </ul>
        </div>
    `;
    
    // Set action buttons based on current status
    const actionContainer = modal.querySelector('.modal-footer');
    actionContainer.innerHTML = '';
    
    // Add common buttons
    actionContainer.innerHTML += `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
    `;
    
    // Add status-specific buttons
    if (order.status === 'pending') {
        actionContainer.innerHTML += `
            <button type="button" class="btn btn-primary modal-start-btn">Start Order</button>
            <button type="button" class="btn btn-danger modal-cancel-btn">Cancel Order</button>
        `;
    } else if (order.status === 'in_progress') {
        actionContainer.innerHTML += `
            <button type="button" class="btn btn-success modal-complete-btn">Complete Order</button>
            <button type="button" class="btn btn-danger modal-cancel-btn">Cancel Order</button>
        `;
    } else if (order.status === 'completed') {
        actionContainer.innerHTML += `
            <button type="button" class="btn btn-info modal-pickup-btn">Mark as Picked Up</button>
            <button type="button" class="btn btn-warning modal-reminder-btn">Send Reminder</button>
        `;
    }
    
    // Add message button for all statuses except picked up
    if (order.status !== 'picked_up') {
        actionContainer.innerHTML += `
            <button type="button" class="btn btn-outline-primary modal-message-btn">Message Customer</button>
        `;
    }
    
    // Add event handlers to buttons
    const startBtn = actionContainer.querySelector('.modal-start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', function() {
            startOrder(order.id);
            bootstrap.Modal.getInstance(modal).hide();
        });
    }
    
    const completeBtn = actionContainer.querySelector('.modal-complete-btn');
    if (completeBtn) {
        completeBtn.addEventListener('click', function() {
            completeOrder(order.id);
            bootstrap.Modal.getInstance(modal).hide();
        });
    }
    
    const cancelBtn = actionContainer.querySelector('.modal-cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            bootstrap.Modal.getInstance(modal).hide();
            showCancelConfirmation(order.id);
        });
    }
    
    const pickupBtn = actionContainer.querySelector('.modal-pickup-btn');
    if (pickupBtn) {
        pickupBtn.addEventListener('click', function() {
            markOrderPickedUp(order.id);
            bootstrap.Modal.getInstance(modal).hide();
        });
    }
    
    const reminderBtn = actionContainer.querySelector('.modal-reminder-btn');
    if (reminderBtn) {
        reminderBtn.addEventListener('click', function() {
            sendPickupReminder(order.id);
            bootstrap.Modal.getInstance(modal).hide();
        });
    }
    
    const messageBtn = actionContainer.querySelector('.modal-message-btn');
    if (messageBtn) {
        messageBtn.addEventListener('click', function() {
            bootstrap.Modal.getInstance(modal).hide();
            showMessageDialog(order.id);
        });
    }
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Format order status for display
 * @param {string} status - The status string
 * @returns {string} Formatted status
 */
function formatStatus(status) {
    switch (status) {
        case 'pending':
            return 'Pending';
        case 'in_progress':
            return 'In Progress';
        case 'completed':
            return 'Completed';
        case 'picked_up':
            return 'Picked Up';
        case 'cancelled':
            return 'Cancelled';
        default:
            return status.charAt(0).toUpperCase() + status.slice(1);
    }
}

/**
 * Get badge color for order status
 * @param {string} status - The status string
 * @returns {string} Bootstrap color class
 */
function getStatusBadgeColor(status) {
    switch (status) {
        case 'pending':
            return 'secondary';
        case 'in_progress':
            return 'primary';
        case 'completed':
            return 'success';
        case 'picked_up':
            return 'info';
        case 'cancelled':
            return 'danger';
        default:
            return 'secondary';
    }
}

/**
 * Show dialog for adjusting wait time
 */
function showWaitTimeDialog() {
    const modal = document.getElementById('wait-time-modal');
    
    // Get current wait time
    const waitTimeEl = document.querySelector('.wait-time');
    const currentWaitTime = waitTimeEl ? parseInt(waitTimeEl.textContent) : 10;
    
    // Set current value in form
    const waitTimeInput = modal.querySelector('#wait-time-input');
    waitTimeInput.value = currentWaitTime;
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    // Add submit handler
    const form = modal.querySelector('form');
    form.onsubmit = function(e) {
        e.preventDefault();
        
        const newWaitTime = parseInt(waitTimeInput.value);
        if (isNaN(newWaitTime) || newWaitTime < 1) {
            showNotification('Invalid Value', 'Please enter a valid wait time in minutes', 'warning');
            return;
        }
        
        // Update wait time on server
        fetch(`/barista/stations/${currentStationId}/wait-time`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ wait_time: newWaitTime })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update displayed wait time
                if (waitTimeEl) {
                    waitTimeEl.textContent = `${newWaitTime} min`;
                    waitTimeEl.dataset.currentWait = newWaitTime;
                }
                
                // Update wait times for pending orders
                updateWaitTimes();
                
                // Hide modal
                bootstrap.Modal.getInstance(modal).hide();
                
                // Show confirmation
                showNotification('Wait Time Updated', `Wait time updated to ${newWaitTime} minutes`, 'success');
            } else {
                showNotification('Error', data.error || 'Failed to update wait time', 'error');
            }
        })
        .catch(error => {
            console.error('Error updating wait time:', error);
            showNotification('Error', 'Failed to update wait time. Please try again.', 'error');
        });
    };
}

/**
 * Show modal for creating a new order
 */
function showNewOrderDialog() {
    const modal = document.getElementById('new-order-modal');
    
    // Clear form
    const form = modal.querySelector('form');
    form.reset();
    
    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Submit a new order
 */
function submitNewOrder() {
    const form = document.getElementById('new-order-form');
    
    // Get form data
    const coffeeType = form.querySelector('#new-order-coffee-type').value;
    const size = form.querySelector('#new-order-size').value;
    const milkType = form.querySelector('#new-order-milk').value;
    const sugar = parseInt(form.querySelector('#new-order-sugar').value);
    const customerName = form.querySelector('#new-order-customer-name').value;
    const phoneNumber = form.querySelector('#new-order-phone').value;
    const specialInstructions = form.querySelector('#new-order-instructions').value;
    
    // Validate required fields
    if (!coffeeType || !size || !customerName) {
        showNotification('Missing Information', 'Please fill in all required fields', 'warning');
        return;
    }
    
    // Submit to server
    fetch('/barista/orders/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify({
            coffee_type: coffeeType,
            size: size,
            milk_type: milkType,
            sugar: sugar,
            customer_name: customerName,
            phone_number: phoneNumber,
            special_instructions: specialInstructions,
            station_id: currentStationId,
            barista_id: currentBarista.id
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Hide modal
            const modal = document.getElementById('new-order-modal');
            bootstrap.Modal.getInstance(modal).hide();
            
            // Add new order to UI
            addNewOrder(data.order);
            
            // Show confirmation
            showNotification('Order Created', `New order #${data.order.order_number} created successfully`, 'success');
        } else {
            showNotification('Error', data.error || 'Failed to create order', 'error');
        }
    })
    .catch(error => {
        console.error('Error creating order:', error);
        showNotification('Error', 'Failed to create order. Please try again.', 'error');
    });
}

function updateCurrentTime() {
    // Find the current time element safely
    const currentTimeElement = document.getElementById('current-time');
    
    // Only update if the element exists
    if (currentTimeElement) {
        const now = new Date();
        
        // Format hours and minutes with leading zeros
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        
        // Update the element's text content
        currentTimeElement.textContent = `${hours}:${minutes}`;
    } else {
        // Optional: log a warning if the element is not found
        console.warn('Current time element not found. Make sure #current-time exists in the HTML.');
    }
}

// Add time update to initialization
document.addEventListener('DOMContentLoaded', function() {
    // Initial time update
    updateCurrentTime();
    
    // Update time every minute
    setInterval(updateCurrentTime, 60000);
});

// Initialize the application when document is ready
// (This is added for completeness, but should not be required if called at the beginning of the file)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Barista interface initialized');
    });
} else {
    console.log('Barista interface initialized (document already loaded)');
}
