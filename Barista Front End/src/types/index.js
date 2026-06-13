// types/index.js
//
// JSDoc type definitions for the core shapes used across the app.
// JS-with-JSDoc lets the IDE and `tsc --checkJs` validate without
// the full TypeScript migration.
//
// HOW TO USE
// ----------
// At the top of any file that takes/returns these shapes:
//
//   /**
//    * @typedef {import('.').Order} Order
//    */
//
// Then on functions:
//
//   /**
//    * @param {Order} order
//    * @returns {boolean}
//    */
//   function isVip(order) { ... }
//
// IDE (VS Code, WebStorm) will autocomplete fields, flag wrong
// property names, warn about missing required fields, etc. No
// runtime cost, no build step changes.
//
// WHY THESE SHAPES
// ----------------
// Picked the ones consumed in the most call sites:
//   - Order:        useOrders / OrderDataService / barista UI cards / dialogs
//   - Station:      useStations / station selector / capability check
//   - CatalogItem:  useCatalog / Quick Setup / Inventory editor
//   - User:         useAuth / user mgmt / role gates
//
// Each shape lists the canonical field names (the camelCase ones
// the React side prefers — see backend mirror in OrderDataService
// for the snake_case → camelCase translation map).

// =============================================================
// Order
// =============================================================
/**
 * Canonical order shape returned by the orders endpoints and
 * consumed by the React UI.
 *
 * Status uses the ORDER_STATUS constant — see
 * constants/orderStatus.js for the canonical values + helpers.
 *
 * @typedef {Object} Order
 * @property {string|number} id              Stable identifier (server-assigned)
 * @property {string} orderNumber            Short customer-visible number ('27')
 * @property {string} status                 'pending'|'in-progress'|'completed'|'picked_up'|'cancelled'
 * @property {string} customerName           Customer's first name
 * @property {string} [phoneNumber]          Phone (blank for walk-ins)
 * @property {string} coffeeType             'Flat White', 'Latte', etc.
 * @property {string} milkType               'Whole Milk', 'Oat Milk', etc.
 * @property {string} [sugar]                Free-text sugar description
 * @property {number} [waitTime]             Minutes since order created
 * @property {number} [promisedTime]         Minutes target completion
 * @property {boolean} [vip]                 VIP / priority flag
 * @property {boolean} [priority]            Alias for vip on walk-in path
 * @property {number} [shots]                Espresso shots (1, 2, ...)
 * @property {boolean} [extraHot]
 * @property {boolean} [alternativeMilk]
 * @property {boolean} [dairyFree]
 * @property {string} [batchGroup]           Batch identifier for grouped orders
 * @property {string} [notes]
 * @property {number} [stationId]            Station this order is routed to
 * @property {string} [createdAt]            ISO timestamp
 * @property {string} [completedAt]          ISO timestamp
 * @property {string} [pickedUpAt]           ISO timestamp
 * @property {number} [price]                Honor-system price (numeric)
 * @property {string} [priceFormatted]       'AU$4.50' or 'VIP — no charge'
 */

// =============================================================
// Station
// =============================================================
/**
 * @typedef {Object} StationCapabilities
 * @property {string[]} [milk_types]          Tokens like 'full cream', 'oat'
 * @property {string[]} [coffee_types]        Tokens like 'latte', 'cappuccino'
 * @property {string[]} [sizes]               Tokens like 'small', 'medium'
 * @property {boolean}  [alt_milk]            Whether alt milks are stocked at all
 */

/**
 * @typedef {Object} Station
 * @property {number} id
 * @property {string} name                    'Coffee Station One'
 * @property {string} [location]              Free text ('North East', 'Foyer')
 * @property {'active'|'inactive'|'maintenance'} status
 * @property {string} [baristaName]           Currently-staffed barista
 * @property {number} [waitTime]              Estimated wait minutes for this station
 * @property {number} [currentLoad]           Number of orders in flight
 * @property {number} [maxConcurrentOrders]
 * @property {StationCapabilities} [capabilities]
 */

// =============================================================
// CatalogItem
// =============================================================
/**
 * @typedef {Object} CatalogProperties
 * @property {boolean} [dairyFree]
 * @property {boolean} [lactoseFree]
 * @property {boolean} [vegan]
 * @property {boolean} [lowFat]
 * @property {string[]} [synonyms]           Alternative names that match this item
 * @property {number} [ml]                   Size: volume in millilitres
 */

/**
 * @typedef {'milk'|'drink'|'size'|'sweetener'} CatalogCategory
 */

/**
 * @typedef {Object} CatalogItem
 * @property {string} id                     Canonical machine-readable id ('full_cream')
 * @property {string} name                   Display name ('Full Cream Milk')
 * @property {string} [short_name]           Compact token for capabilities ('full cream')
 * @property {string} [subcategory]          For drinks: 'espresso'|'tea'|'other';
 *                                           for milks: 'standard'|'alternative'
 * @property {CatalogProperties} [properties]
 * @property {number} [sort_order]
 * @property {boolean} [is_active]
 * @property {boolean} [is_custom]           True = operator-added (not seeded)
 */

// =============================================================
// User
// =============================================================
/**
 * @typedef {'admin'|'staff'|'organizer'|'barista'|'support'|'customer'} UserRole
 */

/**
 * @typedef {Object} User
 * @property {number|string} id
 * @property {string} username
 * @property {string} email
 * @property {UserRole} role
 * @property {string} [fullName]             Display name (frontend reads this)
 * @property {string} [full_name]            DB column (backend returns this)
 * @property {string} [createdAt]            ISO timestamp
 * @property {string} [lastLogin]            ISO timestamp
 */

// =============================================================
// WalkinDefaults
// =============================================================
/**
 * Per-event defaults loaded by useWalkinDefaults. See backend
 * DEFAULT_WALKIN_DEFAULTS in consolidated_api_routes.py.
 *
 * @typedef {Object} WalkinDefaults
 * @property {string} default_coffee_type
 * @property {string} default_size
 * @property {string} default_shots
 * @property {string[]} default_milk_preference_order
 * @property {number} default_sweetener_qty
 */

// =============================================================
// Health (from /api/health/full)
// =============================================================
/**
 * @typedef {'ok'|'warn'|'fail'|'unknown'} HealthStatus
 */

/**
 * @typedef {Object} HealthCheck
 * @property {HealthStatus} status
 * @property {string} [detail]
 */

/**
 * @typedef {Object} HealthReport
 * @property {HealthStatus} status            Worst of all checks
 * @property {string} timestamp
 * @property {string} service
 * @property {string} version
 * @property {Object.<string, HealthCheck>} checks
 */

// =============================================================
// Re-export so callers can also do `import T from '.'`
// (gives them a single value to namespace types under if they want).
// =============================================================
export default {};
