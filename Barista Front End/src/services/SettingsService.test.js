// SettingsService only holds an ApiService instance (never calls through it
// for branding) — mock it so the ApiService→AuthService→OrderDataService
// import cycle doesn't explode under Jest.
jest.mock('./ApiService', () => jest.fn().mockImplementation(() => ({})));

import SettingsService from './SettingsService';

// Guards for the branding save/load placebo class (found live 2026-07-20):
// Steve replaced the event logo + background, got a green "saved
// successfully", the form kept showing the new images after reload — but
// the Display screen kept the old branding. Three stacked causes:
//   1. updateBrandingSettings returned true even when the server PUT threw
//   2. getBrandingSettings read localStorage BEFORE the server
//   3. directFetch cached the boot-time JWT forever, so any save made
//      >15 min into a session went out with an expired token and 401'd
// These tests pin the honest behaviour for all three.

// jsdom ships a real, working localStorage — use it directly so the
// service under test and the test itself see the same store.
describe('SettingsService branding truthfulness', () => {
  beforeEach(() => {
    window.localStorage.clear();
    SettingsService.token = null;
    global.fetch = jest.fn();
  });

  describe('updateBrandingSettings', () => {
    it('returns true when the server confirms the save', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await SettingsService.updateBrandingSettings({ eventName: 'Treenet 26' });
      expect(result).toBe(true);
    });

    it('returns false when the server rejects the save (e.g. expired token 401)', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Token has expired' }),
      });

      const result = await SettingsService.updateBrandingSettings({ eventName: 'Treenet 26' });
      // The old behaviour returned true here "since we saved to
      // localStorage" — which showed a green success while the Display
      // kept the old branding. It must report the truth.
      expect(result).toBe(false);
    });

    it('returns false when the network request throws', async () => {
      global.fetch.mockRejectedValue(new Error('network down'));

      const result = await SettingsService.updateBrandingSettings({ eventName: 'Treenet 26' });
      expect(result).toBe(false);
    });
  });

  describe('getBrandingSettings', () => {
    it('prefers the server copy over a stale localStorage cache', async () => {
      // A failed save leaves the NEW branding in localStorage while the
      // server still has the OLD. The form must show the server's truth.
      localStorage.setItem(
        'coffee_system_branding',
        JSON.stringify({ eventName: 'Local-only never saved' })
      );
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, settings: { eventName: 'Server truth' } }),
      });

      const result = await SettingsService.getBrandingSettings();
      expect(result.eventName).toBe('Server truth');
    });

    it('falls back to the cache only when the server is unreachable', async () => {
      localStorage.setItem(
        'coffee_system_branding',
        JSON.stringify({ eventName: 'Cached copy' })
      );
      global.fetch.mockRejectedValue(new Error('offline'));

      const result = await SettingsService.getBrandingSettings();
      expect(result.eventName).toBe('Cached copy');
    });
  });

  describe('directFetch auth token freshness', () => {
    it('uses the CURRENT localStorage token, not the boot-time one', async () => {
      // Simulate a token refresh that happened after the service cached
      // its first token — the next request must carry the fresh token.
      SettingsService.token = 'stale-boot-token';
      localStorage.setItem('coffee_system_token', 'fresh-refreshed-token');
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await SettingsService.directFetch('/settings/branding', { method: 'GET' });

      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer fresh-refreshed-token');
    });
  });
});
