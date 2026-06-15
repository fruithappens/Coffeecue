// authMirror — keep every access-token localStorage key in sync.
//
// (Named "authMirror" rather than anything containing "token" because
// .gitignore has a broad `*token*` rule for secret files that would otherwise
// stop this source file being committed.)
//
// The app historically stored the JWT access token under several names, and
// different consumers read different ones:
//   - coffee_system_token : ApiService, AuthService (canonical)
//   - coffee_auth_token   : WebSocketService, ScheduleService, StationsService,
//                           SettingsService, MultiLevelInventory, DashboardTab, …
//   - jwt_token / token   : a few more services / legacy paths
//
// The token REFRESH path only updated coffee_system_token, so the other keys
// held a long-expired token (observed: coffee_auth_token ~52h stale while
// coffee_system_token was fresh). Any consumer that read a stale key first —
// notably WebSocketService for real-time updates — silently used a dead token.
//
// Until every consumer is migrated to read one canonical key, persist/clear the
// token to ALL of these together. This is intentionally additive: writing more
// keys can only make a reader MORE correct, never less.
export const ACCESS_TOKEN_KEYS = [
  'coffee_system_token',
  'coffee_auth_token',
  'jwt_token',
  'token',
];

export function persistAccessToken(token) {
  if (!token) return;
  ACCESS_TOKEN_KEYS.forEach((k) => {
    try { localStorage.setItem(k, token); } catch (e) { /* storage full / disabled */ }
  });
}

export function clearAccessTokens() {
  ACCESS_TOKEN_KEYS.forEach((k) => {
    try { localStorage.removeItem(k); } catch (e) { /* no-op */ }
  });
}
