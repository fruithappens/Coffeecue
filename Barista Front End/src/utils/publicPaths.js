// publicPaths.js -- the pages anyone may open without logging in.
//
// One list for two jobs: App.js hides staff-only "not connected" warnings
// on them, and AuthService.logout() clears an expired login on them WITHOUT
// sending the person to the login page. Before this, an old staff login
// that had expired bounced cupq.app/start (and /my, /order) to /login with
// "Your session has expired", on a page that never needed a login.
export const PUBLIC_SCREEN_PATHS = [
  '/display', '/displays', '/order', '/my', '/track', '/sponsors', '/status', '/setup', '/start', '/privacy',
];

export function isPublicPath(path) {
  const p = path == null ? ((typeof window !== 'undefined' && window.location.pathname) || '') : path;
  return PUBLIC_SCREEN_PATHS.some((x) => p === x || p.startsWith(x + '/') || p.startsWith(x + '?'));
}
