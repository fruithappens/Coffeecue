const { createProxyMiddleware } = require('http-proxy-middleware');

// Development proxy. The production build serves frontend and API from
// the same origin so this file only runs under `npm start`.
//
// Historical bug: `app.use('/api', proxy)` told http-proxy-middleware
// (v3) to strip the `/api` mount prefix from the path before
// forwarding — so POST /api/stations arrived at the backend as POST
// /stations, which only has a GET handler and replies with 405. GET
// worked by accident (there's a fallback GET /stations route too) but
// POST / PATCH / DELETE silently broke every "Add Station" / "Rename
// Station" / "Delete Station" click in the UI. Using the proxy's own
// `pathFilter` keeps the full path intact.
module.exports = function(app) {
  if (process.env.NODE_ENV === 'development') {
    app.use(
      createProxyMiddleware({
        target: process.env.REACT_APP_API_URL || 'http://localhost:5001',
        changeOrigin: true,
        pathFilter: '/api',
        logLevel: 'silent',
      })
    );
  }
};
