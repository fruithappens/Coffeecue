# Expresso System Architecture Guide

## Table of Contents
1. [System Overview](#system-overview)
2. [Data Flow Architecture](#data-flow-architecture)
3. [Component Relationships](#component-relationships)
4. [Inventory Management Flow](#inventory-management-flow)
5. [Key Concepts & Glossary](#key-concepts--glossary)
6. [Implementation Details](#implementation-details)

---

## System Overview

Expresso is a multi-interface coffee ordering system with four main user interfaces:

1. **Landing Page** - Entry point for all users
2. **Barista Interface** - Order processing and station management
3. **Organiser Interface** - Event configuration and management
4. **Support Interface** - System monitoring and diagnostics

### Core Architecture Principles
- **Data flows from Organiser → Stations → Barista**
- **Inventory is configured at Event level, then filtered per Station**
- **All interfaces share common data through hooks and services**

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ORGANISER INTERFACE                        │
├─────────────────────────────────────────────────────────────────┤
│  Stations Tab                                                     │
│  ├── Event Inventory    ──────► Defines ALL possible items       │
│  ├── Station Settings   ──────► Creates/configures stations      │
│  └── Station Inventory  ──────► Assigns items to stations        │
└─────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INVENTORY INTEGRATION SERVICE                  │
├─────────────────────────────────────────────────────────────────┤
│  Bridges Organiser inventory with Barista stock system          │
│  - Converts inventory items to stock format                      │
│  - Filters by station assignments                                │
│  - Manages color coding for milk types                           │
└─────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BARISTA INTERFACE                          │
├─────────────────────────────────────────────────────────────────┤
│  Stock Tab                                                        │
│  ├── Milk       ──────► Only shows assigned milk types          │
│  ├── Coffee     ──────► Only shows assigned coffee types        │
│  ├── Cups       ──────► Shows cups with ml & shot config        │
│  ├── Syrups     ──────► Only shows assigned syrups              │
│  └── Other      ──────► Sweeteners, extras, etc.                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Relationships

### 1. Inventory Management Hierarchy

```
Organiser Interface
    └── InventoryManagement.js
        ├── Creates master inventory categories:
        │   ├── Milk & Dairy
        │   ├── Coffee Types  
        │   ├── Cups & Sizes (with ml & shots)
        │   ├── Syrups & Flavors
        │   ├── Sugars & Sweeteners
        │   └── Extras & Add-ons
        │
        └── Saved to: localStorage['event_inventory']

    └── StationInventoryConfig.js
        ├── Assigns inventory items to specific stations
        └── Saved to: localStorage['station_inventory_config']

Barista Interface
    └── BaristaInterface.js
        └── Stock Tab
            └── useStock() hook
                └── Gets filtered inventory for current station
```

### 2. Station Configuration Flow

```
Organiser → StationSettings.js
    ├── Create/Edit/Delete stations
    ├── Set station capabilities
    └── Configure station properties

        ↓ via StationsService

Backend → stations table
    └── Station data persisted

        ↓ via API

Barista → useStations() hook
    └── Station selector dropdown
        └── Shows only active stations
```

### 3. Order Processing Flow

```
Customer → SMS/QR → Backend → Orders Queue

Barista Interface
    ├── Pending Orders (useOrders hook)
    ├── Claim Order → In Progress
    ├── Complete Order → Ready for Pickup
    └── Mark Collected → Order History
```

---

## Inventory Management Flow

### Step 1: Event Setup (Organiser)

In **Organiser → Stations → Event Inventory**:
```javascript
// Example inventory item structure
{
  id: "milk_1",
  name: "Oat Milk",
  description: "Plant-based oat milk",
  category: "milk",
  enabled: true
}

// Cup items include additional fields
{
  id: "cups_1", 
  name: "Small (8oz)",
  description: "240ml cup",
  volume: 240,      // milliliters
  shots: 1,         // espresso shots
  category: "cups",
  enabled: true
}
```

### Step 2: Station Assignment (Organiser)

In **Organiser → Stations → Station Inventory**:
- Select a station
- Check/uncheck items that station can serve
- Configuration saved per station

### Step 3: Color Configuration (Organiser)

In **Organiser → Settings → Branding → Milk Colors**:
- Automatically shows all milk types from inventory
- Assign visual colors for quick identification
- Colors used throughout the system

### Step 4: Barista View (Barista Interface)

In **Barista → Stock Tab**:
- Only shows items assigned to current station
- Stock levels can be adjusted
- Visual indicators (colors) for milk types
- Real-time depletion as orders are made

---

## Key Concepts & Glossary

### Interfaces
- **Landing Page**: Main entry point, role selection
- **Barista Interface**: Order processing, stock management
- **Organiser Interface**: Event setup, configuration
- **Support Interface**: System monitoring, diagnostics

### Data Terms
- **Event Inventory**: Master list of ALL possible items
- **Station Inventory**: Subset of items assigned to a specific station
- **Stock**: Barista's view of available inventory with quantities
- **Station Capabilities**: What a station can make (stored but currently uses inventory assignments)

### Categories
- **Milk**: All dairy and non-dairy milk options
- **Coffee**: Drink types (espresso, latte, cappuccino, etc.)
- **Cups**: Sizes with volume (ml) and shot configuration
- **Syrups**: Flavor additions
- **Sweeteners**: Sugars and sugar alternatives
- **Extras**: Additional options (extra shot, whipped cream, etc.)

### Services & Hooks
- **InventoryIntegrationService**: Bridges organiser inventory with barista stock
- **useStock()**: Hook for barista stock management
- **useStations()**: Hook for station data and selection
- **useOrders()**: Hook for order management
- **useSettings()**: Hook for system settings

### Storage
- **localStorage['event_inventory']**: Master inventory data
- **localStorage['station_inventory_config']**: Station assignments
- **localStorage['coffee_system_branding']**: Branding/colors
- **Database**: Orders, stations, users, settings

---

## Implementation Details

### Adding a New Inventory Category

1. **Update InventoryManagement.js**:
```javascript
const categories = {
  // ... existing categories ...
  newCategory: {
    name: 'New Category Name',
    icon: <IconComponent size={20} />,
    color: 'purple',
    defaultItems: [],
    additionalFields: [
      { key: 'customField', label: 'Custom Field', type: 'text', required: true }
    ]
  }
}
```

2. **Update InventoryIntegrationService.js**:
```javascript
// Add mapping in convertToStockFormat()
case 'newCategory':
  return {
    ...baseStock,
    category: 'other', // or create new stock category
    unit: 'items'
  };
```

3. **Update useStock() hook** if needed for special handling

### Data Persistence

1. **Frontend Storage**:
   - Event Inventory: `localStorage['event_inventory']`
   - Station Config: `localStorage['station_inventory_config']`
   - Branding: `localStorage['coffee_system_branding']`

2. **Backend Storage**:
   - Orders: PostgreSQL `orders` table
   - Stations: PostgreSQL `stations` table
   - Settings: PostgreSQL `settings` table
   - Inventory: PostgreSQL `inventory` table

### Common Issues & Solutions

**Issue**: Items not showing in Barista stock
- **Check**: Is item enabled in Event Inventory?
- **Check**: Is item assigned to the station in Station Inventory?
- **Check**: Is InventoryIntegrationService running?

**Issue**: Milk colors not updating
- **Check**: Are milk types defined in Event Inventory?
- **Check**: Did you save in Branding settings?
- **Check**: Browser refresh may be needed

**Issue**: Station changes not reflecting
- **Solution**: Station switching saves current state and loads new station data
- **Check**: localStorage for cached data

---

## Future Enhancements

1. **Backend Persistence**: Move inventory from localStorage to database
2. **Real-time Sync**: WebSocket updates for inventory changes
3. **Advanced Analytics**: Track usage patterns per item
4. **Supplier Integration**: Auto-reorder when stock is low
5. **Recipe Management**: Define ingredient requirements per coffee type

---

*Last Updated: January 2025*