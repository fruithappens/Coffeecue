// services/PrintService.js
import ApiService from './ApiService';

/**
 * Label printing client for the Star mC-Label3 (CloudPRNT) subsystem.
 *
 * Design rules (mirror the backend's):
 *  - Printing must NEVER block order flow — every call here resolves to a
 *    result object instead of throwing, so callers can fire-and-forget.
 *  - The per-station auto-print preference is a device-local choice
 *    (this iPad/laptop opts in), so it lives in localStorage, not the DB.
 */
class PrintService {
  constructor() {
    this.apiService = new ApiService();
    this.debugMode = false;
  }

  async _call(endpoint, method = 'GET', body = null) {
    try {
      // MockDataService fabricates {success:true} for unknown endpoints —
      // a demo-mode "print" would toast success with no label anywhere.
      // Be honest instead.
      if (this.apiService.isDemoMode && this.apiService.isDemoMode()) {
        return { success: false, message: 'Demo mode — printing is disabled', demo: true };
      }
      const options = { method };
      if (body !== null) options.body = JSON.stringify(body);
      const response = await this.apiService.request(`/print${endpoint}`, options);
      return response || { success: false, message: 'empty response' };
    } catch (error) {
      if (this.debugMode) console.warn(`PrintService ${method} ${endpoint} failed:`, error);
      return { success: false, message: error?.message || 'print service unreachable' };
    }
  }

  /** Queue a cup label. stationId targets that station's printer (the
   *  barista making the drink); omitted, the order's own station is used. */
  printLabel(orderId, stationId = null) {
    const body = { order_id: orderId };
    if (stationId) body.station_id = stationId;
    return this._call('/label', 'POST', body);
  }

  /** Re-queue the ORIGINAL label payload for an order (snapshot, not live data). */
  reprintLabel(orderId) {
    return this._call('/reprint', 'POST', { order_id: orderId });
  }

  /** Calibration/test label on a specific printer. */
  testPrint(printerId) {
    return this._call('/test', 'POST', { printer_id: printerId });
  }

  /** Sideways banner (roll signage): free text down the label roll.
      Stock width becomes the banner HEIGHT, length grows with the text. */
  printBanner(text, printerId) {
    return this._call('/banner', 'POST', { text, printer_id: printerId });
  }

  /** All registered printers with online/offline derived from last poll. */
  async getPrinters() {
    const r = await this._call('/printers');
    return Array.isArray(r?.printers) ? r.printers : [];
  }

  /** Last 20 jobs, optionally filtered by status/station. */
  async getJobs({ status, stationId } = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (stationId) params.set('station_id', stationId);
    const qs = params.toString();
    const r = await this._call(`/jobs${qs ? `?${qs}` : ''}`);
    return Array.isArray(r?.jobs) ? r.jobs : [];
  }

  updatePrinter(printerId, fields) {
    return this._call(`/printers/${printerId}`, 'PATCH', fields);
  }

  retryJob(jobId) {
    return this._call(`/jobs/${jobId}/retry`, 'POST', {});
  }

  cancelJob(jobId) {
    return this._call(`/jobs/${jobId}/cancel`, 'POST', {});
  }

  /** The enabled printer assigned to a station, if any. */
  findStationPrinter(printers, stationId) {
    if (!stationId) return null;
    return (printers || []).find(
      p => p.enabled && String(p.station_id) === String(stationId)
    ) || null;
  }

  // --- per-station auto-print preference (device-local) -------------------

  _autoPrintKey(stationId) {
    return `coffee_cue_auto_print_station_${stationId}`;
  }

  isAutoPrintEnabled(stationId) {
    if (!stationId) return false;
    return localStorage.getItem(this._autoPrintKey(stationId)) === 'true';
  }

  setAutoPrint(stationId, enabled) {
    if (!stationId) return;
    localStorage.setItem(this._autoPrintKey(stationId), enabled ? 'true' : 'false');
  }
}

// Singleton, matching the other core services.
const printService = new PrintService();
export default printService;
