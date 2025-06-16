const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Only use proxy in development - production serves from same domain
  if (process.env.NODE_ENV === 'development') {
    app.use(
      '/api',
      createProxyMiddleware({
        target: process.env.REACT_APP_API_URL || 'http://localhost:5001',
        changeOrigin: true,
        logLevel: 'debug'
      })
    );
  }
};