const { Pool } = require('pg');
const EventEmitter = require('events');
const config = require('../config/testConfig');

class DatabaseMonitor extends EventEmitter {
  constructor() {
    super();
    this.pool = new Pool(config.database);
    this.queries = [];
    this.monitoringActive = false;
  }

  async start() {
    try {
      await this.pool.connect();
      this.monitoringActive = true;
      console.log('Database monitoring started');
      
      // Monitor database activity
      this.monitorInterval = setInterval(() => {
        this.checkDatabaseActivity();
      }, 1000);
    } catch (error) {
      console.error('Failed to start database monitoring:', error);
      throw error;
    }
  }

  async stop() {
    this.monitoringActive = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    await this.pool.end();
    console.log('Database monitoring stopped');
  }

  async checkDatabaseActivity() {
    try {
      // Get recent database activity
      const result = await this.pool.query(`
        SELECT 
          pid,
          usename,
          application_name,
          client_addr,
          query_start,
          state,
          query
        FROM pg_stat_activity
        WHERE state = 'active'
        AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY query_start DESC
        LIMIT 10
      `);

      if (result.rows.length > 0) {
        this.emit('activity', result.rows);
      }
    } catch (error) {
      console.error('Error checking database activity:', error);
    }
  }

  async executeQuery(query, params = []) {
    const startTime = Date.now();
    let result, error;

    try {
      result = await this.pool.query(query, params);
    } catch (e) {
      error = e;
    }

    const endTime = Date.now();
    const queryLog = {
      query,
      params,
      timestamp: new Date(),
      duration: endTime - startTime,
      rowCount: result ? result.rowCount : 0,
      error: error ? error.message : null,
      success: !error
    };

    this.queries.push(queryLog);
    this.emit('query', queryLog);

    if (error) throw error;
    return result;
  }

  async getTableData(tableName) {
    try {
      const result = await this.executeQuery(`SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT 100`);
      return result.rows;
    } catch (error) {
      console.error(`Error fetching data from ${tableName}:`, error);
      return [];
    }
  }

  async verifyDataSaved(tableName, conditions) {
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(conditions)) {
      whereClause += ` AND ${key} = $${paramIndex}`;
      params.push(value);
      paramIndex++;
    }

    const query = `SELECT COUNT(*) as count FROM ${tableName} ${whereClause}`;
    const result = await this.executeQuery(query, params);
    return parseInt(result.rows[0].count) > 0;
  }

  async getOrderStatus(orderId) {
    const result = await this.executeQuery(
      'SELECT status, updated_at FROM orders WHERE id = $1',
      [orderId]
    );
    return result.rows[0];
  }

  async getInventoryLevels() {
    const result = await this.executeQuery(`
      SELECT item_name, current_stock, min_stock, max_stock
      FROM inventory
      ORDER BY item_name
    `);
    return result.rows;
  }

  getQueryHistory() {
    return this.queries;
  }

  clearQueryHistory() {
    this.queries = [];
  }
}

module.exports = DatabaseMonitor;