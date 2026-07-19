/// <reference types="cypress" />

// End-to-end tests for the Barista Interface workflow

describe('Barista Interface Workflow', () => {
  // Test data for creating orders
  const testOrder = {
    name: 'Test Customer',
    type: 'Cappuccino',
    milk: 'Oat milk',
    size: 'Regular',
    sugar: '1 sugar',
    notes: 'Cypress test order'
  };

  // Helper function to login
  const login = () => {
    cy.visit('/login');
    cy.get('input[name="username"]').type('barista');
    cy.get('input[name="password"]').type('barista123');
    cy.get('button[type="submit"]').click();
    
    // Verify we're logged in and redirected to the barista interface
    cy.url().should('include', '/barista');
  };

  // Helper function to create a test order
  const createTestOrder = () => {
    // Call the API directly to create a test order
    return cy.request({
      method: 'POST',
      url: '/api/debug/create-test-order',
      body: testOrder
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('order_number');
      return response.body.order_number;
    });
  };

  beforeEach(() => {
    // Clear localStorage before each test
    cy.clearLocalStorage();
    
    // Intercept API requests to add assertions or manipulate responses
    cy.intercept('GET', '/api/orders/pending').as('getPendingOrders');
    cy.intercept('GET', '/api/orders/in-progress').as('getInProgressOrders');
    cy.intercept('GET', '/api/orders/completed').as('getCompletedOrders');
    cy.intercept('POST', '/api/orders/*/start').as('startOrder');
    cy.intercept('POST', '/api/orders/*/complete').as('completeOrder');
    cy.intercept('POST', '/api/orders/batch').as('batchProcessOrders');
  });

  it('should load the barista interface after login', () => {
    login();
    
    // Check that main interface components are loaded
    cy.get('[data-testid="pending-orders-section"]').should('be.visible');
    cy.get('[data-testid="in-progress-orders-section"]').should('be.visible');
    cy.get('[data-testid="completed-orders-section"]').should('be.visible');
  });

  it('should display pending orders', () => {
    // Create a test order first
    createTestOrder().then((orderNumber) => {
      login();
      
      // Wait for pending orders to load
      cy.wait('@getPendingOrders');
      
      // Find our created order in the pending section
      cy.get('[data-testid="pending-orders-section"]')
        .contains(orderNumber)
        .should('be.visible');
    });
  });

  it('should start an order and move it to in-progress', () => {
    // Create a test order first
    createTestOrder().then((orderNumber) => {
      login();
      
      // Wait for pending orders to load
      cy.wait('@getPendingOrders');
      
      // Find our created order and click the start button
      cy.get('[data-testid="pending-orders-section"]')
        .contains(orderNumber)
        .parent()
        .find('button:contains("Start")')
        .click();
        
      // Wait for the start order API call
      cy.wait('@startOrder').its('response.statusCode').should('eq', 200);
      
      // Wait for the page to refresh orders
      cy.wait('@getInProgressOrders');
      
      // Verify the order is now in the in-progress section
      cy.get('[data-testid="in-progress-orders-section"]')
        .contains(orderNumber)
        .should('be.visible');
    });
  });

  it('should complete an order and move it to completed', () => {
    // Create a test order first
    createTestOrder().then((orderNumber) => {
      // Directly call the API to start the order
      cy.request({
        method: 'POST',
        url: `/api/orders/${orderNumber}/start`
      }).then((response) => {
        expect(response.status).to.eq(200);
      });
      
      login();
      
      // Wait for in-progress orders to load
      cy.wait('@getInProgressOrders');
      
      // Find our order in the in-progress section and click complete
      cy.get('[data-testid="in-progress-orders-section"]')
        .contains(orderNumber)
        .parent()
        .find('button:contains("Complete")')
        .click();
        
      // Wait for the complete order API call
      cy.wait('@completeOrder').its('response.statusCode').should('eq', 200);
      
      // Wait for the completed orders to refresh
      cy.wait('@getCompletedOrders');
      
      // Verify the order is now in the completed section
      cy.get('[data-testid="completed-orders-section"]')
        .contains(orderNumber)
        .should('be.visible');
    });
  });

  it('should batch process multiple orders', () => {
    // Create 3 test orders
    const createOrders = [
      createTestOrder(),
      createTestOrder(),
      createTestOrder()
    ];
    
    // Wait for all orders to be created
    cy.wrap(Promise.all(createOrders)).then((orderNumbers) => {
      login();
      
      // Wait for pending orders to load
      cy.wait('@getPendingOrders');
      
      // Check all orders in the batch
      orderNumbers.forEach(orderNumber => {
        cy.get('[data-testid="pending-orders-section"]')
          .contains(orderNumber)
          .parent()
          .find('input[type="checkbox"]')
          .check();
      });
      
      // Click the "Start Selected" button
      cy.get('button:contains("Start Selected")').click();
      
      // Wait for the batch API call
      cy.wait('@batchProcessOrders').its('response.statusCode').should('eq', 200);
      
      // Wait for the in-progress orders to refresh
      cy.wait('@getInProgressOrders');
      
      // Verify all orders are now in the in-progress section
      orderNumbers.forEach(orderNumber => {
        cy.get('[data-testid="in-progress-orders-section"]')
          .contains(orderNumber)
          .should('be.visible');
      });
    });
  });

  it('should handle network errors gracefully with offline fallback', () => {
    // Create a test order first
    createTestOrder().then((orderNumber) => {
      login();
      
      // Wait for orders to load
      cy.wait('@getPendingOrders');
      
      // Verify the order is visible
      cy.get('[data-testid="pending-orders-section"]')
        .contains(orderNumber)
        .should('be.visible');
      
      // Simulate network failure for subsequent API calls
      cy.intercept('GET', '/api/orders/pending', {
        statusCode: 500,
        body: { error: 'Simulated server error' }
      }).as('failedPendingOrdersRequest');
      
      // Trigger a refresh
      cy.get('button:contains("Refresh")').click();
      
      // Wait for the failed request
      cy.wait('@failedPendingOrdersRequest');
      
      // Verify the order is still visible (from localStorage fallback)
      cy.get('[data-testid="pending-orders-section"]')
        .contains(orderNumber)
        .should('be.visible');
      
      // Verify an offline notification is shown
      cy.get('[data-testid="offline-notification"]').should('be.visible');
    });
  });

  it('should filter orders by type and search term', () => {
    // Create orders with different types
    const cappuccinoOrder = {
      ...testOrder,
      type: 'Cappuccino',
      name: 'Cappuccino Customer'
    };
    
    const latteOrder = {
      ...testOrder,
      type: 'Latte',
      name: 'Latte Customer'
    };
    
    // Create the orders
    cy.request({
      method: 'POST',
      url: '/api/debug/create-test-order',
      body: cappuccinoOrder
    });
    
    cy.request({
      method: 'POST',
      url: '/api/debug/create-test-order',
      body: latteOrder
    });
    
    login();
    
    // Wait for pending orders to load
    cy.wait('@getPendingOrders');
    
    // Filter by coffee type (Cappuccino)
    cy.get('select[data-testid="filter-type"]').select('Cappuccino');
    
    // Verify only the Cappuccino order is visible
    cy.get('[data-testid="pending-orders-section"]')
      .contains('Cappuccino Customer')
      .should('be.visible');
    
    cy.get('[data-testid="pending-orders-section"]')
      .contains('Latte Customer')
      .should('not.exist');
    
    // Clear filter
    cy.get('select[data-testid="filter-type"]').select('All');
    
    // Search by customer name
    cy.get('input[data-testid="search-input"]').type('Latte');
    
    // Verify only the Latte order is visible
    cy.get('[data-testid="pending-orders-section"]')
      .contains('Latte Customer')
      .should('be.visible');
    
    cy.get('[data-testid="pending-orders-section"]')
      .contains('Cappuccino Customer')
      .should('not.exist');
  });

  it('should handle milk type indicators correctly', () => {
    // Create an order with specific milk type
    const soyMilkOrder = {
      ...testOrder,
      milk: 'Soy milk',
      name: 'Soy Milk Customer'
    };
    
    // Create the order
    cy.request({
      method: 'POST',
      url: '/api/debug/create-test-order',
      body: soyMilkOrder
    }).then((response) => {
      const orderNumber = response.body.order_number;
      
      // Start the order
      cy.request({
        method: 'POST',
        url: `/api/orders/${orderNumber}/start`
      });
      
      login();
      
      // Wait for in-progress orders to load
      cy.wait('@getInProgressOrders');
      
      // Find the order and verify the soy milk indicator
      cy.get('[data-testid="in-progress-orders-section"]')
        .contains(orderNumber)
        .parent()
        .find('[data-testid="milk-indicator"]')
        .should('have.class', 'soy');
    });
  });
});