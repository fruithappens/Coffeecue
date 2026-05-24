# Inventory Data Flow Issue - Diagnosis and Fix

## Problem Summary

The Expresso coffee system has a broken inventory data hierarchy where:

1. **Barista interface is missing stock/coffee inventory** - No milk/coffee options available
2. **Coffee inventory is missing from organiser** - Event inventory not set up
3. **Event stock/station inventory is incomplete** - Station assignments missing
4. **Syrups, sweeteners, drinks are missing** - Categories not populated
5. **The hierarchy "Organiser → Stations → Event Inventory → Event Stock → Station Stock → Menu Items" is broken**

## Root Cause Analysis

### Expected Data Flow
```
Organiser Interface
    ↓ (Sets up inventory)
Event Inventory (localStorage: event_inventory)
    ↓ (Assigns to stations)
Station Configurations (localStorage: station_inventory_configs)
    ↓ (Sets quantities)
Station Quantities (localStorage: station_inventory_quantities)
    ↓ (InventoryIntegrationService.syncInventoryToStations())
Barista Stock Data (localStorage: coffee_stock_station_X)
    ↓ (StockService.getAvailableMilkTypes())
Barista Interface & Walk-in Orders
```

### Missing Components Found

1. **`event_inventory`** - Contains categories (milk, coffee, syrups, sweeteners, etc.) with items
2. **`station_inventory_configs`** - Maps which inventory items are available at each station
3. **`station_inventory_quantities`** - Specifies quantities of each item at each station
4. **`coffee_stock_station_1/2/3`** - Final barista stock data that the interface consumes

## Solution Implementation

### 1. Data Structure Setup

The fix involves creating the complete localStorage data structure:

#### Event Inventory (`event_inventory`)
```javascript
{
  milk: [
    { id: 'milk_1', name: 'Whole Milk', description: '...', enabled: true, category: 'milk' },
    { id: 'milk_2', name: 'Oat Milk', description: '...', enabled: true, category: 'milk' },
    // ... more milk types
  ],
  coffee: [
    { id: 'coffee_1', name: 'Espresso', description: '...', enabled: true, category: 'coffee' },
    { id: 'coffee_2', name: 'Latte', description: '...', enabled: true, category: 'coffee' },
    // ... more coffee types
  ],
  syrups: [...],
  sweeteners: [...],
  extras: [...]
}
```

#### Station Configurations (`station_inventory_configs`)
```javascript
{
  '1': {
    milk: { 'milk_1': true, 'milk_2': true, ... },
    coffee: { 'coffee_1': true, 'coffee_2': true, ... },
    syrups: { 'syrup_1': true, 'syrup_2': true, ... }
  },
  '2': { ... },
  '3': { ... }
}
```

#### Station Quantities (`station_inventory_quantities`)
```javascript
{
  '1': {
    milk: { 'milk_1': { quantity: 20 }, 'milk_2': { quantity: 15 }, ... },
    coffee: { 'coffee_1': { quantity: 5 }, 'coffee_2': { quantity: 5 }, ... }
  },
  '2': { ... },
  '3': { ... }
}
```

#### Barista Stock Data (`coffee_stock_station_X`)
```javascript
{
  milk: [
    { id: 'milk_1', name: 'Whole Milk', amount: 20, capacity: 20, unit: 'L', status: 'good', ... },
    { id: 'milk_2', name: 'Oat Milk', amount: 15, capacity: 15, unit: 'L', status: 'good', ... }
  ],
  coffee: [
    { id: 'coffee_1', name: 'Espresso', amount: 5, capacity: 5, unit: 'kg', status: 'good', ... }
  ],
  syrups: [...],
  sweeteners: [...],
  other: [...]
}
```

### 2. Quick Fix Command

**Copy and paste this into your browser console:**

```javascript
localStorage.setItem('event_inventory', '{"milk":[{"id":"milk_1","name":"Whole Milk","description":"Regular dairy milk","enabled":true,"category":"milk"},{"id":"milk_2","name":"Skim Milk","description":"Low-fat dairy milk","enabled":true,"category":"milk"},{"id":"milk_3","name":"Oat Milk","description":"Plant-based oat milk","enabled":true,"category":"milk"},{"id":"milk_4","name":"Almond Milk","description":"Plant-based almond milk","enabled":true,"category":"milk"},{"id":"milk_5","name":"Soy Milk","description":"Plant-based soy milk","enabled":true,"category":"milk"},{"id":"milk_6","name":"Coconut Milk","description":"Plant-based coconut milk","enabled":true,"category":"milk"}],"coffee":[{"id":"coffee_1","name":"Espresso","description":"Strong coffee shot","enabled":true,"category":"coffee"},{"id":"coffee_2","name":"Americano","description":"Espresso with hot water","enabled":true,"category":"coffee"},{"id":"coffee_3","name":"Latte","description":"Espresso with steamed milk","enabled":true,"category":"coffee"},{"id":"coffee_4","name":"Cappuccino","description":"Espresso with foam","enabled":true,"category":"coffee"},{"id":"coffee_5","name":"Flat White","description":"Double shot with microfoam","enabled":true,"category":"coffee"},{"id":"coffee_6","name":"Mocha","description":"Chocolate coffee drink","enabled":true,"category":"coffee"},{"id":"coffee_7","name":"Filter Coffee","description":"Drip brewed coffee","enabled":true,"category":"coffee"},{"id":"coffee_8","name":"Cold Brew","description":"Cold steeped coffee","enabled":true,"category":"coffee"}],"cups":[{"id":"cups_1","name":"Small (8oz)","description":"240ml cup","volume":240,"shots":1,"enabled":true,"category":"cups"},{"id":"cups_2","name":"Medium (12oz)","description":"350ml cup","volume":350,"shots":1,"enabled":true,"category":"cups"},{"id":"cups_3","name":"Large (16oz)","description":"470ml cup","volume":470,"shots":2,"enabled":true,"category":"cups"},{"id":"cups_4","name":"Extra Large (20oz)","description":"590ml cup","volume":590,"shots":2,"enabled":true,"category":"cups"}],"syrups":[{"id":"syrup_1","name":"Vanilla Syrup","description":"Classic vanilla flavor","enabled":true,"category":"syrups"},{"id":"syrup_2","name":"Caramel Syrup","description":"Sweet caramel flavor","enabled":true,"category":"syrups"},{"id":"syrup_3","name":"Hazelnut Syrup","description":"Nutty hazelnut flavor","enabled":true,"category":"syrups"},{"id":"syrup_4","name":"Cinnamon Syrup","description":"Warm spice flavor","enabled":true,"category":"syrups"},{"id":"syrup_5","name":"Chocolate Syrup","description":"Rich chocolate flavor","enabled":true,"category":"syrups"}],"sweeteners":[{"id":"sweetener_1","name":"White Sugar","description":"Regular granulated sugar","enabled":true,"category":"sweeteners"},{"id":"sweetener_2","name":"Brown Sugar","description":"Raw cane sugar","enabled":true,"category":"sweeteners"},{"id":"sweetener_3","name":"Honey","description":"Natural honey sweetener","enabled":true,"category":"sweeteners"},{"id":"sweetener_4","name":"Stevia","description":"Natural leaf sweetener","enabled":true,"category":"sweeteners"},{"id":"sweetener_5","name":"Artificial Sweetener","description":"Sugar substitute","enabled":true,"category":"sweeteners"}],"extras":[{"id":"extra_1","name":"Hot Chocolate Powder","description":"Premium chocolate powder for hot chocolate drinks","enabled":true,"category":"extras"},{"id":"extra_2","name":"Chai Tea Mix","description":"Spiced tea blend for chai lattes","enabled":true,"category":"extras"},{"id":"extra_3","name":"Matcha Powder","description":"Premium green tea powder for matcha lattes","enabled":true,"category":"extras"},{"id":"extra_4","name":"Whipped Cream","description":"Dairy whipped topping","enabled":true,"category":"extras"},{"id":"extra_5","name":"Cinnamon Powder","description":"Ground cinnamon spice","enabled":true,"category":"extras"}]}');
localStorage.setItem('station_inventory_configs', '{"1":{"milk":{"milk_1":true,"milk_2":true,"milk_3":true,"milk_4":true,"milk_5":true,"milk_6":true},"coffee":{"coffee_1":true,"coffee_2":true,"coffee_3":true,"coffee_4":true,"coffee_5":true,"coffee_6":true,"coffee_7":true,"coffee_8":true},"cups":{"cups_1":true,"cups_2":true,"cups_3":true,"cups_4":true},"syrups":{"syrup_1":true,"syrup_2":true,"syrup_3":true,"syrup_4":true,"syrup_5":true},"sweeteners":{"sweetener_1":true,"sweetener_2":true,"sweetener_3":true,"sweetener_4":true,"sweetener_5":true},"extras":{"extra_1":true,"extra_2":true,"extra_3":true,"extra_4":true,"extra_5":true}},"2":{"milk":{"milk_1":true,"milk_2":true,"milk_3":true,"milk_4":true,"milk_5":true},"coffee":{"coffee_1":true,"coffee_2":true,"coffee_3":true,"coffee_4":true,"coffee_5":true,"coffee_6":true},"cups":{"cups_1":true,"cups_2":true,"cups_3":true},"syrups":{"syrup_1":true,"syrup_2":true,"syrup_3":true},"sweeteners":{"sweetener_1":true,"sweetener_2":true,"sweetener_3":true,"sweetener_4":true},"extras":{"extra_1":true,"extra_2":true,"extra_4":true}},"3":{"milk":{"milk_1":true,"milk_2":true,"milk_3":true},"coffee":{"coffee_1":true,"coffee_2":true,"coffee_3":true,"coffee_4":true,"coffee_5":true},"cups":{"cups_1":true,"cups_2":true,"cups_3":true},"syrups":{"syrup_1":true,"syrup_2":true},"sweeteners":{"sweetener_1":true,"sweetener_2":true,"sweetener_3":true},"extras":{"extra_1":true,"extra_4":true}}}');
localStorage.setItem('station_inventory_quantities', '{"1":{"milk":{"milk_1":{"quantity":20},"milk_2":{"quantity":15},"milk_3":{"quantity":10},"milk_4":{"quantity":8},"milk_5":{"quantity":8},"milk_6":{"quantity":5}},"coffee":{"coffee_1":{"quantity":5},"coffee_2":{"quantity":5},"coffee_3":{"quantity":5},"coffee_4":{"quantity":5},"coffee_5":{"quantity":5},"coffee_6":{"quantity":3},"coffee_7":{"quantity":3},"coffee_8":{"quantity":3}},"cups":{"cups_1":{"quantity":200},"cups_2":{"quantity":300},"cups_3":{"quantity":150},"cups_4":{"quantity":100}},"syrups":{"syrup_1":{"quantity":3},"syrup_2":{"quantity":3},"syrup_3":{"quantity":2},"syrup_4":{"quantity":2},"syrup_5":{"quantity":2}},"sweeteners":{"sweetener_1":{"quantity":5},"sweetener_2":{"quantity":3},"sweetener_3":{"quantity":2},"sweetener_4":{"quantity":1},"sweetener_5":{"quantity":500}},"extras":{"extra_1":{"quantity":3},"extra_2":{"quantity":2},"extra_3":{"quantity":1},"extra_4":{"quantity":2},"extra_5":{"quantity":1}}},"2":{"milk":{"milk_1":{"quantity":15},"milk_2":{"quantity":10},"milk_3":{"quantity":8},"milk_4":{"quantity":6},"milk_5":{"quantity":6}},"coffee":{"coffee_1":{"quantity":4},"coffee_2":{"quantity":4},"coffee_3":{"quantity":4},"coffee_4":{"quantity":4},"coffee_5":{"quantity":4},"coffee_6":{"quantity":2}},"cups":{"cups_1":{"quantity":150},"cups_2":{"quantity":200},"cups_3":{"quantity":100}},"syrups":{"syrup_1":{"quantity":2},"syrup_2":{"quantity":2},"syrup_3":{"quantity":1}},"sweeteners":{"sweetener_1":{"quantity":4},"sweetener_2":{"quantity":2},"sweetener_3":{"quantity":1},"sweetener_4":{"quantity":1}},"extras":{"extra_1":{"quantity":2},"extra_2":{"quantity":1},"extra_4":{"quantity":1}}},"3":{"milk":{"milk_1":{"quantity":10},"milk_2":{"quantity":8},"milk_3":{"quantity":5}},"coffee":{"coffee_1":{"quantity":3},"coffee_2":{"quantity":3},"coffee_3":{"quantity":3},"coffee_4":{"quantity":3},"coffee_5":{"quantity":3}},"cups":{"cups_1":{"quantity":100},"cups_2":{"quantity":150},"cups_3":{"quantity":75}},"syrups":{"syrup_1":{"quantity":1},"syrup_2":{"quantity":1}},"sweeteners":{"sweetener_1":{"quantity":3},"sweetener_2":{"quantity":2},"sweetener_3":{"quantity":1}},"extras":{"extra_1":{"quantity":1},"extra_4":{"quantity":1}}}}');
localStorage.setItem('coffee_stock_station_1', '{"milk":[{"id":"milk_1","name":"Whole Milk","amount":20,"capacity":20,"unit":"L","status":"good","lowThreshold":5,"criticalThreshold":2,"description":"Regular dairy milk","category":"milk","enabled":true},{"id":"milk_2","name":"Skim Milk","amount":15,"capacity":15,"unit":"L","status":"good","lowThreshold":3.75,"criticalThreshold":1.5,"description":"Low-fat dairy milk","category":"milk","enabled":true},{"id":"milk_3","name":"Oat Milk","amount":10,"capacity":10,"unit":"L","status":"good","lowThreshold":2.5,"criticalThreshold":1,"description":"Plant-based oat milk","category":"milk","enabled":true},{"id":"milk_4","name":"Almond Milk","amount":8,"capacity":8,"unit":"L","status":"good","lowThreshold":2,"criticalThreshold":1,"description":"Plant-based almond milk","category":"milk","enabled":true},{"id":"milk_5","name":"Soy Milk","amount":8,"capacity":8,"unit":"L","status":"good","lowThreshold":2,"criticalThreshold":1,"description":"Plant-based soy milk","category":"milk","enabled":true},{"id":"milk_6","name":"Coconut Milk","amount":5,"capacity":5,"unit":"L","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Plant-based coconut milk","category":"milk","enabled":true}],"coffee":[{"id":"coffee_1","name":"Espresso","amount":5,"capacity":5,"unit":"kg","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Strong coffee shot","category":"coffee","enabled":true},{"id":"coffee_2","name":"Americano","amount":5,"capacity":5,"unit":"kg","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Espresso with hot water","category":"coffee","enabled":true},{"id":"coffee_3","name":"Latte","amount":5,"capacity":5,"unit":"kg","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Espresso with steamed milk","category":"coffee","enabled":true},{"id":"coffee_4","name":"Cappuccino","amount":5,"capacity":5,"unit":"kg","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Espresso with foam","category":"coffee","enabled":true},{"id":"coffee_5","name":"Flat White","amount":5,"capacity":5,"unit":"kg","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Double shot with microfoam","category":"coffee","enabled":true},{"id":"coffee_6","name":"Mocha","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Chocolate coffee drink","category":"coffee","enabled":true},{"id":"coffee_7","name":"Filter Coffee","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Drip brewed coffee","category":"coffee","enabled":true},{"id":"coffee_8","name":"Cold Brew","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Cold steeped coffee","category":"coffee","enabled":true}],"cups":[{"id":"cups_1","name":"Small (8oz)","amount":200,"capacity":200,"unit":"pcs","status":"good","lowThreshold":50,"criticalThreshold":20,"description":"240ml cup","category":"cups","enabled":true},{"id":"cups_2","name":"Medium (12oz)","amount":300,"capacity":300,"unit":"pcs","status":"good","lowThreshold":75,"criticalThreshold":30,"description":"350ml cup","category":"cups","enabled":true},{"id":"cups_3","name":"Large (16oz)","amount":150,"capacity":150,"unit":"pcs","status":"good","lowThreshold":37.5,"criticalThreshold":15,"description":"470ml cup","category":"cups","enabled":true},{"id":"cups_4","name":"Extra Large (20oz)","amount":100,"capacity":100,"unit":"pcs","status":"good","lowThreshold":25,"criticalThreshold":10,"description":"590ml cup","category":"cups","enabled":true}],"syrups":[{"id":"syrup_1","name":"Vanilla Syrup","amount":3,"capacity":3,"unit":"L","status":"good","lowThreshold":0.75,"criticalThreshold":1,"description":"Classic vanilla flavor","category":"syrups","enabled":true},{"id":"syrup_2","name":"Caramel Syrup","amount":3,"capacity":3,"unit":"L","status":"good","lowThreshold":0.75,"criticalThreshold":1,"description":"Sweet caramel flavor","category":"syrups","enabled":true},{"id":"syrup_3","name":"Hazelnut Syrup","amount":2,"capacity":2,"unit":"L","status":"good","lowThreshold":0.5,"criticalThreshold":1,"description":"Nutty hazelnut flavor","category":"syrups","enabled":true},{"id":"syrup_4","name":"Cinnamon Syrup","amount":2,"capacity":2,"unit":"L","status":"good","lowThreshold":0.5,"criticalThreshold":1,"description":"Warm spice flavor","category":"syrups","enabled":true},{"id":"syrup_5","name":"Chocolate Syrup","amount":2,"capacity":2,"unit":"L","status":"good","lowThreshold":0.5,"criticalThreshold":1,"description":"Rich chocolate flavor","category":"syrups","enabled":true}],"sweeteners":[{"id":"sweetener_1","name":"White Sugar","amount":5,"capacity":5,"unit":"kg","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Regular granulated sugar","category":"sweeteners","enabled":true},{"id":"sweetener_2","name":"Brown Sugar","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Raw cane sugar","category":"sweeteners","enabled":true},{"id":"sweetener_3","name":"Honey","amount":2,"capacity":2,"unit":"L","status":"good","lowThreshold":0.5,"criticalThreshold":1,"description":"Natural honey sweetener","category":"sweeteners","enabled":true},{"id":"sweetener_4","name":"Stevia","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Natural leaf sweetener","category":"sweeteners","enabled":true},{"id":"sweetener_5","name":"Artificial Sweetener","amount":500,"capacity":500,"unit":"pcs","status":"good","lowThreshold":125,"criticalThreshold":50,"description":"Sugar substitute","category":"sweeteners","enabled":true}],"other":[{"id":"extra_1","name":"Hot Chocolate Powder","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Premium chocolate powder for hot chocolate drinks","category":"extras","enabled":true},{"id":"extra_2","name":"Chai Tea Mix","amount":2,"capacity":2,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Spiced tea blend for chai lattes","category":"extras","enabled":true},{"id":"extra_3","name":"Matcha Powder","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Premium green tea powder for matcha lattes","category":"extras","enabled":true},{"id":"extra_4","name":"Whipped Cream","amount":2,"capacity":2,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Dairy whipped topping","category":"extras","enabled":true},{"id":"extra_5","name":"Cinnamon Powder","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Ground cinnamon spice","category":"extras","enabled":true}]}');
localStorage.setItem('coffee_stock_station_2', '{"milk":[{"id":"milk_1","name":"Whole Milk","amount":15,"capacity":15,"unit":"L","status":"good","lowThreshold":3.75,"criticalThreshold":1.5,"description":"Regular dairy milk","category":"milk","enabled":true},{"id":"milk_2","name":"Skim Milk","amount":10,"capacity":10,"unit":"L","status":"good","lowThreshold":2.5,"criticalThreshold":1,"description":"Low-fat dairy milk","category":"milk","enabled":true},{"id":"milk_3","name":"Oat Milk","amount":8,"capacity":8,"unit":"L","status":"good","lowThreshold":2,"criticalThreshold":1,"description":"Plant-based oat milk","category":"milk","enabled":true},{"id":"milk_4","name":"Almond Milk","amount":6,"capacity":6,"unit":"L","status":"good","lowThreshold":1.5,"criticalThreshold":1,"description":"Plant-based almond milk","category":"milk","enabled":true},{"id":"milk_5","name":"Soy Milk","amount":6,"capacity":6,"unit":"L","status":"good","lowThreshold":1.5,"criticalThreshold":1,"description":"Plant-based soy milk","category":"milk","enabled":true}],"coffee":[{"id":"coffee_1","name":"Espresso","amount":4,"capacity":4,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Strong coffee shot","category":"coffee","enabled":true},{"id":"coffee_2","name":"Americano","amount":4,"capacity":4,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Espresso with hot water","category":"coffee","enabled":true},{"id":"coffee_3","name":"Latte","amount":4,"capacity":4,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Espresso with steamed milk","category":"coffee","enabled":true},{"id":"coffee_4","name":"Cappuccino","amount":4,"capacity":4,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Espresso with foam","category":"coffee","enabled":true},{"id":"coffee_5","name":"Flat White","amount":4,"capacity":4,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Double shot with microfoam","category":"coffee","enabled":true},{"id":"coffee_6","name":"Mocha","amount":2,"capacity":2,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Chocolate coffee drink","category":"coffee","enabled":true}],"cups":[{"id":"cups_1","name":"Small (8oz)","amount":150,"capacity":150,"unit":"pcs","status":"good","lowThreshold":37.5,"criticalThreshold":15,"description":"240ml cup","category":"cups","enabled":true},{"id":"cups_2","name":"Medium (12oz)","amount":200,"capacity":200,"unit":"pcs","status":"good","lowThreshold":50,"criticalThreshold":20,"description":"350ml cup","category":"cups","enabled":true},{"id":"cups_3","name":"Large (16oz)","amount":100,"capacity":100,"unit":"pcs","status":"good","lowThreshold":25,"criticalThreshold":10,"description":"470ml cup","category":"cups","enabled":true}],"syrups":[{"id":"syrup_1","name":"Vanilla Syrup","amount":2,"capacity":2,"unit":"L","status":"good","lowThreshold":0.5,"criticalThreshold":1,"description":"Classic vanilla flavor","category":"syrups","enabled":true},{"id":"syrup_2","name":"Caramel Syrup","amount":2,"capacity":2,"unit":"L","status":"good","lowThreshold":0.5,"criticalThreshold":1,"description":"Sweet caramel flavor","category":"syrups","enabled":true},{"id":"syrup_3","name":"Hazelnut Syrup","amount":1,"capacity":1,"unit":"L","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Nutty hazelnut flavor","category":"syrups","enabled":true}],"sweeteners":[{"id":"sweetener_1","name":"White Sugar","amount":4,"capacity":4,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Regular granulated sugar","category":"sweeteners","enabled":true},{"id":"sweetener_2","name":"Brown Sugar","amount":2,"capacity":2,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Raw cane sugar","category":"sweeteners","enabled":true},{"id":"sweetener_3","name":"Honey","amount":1,"capacity":1,"unit":"L","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Natural honey sweetener","category":"sweeteners","enabled":true},{"id":"sweetener_4","name":"Stevia","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Natural leaf sweetener","category":"sweeteners","enabled":true}],"other":[{"id":"extra_1","name":"Hot Chocolate Powder","amount":2,"capacity":2,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Premium chocolate powder for hot chocolate drinks","category":"extras","enabled":true},{"id":"extra_2","name":"Chai Tea Mix","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Spiced tea blend for chai lattes","category":"extras","enabled":true},{"id":"extra_4","name":"Whipped Cream","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Dairy whipped topping","category":"extras","enabled":true}]}');
localStorage.setItem('coffee_stock_station_3', '{"milk":[{"id":"milk_1","name":"Whole Milk","amount":10,"capacity":10,"unit":"L","status":"good","lowThreshold":2.5,"criticalThreshold":1,"description":"Regular dairy milk","category":"milk","enabled":true},{"id":"milk_2","name":"Skim Milk","amount":8,"capacity":8,"unit":"L","status":"good","lowThreshold":2,"criticalThreshold":1,"description":"Low-fat dairy milk","category":"milk","enabled":true},{"id":"milk_3","name":"Oat Milk","amount":5,"capacity":5,"unit":"L","status":"good","lowThreshold":1.25,"criticalThreshold":1,"description":"Plant-based oat milk","category":"milk","enabled":true}],"coffee":[{"id":"coffee_1","name":"Espresso","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Strong coffee shot","category":"coffee","enabled":true},{"id":"coffee_2","name":"Americano","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Espresso with hot water","category":"coffee","enabled":true},{"id":"coffee_3","name":"Latte","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Espresso with steamed milk","category":"coffee","enabled":true},{"id":"coffee_4","name":"Cappuccino","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Espresso with foam","category":"coffee","enabled":true},{"id":"coffee_5","name":"Flat White","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Double shot with microfoam","category":"coffee","enabled":true}],"cups":[{"id":"cups_1","name":"Small (8oz)","amount":100,"capacity":100,"unit":"pcs","status":"good","lowThreshold":25,"criticalThreshold":10,"description":"240ml cup","category":"cups","enabled":true},{"id":"cups_2","name":"Medium (12oz)","amount":150,"capacity":150,"unit":"pcs","status":"good","lowThreshold":37.5,"criticalThreshold":15,"description":"350ml cup","category":"cups","enabled":true},{"id":"cups_3","name":"Large (16oz)","amount":75,"capacity":75,"unit":"pcs","status":"good","lowThreshold":18.75,"criticalThreshold":7.5,"description":"470ml cup","category":"cups","enabled":true}],"syrups":[{"id":"syrup_1","name":"Vanilla Syrup","amount":1,"capacity":1,"unit":"L","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Classic vanilla flavor","category":"syrups","enabled":true},{"id":"syrup_2","name":"Caramel Syrup","amount":1,"capacity":1,"unit":"L","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Sweet caramel flavor","category":"syrups","enabled":true}],"sweeteners":[{"id":"sweetener_1","name":"White Sugar","amount":3,"capacity":3,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Regular granulated sugar","category":"sweeteners","enabled":true},{"id":"sweetener_2","name":"Brown Sugar","amount":2,"capacity":2,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Raw cane sugar","category":"sweeteners","enabled":true},{"id":"sweetener_3","name":"Honey","amount":1,"capacity":1,"unit":"L","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Natural honey sweetener","category":"sweeteners","enabled":true}],"other":[{"id":"extra_1","name":"Hot Chocolate Powder","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Premium chocolate powder for hot chocolate drinks","category":"extras","enabled":true},{"id":"extra_4","name":"Whipped Cream","amount":1,"capacity":1,"unit":"kg","status":"good","lowThreshold":1,"criticalThreshold":1,"description":"Dairy whipped topping","category":"extras","enabled":true}]}');
console.log('✅ Inventory data flow setup complete!');
location.reload();
```

**Then reload the page.**

### 3. Verification Steps

After running the setup command:

1. **Check Organiser Interface:**
   - Go to `Organiser → Stations → Event Inventory`
   - You should see 6 categories with items: milk (6), coffee (8), syrups (5), sweeteners (5), extras (5)
   - All items should be enabled

2. **Check Station Assignments:**
   - Go to `Organiser → Stations → Station Inventory`
   - You should see 3 stations with different assignments:
     - Station 1: Full range (6 milks, 8 coffees, 5 syrups)
     - Station 2: Standard (5 milks, 6 coffees, 3 syrups)
     - Station 3: Basic (3 milks, 5 coffees, 2 syrups)

3. **Check Barista Interface:**
   - Go to `Barista Interface`
   - Select different stations
   - Go to `Stock` tab - you should see inventory items with quantities
   - Try creating a walk-in order - milk and coffee options should be available

### 4. Component Relationships

#### Key Files Involved

1. **`InventoryManagement.js`** - Sets up `event_inventory` localStorage
2. **`StationInventoryConfig.js`** - Sets up `station_inventory_configs` localStorage  
3. **`InventoryIntegrationService.js`** - Syncs from organiser to barista stock
4. **`StockService.js`** - Loads and manages barista stock data
5. **`useStock.js`** - Hook that provides stock data to components
6. **`WalkInOrderDialog.js`** - Consumes available milk/coffee from stock
7. **`BaristaInterface.js`** - Displays stock information

#### Data Flow Sequence

1. Organiser uses `InventoryManagement.js` → saves to `event_inventory`
2. Organiser uses `StationInventoryConfig.js` → saves to `station_inventory_configs`
3. `InventoryIntegrationService.syncInventoryToStations()` runs → creates `coffee_stock_station_X`
4. Barista interface `StockService.initialize()` → loads from `coffee_stock_station_X`
5. `useStock` hook → provides data to components
6. `WalkInOrderDialog` → uses `StockService.getAvailableMilkTypes()` etc.

## Testing Results Expected

After applying the fix:

- **Station 1**: 6 milk types, 8 coffee types, 5 syrups available
- **Station 2**: 5 milk types, 6 coffee types, 3 syrups available  
- **Station 3**: 3 milk types, 5 coffee types, 2 syrups available
- **Walk-in orders**: Should show available options based on selected station
- **Stock management**: Should show proper inventory levels
- **Order completion**: Should deplete stock appropriately

## Long-term Solution

For production use, implement proper UI flows:

1. **Set up Event Inventory** via Organiser → Stations → Event Inventory
2. **Assign to Stations** via Organiser → Stations → Station Inventory  
3. **Set Quantities** via Organiser → Stations → Event Stock
4. **Sync to Baristas** automatically via `InventoryIntegrationService`

This restores the complete hierarchy and makes all inventory features functional.