// Read / partially update the branding blob (branding_settings) WITHOUT
// going through SettingsService.updateBrandingSettings, which caches
// whatever it is given as the whole blob in localStorage. A tab that owns
// three fields (Sponsors: the thank-you line; Labels: the sticker logo)
// sends just those; the server merges (PUT /settings/branding is
// merge=True) and mirrors the sponsor fields to the SMS keys itself.

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

export async function fetchBranding() {
  const r = await fetch('/api/settings/branding', { headers: authHeaders() });
  if (!r.ok) return {};
  const b = await r.json();
  return (b && b.settings) || {};
}

// Returns true on success. Fields not included are left as they are.
export async function patchBranding(fields) {
  try {
    const r = await fetch('/api/settings/branding', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ settings: fields }),
    });
    if (!r.ok) return false;
    const b = await r.json().catch(() => ({}));
    return b.success !== false;
  } catch (e) {
    return false;
  }
}
