# Settings kept in one browser (roadmap X7-13, 18 Nov 2026)

Older screens saved settings in the browser (localStorage). A setting kept
there reaches no other tablet and never reaches the server. This is every
key the running app writes: the screens loaded from `src/index.js`, about
200 files. Each key is either backed by the server or is a per-device
preference by design.

## Fixed

| Key | Screen | What was wrong | Now |
|---|---|---|---|
| `station_locks` | Runner > Schedule > Stations (lock, Lock all, Unlock all, Quiet period, Emergency override) | The lock existed only in that browser. The server kept sending orders to a "locked" station, and no other screen saw the lock. | Locking sets the station's status to `maintenance` on the server, the same as the barista's own pause. Order routing only uses `active`/`open` stations. The lock state is read back from the server. |

## Server-backed (the browser copy is only a fast first-paint cache)

| Key | Server source |
|---|---|
| `coffee_cue_routing_rules` | `GET/PUT /api/routing-rules` (server wins on load) |
| `event_sessions`, `session_statuses` | `/api/settings/event-sessions` |
| `station_inventory_configs`, `station_inventory_quantities`, `stationInventoryConfig`, `event_inventory` | inventory endpoints; refreshed from the server on load |
| `stationDefaults` | station defaults API |
| `coffee_cue_settings` | `SettingsService` (local only in demo mode) |
| `coffee_system_branding` | `/api/settings/branding` |
| `coffee_cue_stations` | `/api/stations` |
| `station_broadcasts` | also POSTed to `/api/stations/broadcast` |

## Per-device on purpose

| Key | Why it belongs to the device |
|---|---|
| `coffee_cue_selected_station`, `last_used_station_id`, `currentStationId`, `coffee_cue_watched_stations` | which cart this tablet is |
| `coffee_barista_zoom`, `coffee_cue_active_tab`, `coffee_cue_queue_sort`, `coffee_cue_ready_sort`, `coffee_display_sound` | screen preferences for this tablet |
| `coffee_auto_refresh_enabled`, `coffee_auto_refresh_interval` | this screen's refresh |
| `coffee_group_orders` | unsent group-order drafts on this device (sending puts them on the server; the delete dialog says "removed from this device") |
| `coffee_cue_balancing_settings` | the Balance tab's suggestion rules. They only act while that tab is open on that tablet, and moves go through `/api/orders/<id>/reassign`. |
| `messageServiceSettings`, `messageHistory`, `coffee_chat_messages` | this device's message view |
| tokens, `user`, `refreshToken`, `tokenExpiry`, `app_version`, `html_etag`, `html_last_modified`, `coffee_connection_status`, `auth_error_*`, `fallback_*`, `*_backup`, `sync_queue`, `use_fallback_data`, `coffee_cue_app_mode`, `demo_mode_enabled`, `coffee_system_errors`, `logout_message`, `quick_setup_last_applied`, `coffee_cue_hidden_demo_items`, `coffee_system_config` | login, caches, offline copies and diagnostics |

How the list was made: follow the imports from `src/index.js`, then collect
every `localStorage.setItem` key in the files reached, and check each
screen's save path for a server call.
