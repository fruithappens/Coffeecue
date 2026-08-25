import React, { useState, useEffect } from 'react';
import { 
  Plus, Trash2, Edit3, Save, X, Package, Coffee, Droplet, 
  Beaker, Square, Candy, Search
} from 'lucide-react';
import InventoryIntegrationService from '../../services/InventoryIntegrationService';
import EventInventoryService from '../../services/EventInventoryService';
import QuickSetupStatusBanner from './QuickSetupStatusBanner';
import useCatalog from '../../hooks/useCatalog';

// Inventory categories that map cleanly to a catalog category. When
// the operator is adding an item in one of these, the name input
// gets a datalist of catalog options so they don't typo names that
// then fail to match station capabilities ('Whoel Milk').
//
// 'coffee' (beans), 'cups', and 'syrups' don't map — they have no
// catalog category — so they keep the plain text input.
const INVENTORY_TO_CATALOG = {
  milk: 'milk',
  sweeteners: 'sweetener',
  drinks: 'drink',
};

/**
 * Comprehensive Inventory Management Component
 * Allows organizers to create and manage all inventory items by category
 */
const InventoryManagement = () => {
  // Define inventory categories
  const categories = {
    milk: {
      name: 'Milk & Dairy',
      icon: <Droplet size={20} />,
      color: 'blue',
      defaultItems: [
        { name: 'Whole Milk', description: 'Regular dairy milk' },
        { name: 'Skim Milk', description: 'Low-fat dairy milk' },
        { name: 'Oat Milk', description: 'Plant-based oat milk' },
        { name: 'Almond Milk', description: 'Plant-based almond milk' },
        { name: 'Soy Milk', description: 'Plant-based soy milk' },
        { name: 'Coconut Milk', description: 'Plant-based coconut milk' },
        { name: 'Macadamia Milk', description: 'Plant-based macadamia milk' },
        { name: 'Rice Milk', description: 'Plant-based rice milk' }
      ]
    },
    coffee: {
      // 'Coffee' here means BEANS, not drinks. Drinks belong on the
      // Menu Items page. Historical bug: the defaults below seeded
      // drink names ('Espresso', 'Cappuccino', 'Latte') into the
      // coffee category — which then surfaced as 'bean type' options
      // in the walk-in dialog, producing nonsense orders like
      // 'Cappuccino Latte'. Fixed to actual bean SKUs that match
      // what Quick Setup writes (house blend beans / decaf beans).
      name: 'Coffee Beans',
      icon: <Coffee size={20} />,
      color: 'amber',
      defaultItems: [
        { name: 'House Blend Beans',     description: 'Standard espresso blend' },
        { name: 'Decaf Beans',           description: 'Decaffeinated beans for SMS-routed decaf orders' },
        { name: 'Single Origin Beans',   description: 'Optional rotating single origin' },
      ]
    },
    cups: {
      name: 'Cups & Sizes',
      icon: <Square size={20} />,
      color: 'green',
      defaultItems: [
        { name: 'Small (8oz)', description: '240ml cup', volume: 240, shots: 1 },
        { name: 'Medium (12oz)', description: '350ml cup', volume: 350, shots: 1 },
        { name: 'Large (16oz)', description: '470ml cup', volume: 470, shots: 2 },
        { name: 'Extra Large (20oz)', description: '590ml cup', volume: 590, shots: 2 },
        { name: 'Takeaway Cup Small', description: 'Small disposable cup', volume: 240, shots: 1 },
        { name: 'Takeaway Cup Medium', description: 'Medium disposable cup', volume: 350, shots: 1 },
        { name: 'Takeaway Cup Large', description: 'Large disposable cup', volume: 470, shots: 2 },
        { name: 'Ceramic Mug', description: 'Reusable ceramic mug', volume: 300, shots: 1 }
      ],
      additionalFields: [
        { key: 'volume', label: 'Volume (ml)', type: 'number', required: true },
        { key: 'shots', label: 'Espresso Shots', type: 'number', required: true }
      ]
    },
    syrups: {
      name: 'Syrups & Flavors',
      icon: <Beaker size={20} />,
      color: 'purple',
      defaultItems: [
        { name: 'Vanilla Syrup', description: 'Classic vanilla flavor' },
        { name: 'Caramel Syrup', description: 'Sweet caramel flavor' },
        { name: 'Hazelnut Syrup', description: 'Nutty hazelnut flavor' },
        { name: 'Cinnamon Syrup', description: 'Warm spice flavor' },
        { name: 'Coconut Syrup', description: 'Tropical coconut flavor' },
        { name: 'Chocolate Syrup', description: 'Rich chocolate flavor' },
        { name: 'Peppermint Syrup', description: 'Fresh mint flavor' },
        { name: 'Gingerbread Syrup', description: 'Seasonal spice flavor' },
        { name: 'Irish Cream Syrup', description: 'Creamy liqueur flavor' },
        { name: 'Maple Syrup', description: 'Natural maple sweetener' }
      ]
    },
    sweeteners: {
      name: 'Sugars & Sweeteners',
      icon: <Candy size={20} />,
      color: 'pink',
      defaultItems: [
        { name: 'White Sugar', description: 'Regular granulated sugar' },
        { name: 'Brown Sugar', description: 'Raw cane sugar' },
        { name: 'Honey', description: 'Natural honey sweetener' },
        { name: 'Stevia', description: 'Natural leaf sweetener' },
        { name: 'Artificial Sweetener', description: 'Sugar substitute' },
        { name: 'Agave Syrup', description: 'Plant-based sweetener' },
        { name: 'Coconut Sugar', description: 'Natural coconut sweetener' },
        { name: 'Maple Sugar', description: 'Natural maple sweetener' }
      ]
    },
    drinks: {
      name: 'Non-Coffee Drinks',
      icon: <Beaker size={20} />,
      color: 'teal',
      defaultItems: [
        { name: 'Hot Chocolate', description: 'Rich chocolate drink' },
        { name: 'Chai Latte', description: 'Spiced tea with milk' },
        { name: 'Matcha Latte', description: 'Green tea latte' },
        { name: 'Golden Latte', description: 'Turmeric-based latte' },
        // Tea section — individual flavors so the operator can pick
        // and choose which teas are on offer. "Hot Tea" is kept as a
        // generic catch-all for the simple café where the barista
        // just has one tin of black tea.
        { name: 'Hot Tea', description: 'Generic hot tea (black, no specific flavor)', isTea: true },
        { name: 'English Breakfast Tea', description: 'Classic black tea blend', isTea: true },
        { name: 'Earl Grey Tea', description: 'Black tea with bergamot', isTea: true },
        { name: 'Green Tea', description: 'Light, grassy green tea', isTea: true },
        { name: 'Peppermint Tea', description: 'Caffeine-free mint herbal', isTea: true },
        { name: 'Chamomile Tea', description: 'Caffeine-free floral herbal', isTea: true },
        { name: 'Lemon & Ginger Tea', description: 'Zesty herbal infusion', isTea: true },
        { name: 'Rooibos Tea', description: 'Caffeine-free South African red tea', isTea: true },
        { name: 'Iced Tea', description: 'Refreshing cold tea' },
        { name: 'Fresh Juice', description: 'Freshly squeezed juice' },
        { name: 'Smoothie', description: 'Blended fruit drink' }
      ]
    },
    extras: {
      name: 'Extras & Add-ons',
      icon: <Package size={20} />,
      color: 'indigo',
      defaultItems: [
        { name: 'Hot Chocolate Powder', description: 'Premium chocolate powder for hot chocolate drinks' },
        { name: 'Chai Tea Mix', description: 'Spiced tea blend for chai lattes' },
        { name: 'Matcha Powder', description: 'Premium green tea powder for matcha lattes' },
        { name: 'Turmeric Powder', description: 'Golden milk turmeric powder' },
        { name: 'Whipped Cream', description: 'Dairy whipped topping' },
        { name: 'Cinnamon Powder', description: 'Ground cinnamon spice' },
        { name: 'Cocoa Powder', description: 'Chocolate dusting powder' },
        { name: 'Marshmallows', description: 'Sweet marshmallow topping' },
        { name: 'Biscotti', description: 'Italian almond biscuit' },
        { name: 'Chocolate Chips', description: 'Mini chocolate chips for drinks' }
      ]
    }
  };

  // State management
  const [inventory, setInventory] = useState({});
  const [activeCategory, setActiveCategory] = useState('milk');
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState({ name: '', description: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [saveError, setSaveError] = useState('');
  
  // Reset newItem when category changes to include additional fields
  useEffect(() => {
    const baseItem = { name: '', description: '' };
    const category = categories[activeCategory];
    if (category?.additionalFields) {
      category.additionalFields.forEach(field => {
        baseItem[field.key] = field.type === 'number' ? 0 : '';
      });
    }
    setNewItem(baseItem);
    setShowAddForm(false);
  }, [activeCategory]);

  // Load inventory from the source-of-truth backend (with localStorage
  // as a cache fallback). EventInventoryService handles the precedence;
  // if the backend has nothing, it migrates from localStorage on first
  // save and the user sees no disruption.
  useEffect(() => {
    let cancelled = false;
    EventInventoryService.load().then(loaded => {
      if (cancelled) return;
      if (loaded && Object.keys(loaded).length > 0) {
        // Validate before applying
        const validated = {};
        Object.keys(loaded).forEach(category => {
          if (Array.isArray(loaded[category])) {
            validated[category] = loaded[category].filter(item =>
              item && typeof item === 'object' && item.name
            );
          }
        });
        setInventory(validated);
      } else {
        initializeDefaultInventory();
      }
    }).catch(e => {
      console.error('Error loading inventory from backend:', e);
      // Final fallback — try local then defaults
      try {
        const savedInventory = localStorage.getItem('event_inventory');
        if (savedInventory) {
          setInventory(JSON.parse(savedInventory));
          return;
        }
      } catch (_) { /* ignore */ }
      initializeDefaultInventory();
    });
    // Cross-tab / cross-component refresh. Two events to listen for:
    //   - 'inventory:updated'   — the canonical name dispatched by
    //                             EventInventoryService.save() and by
    //                             Quick Setup. THIS is the one that
    //                             actually fires in practice — listening
    //                             only for the underscore form was why
    //                             Quick Setup didn't refresh the
    //                             Inventory Management panel.
    //   - 'event_inventory_updated' — legacy alias still dispatched
    //                                 in a few places; keep listening
    //                                 for backwards compat.
    const onExternalUpdate = (e) => {
      EventInventoryService.invalidate();
      // The dispatched event sometimes carries the new payload in
      // event.detail — use it directly to skip a round-trip.
      if (e?.detail && typeof e.detail === 'object' && Object.keys(e.detail).length > 0) {
        setInventory(e.detail);
        return;
      }
      EventInventoryService.load({ forceReload: true }).then(latest => {
        if (latest && Object.keys(latest).length > 0) setInventory(latest);
      });
    };
    window.addEventListener('inventory:updated', onExternalUpdate);
    window.addEventListener('event_inventory_updated', onExternalUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('inventory:updated', onExternalUpdate);
      window.removeEventListener('event_inventory_updated', onExternalUpdate);
    };
  }, []);

  // Initialize with default items
  const initializeDefaultInventory = () => {
    const defaultInventory = {};
    Object.keys(categories).forEach(categoryKey => {
      defaultInventory[categoryKey] = categories[categoryKey].defaultItems.map((item, index) => ({
        id: `${categoryKey}_${index + 1}`,
        ...item,
        enabled: true,
        category: categoryKey
      }));
    });
    setInventory(defaultInventory);
    saveInventory(defaultInventory);
  };

  // Apply a change to the LATEST inventory, then persist exactly what we
  // applied.
  //
  // Every handler used to build `{...inventory, ...}` from the value captured
  // in its render and save that. Untick several items quickly and each save
  // carried a snapshot WITHOUT the previous ticks — the last request to land
  // won and silently reverted the others. Steve: "thought I had disabled all
  // except medium... it's all turned off in setup", while the server still
  // had them on. Only his final toggle had survived.
  //
  // Composing inside the updater means every change builds on the one before
  // it, so a burst of toggles ends up with all of them.
  const applyAndSave = (mutate) => {
    setInventory((prev) => {
      const next = mutate(prev);
      saveInventory(next);
      return next;
    });
  };

  // Save through the source-of-truth service, which writes the backend AND
  // mirrors to localStorage so components still reading
  // localStorage.event_inventory stay in sync.
  //
  // A failure has to be VISIBLE. This used to log a console warning and
  // leave the change on screen, so the operator saw items switched off
  // while the server still had them on — and only found out when the menu
  // offered a drink they thought they had removed.
  const saveInventory = (inventoryData) => {
    EventInventoryService.save(inventoryData)
      .then(() => {
        setSaveError('');
        // Notify the integration service so per-station stock
        // configs re-sync with the new master list.
        InventoryIntegrationService.notifyInventoryUpdated();
      })
      .catch(e => {
        console.error('Error saving inventory to backend:', e);
        setSaveError('NOT saved to the server — this screen shows your change '
          + 'but the menu, kiosk and SMS still have the old list. '
          + 'Check your connection (or log out and back in) and try again.');
        InventoryIntegrationService.notifyInventoryUpdated();
      });
  };

  // Add new item
  const addItem = () => {
    if (!newItem.name || !newItem.name.trim()) return;

    const newId = `${activeCategory}_${Date.now()}`;
    const item = {
      id: newId,
      name: newItem.name.trim(),
      description: (newItem.description || '').trim(),
      enabled: true,
      category: activeCategory
    };
    
    // Include additional fields if defined for this category
    const category = categories[activeCategory];
    if (category?.additionalFields) {
      category.additionalFields.forEach(field => {
        if (newItem[field.key] !== undefined) {
          item[field.key] = field.type === 'number' ? Number(newItem[field.key]) : newItem[field.key];
        }
      });
    }

    applyAndSave((prev) => ({
      ...prev,
      [activeCategory]: [...(prev[activeCategory] || []), item]
    }));
    
    // Reset form with proper fields
    const baseItem = { name: '', description: '' };
    if (category?.additionalFields) {
      category.additionalFields.forEach(field => {
        baseItem[field.key] = field.type === 'number' ? 0 : '';
      });
    }
    setNewItem(baseItem);
    setShowAddForm(false);
  };

  // Edit item
  const saveEdit = (itemId, updatedData) => {
    applyAndSave((prev) => ({
      ...prev,
      [activeCategory]: (prev[activeCategory] || []).map(item =>
        item.id === itemId ? { ...item, ...updatedData } : item
      )
    }));
    setEditingItem(null);
  };

  // Delete item
  const deleteItem = (itemId) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;

    applyAndSave((prev) => ({
      ...prev,
      [activeCategory]: (prev[activeCategory] || []).filter(item => item.id !== itemId)
    }));
  };

  // Toggle item enabled/disabled
  const toggleItem = (itemId) => {
    applyAndSave((prev) => ({
      ...prev,
      [activeCategory]: (prev[activeCategory] || []).map(item =>
        item.id === itemId ? { ...item, enabled: !item.enabled } : item
      )
    }));
  };

  // Filter items based on search
  const getFilteredItems = () => {
    const items = inventory[activeCategory] || [];
    if (!searchTerm) return items;
    
    return items.filter(item => {
      if (!item) return false;
      const name = item.name || '';
      const description = item.description || '';
      const searchLower = searchTerm.toLowerCase();
      
      return name.toLowerCase().includes(searchLower) ||
             description.toLowerCase().includes(searchLower);
    });
  };

  // Get category stats
  const getCategoryStats = (categoryKey) => {
    const items = inventory[categoryKey] || [];
    const enabled = items.filter(item => item.enabled).length;
    return { total: items.length, enabled };
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
      <QuickSetupStatusBanner section="event_inventory" />
      {saveError && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-300 text-red-800 text-sm">
          {saveError}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Inventory Management</h2>
        <button
          onClick={initializeDefaultInventory}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
        >
          Reset to Defaults
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        {/* Category Sidebar */}
        <div className="lg:col-span-3">
          <h3 className="text-lg font-semibold mb-4 text-gray-700">Categories</h3>
          <div className="space-y-2">
            {Object.entries(categories).map(([categoryKey, category]) => {
              const stats = getCategoryStats(categoryKey);
              return (
                <button
                  key={categoryKey}
                  onClick={() => setActiveCategory(categoryKey)}
                  className={`w-full text-left p-3 rounded-md transition-colors ${
                    activeCategory === categoryKey
                      ? `bg-${category.color}-100 border border-${category.color}-300`
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className={`text-${category.color}-600 mr-2`}>
                        {category.icon}
                      </span>
                      <span className="font-medium">{category.name}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {stats.enabled}/{stats.total}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-9">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center">
              <span className={`text-${categories[activeCategory].color}-600 mr-2`}>
                {categories[activeCategory].icon}
              </span>
              <h3 className="text-xl font-semibold">
                {categories[activeCategory].name}
              </h3>
            </div>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
            >
              <Plus size={16} className="mr-2" />
              Add Item
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Add Item Form */}
          {showAddForm && (
            <div className="bg-gray-50 rounded-md p-4 mb-4">
              <h4 className="text-lg font-medium mb-3">Add New Item</h4>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Item Name
                    </label>
                    {/* CatalogNameInput shows a datalist of canonical
                        names for milk / sweetener / drink categories
                        so the operator gets autocomplete and can't
                        typo a name that won't match capabilities.
                        Other categories (beans, cups, syrups) keep
                        the plain text input. */}
                    <CatalogNameInput
                      categoryKey={activeCategory}
                      value={newItem.name}
                      onChange={(v) => setNewItem({ ...newItem, name: v })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={newItem.description}
                      onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter description..."
                    />
                  </div>
                </div>
                
                {/* Additional fields for cups */}
                {categories[activeCategory]?.additionalFields && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {categories[activeCategory].additionalFields.map(field => (
                      <div key={field.key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {field.label}
                        </label>
                        <input
                          type={field.type}
                          value={newItem[field.key] || ''}
                          onChange={(e) => setNewItem({ ...newItem, [field.key]: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder={`Enter ${field.label.toLowerCase()}...`}
                          required={field.required}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end space-x-2 mt-4">
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    // Reset form with proper fields
                    const baseItem = { name: '', description: '' };
                    const category = categories[activeCategory];
                    if (category?.additionalFields) {
                      category.additionalFields.forEach(field => {
                        baseItem[field.key] = field.type === 'number' ? 0 : '';
                      });
                    }
                    setNewItem(baseItem);
                  }}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={addItem}
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                >
                  Add Item
                </button>
              </div>
            </div>
          )}

          {/* Items List */}
          <div className="space-y-2">
            {getFilteredItems().map(item => (
              <div
                key={item.id}
                className={`p-4 rounded-md border ${
                  item.enabled 
                    ? 'border-gray-200 bg-white' 
                    : 'border-gray-100 bg-gray-50 opacity-60'
                }`}
              >
                {editingItem === item.id ? (
                  <EditItemForm
                    item={item}
                    category={activeCategory}
                    categories={categories}
                    onSave={(updatedData) => saveEdit(item.id, updatedData)}
                    onCancel={() => setEditingItem(null)}
                  />
                ) : (
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={() => toggleItem(item.id)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                      </label>
                      <div>
                        <h4 className="font-medium text-gray-900">{item.name}</h4>
                        <p className="text-sm text-gray-600">{item.description}</p>
                        {/* Show additional fields for cups */}
                        {activeCategory === 'cups' && (item.volume || item.shots) && (
                          <div className="flex space-x-4 text-sm text-gray-500 mt-1">
                            {item.volume && <span>Volume: {item.volume}ml</span>}
                            {item.shots && <span>Shots: {item.shots}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setEditingItem(item.id)}
                        className="p-2 text-blue-600 hover:bg-blue-100 rounded-md"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="p-2 text-red-600 hover:bg-red-100 rounded-md"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {getFilteredItems().length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Package size={48} className="mx-auto mb-4 text-gray-400" />
              <p>No items found in this category</p>
              {searchTerm && (
                <p className="text-sm">Try adjusting your search term</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Edit Item Form Component
const EditItemForm = ({ item, onSave, onCancel, category, categories }) => {
  const [formData, setFormData] = useState({
    name: item.name || '',
    description: item.description || '',
    volume: item.volume || 0,
    shots: item.shots || 0
  });

  const handleSave = () => {
    if (!formData.name || !formData.name.trim()) return;
    
    const updatedData = {
      name: formData.name.trim(),
      description: (formData.description || '').trim()
    };
    
    // Include additional fields if defined for this category
    if (categories[category]?.additionalFields) {
      categories[category].additionalFields.forEach(field => {
        if (formData[field.key] !== undefined) {
          updatedData[field.key] = field.type === 'number' ? Number(formData[field.key]) : formData[field.key];
        }
      });
    }
    
    onSave(updatedData);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Item Name
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <input
            type="text"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>
      
      {/* Additional fields for cups */}
      {categories[category]?.additionalFields && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {categories[category].additionalFields.map(field => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}
              </label>
              <input
                type={field.type}
                value={formData[field.key] || ''}
                onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required={field.required}
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end space-x-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 flex items-center"
        >
          <X size={16} className="mr-1" />
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center"
        >
          <Save size={16} className="mr-1" />
          Save
        </button>
      </div>
    </div>
  );
};

// --- Catalog-aware name input ---------------------------------------
// Renders a regular text input with a <datalist> of canonical names
// when the active category maps to a catalog category. The operator
// can still type a custom name (catalog autocompletes; doesn't force).
//
// Important: keep this as <input list="..."> rather than <select> so
// the operator can still add items the catalog doesn't know about.
// The catalog suggestion is a guardrail, not a gate.
const CatalogNameInput = ({ categoryKey, value, onChange }) => {
  const catalogCategory = INVENTORY_TO_CATALOG[categoryKey] || null;
  const { items: catalogItems } = useCatalog(catalogCategory || 'milk');
  // Only attach datalist if this category maps to a catalog one.
  const useDatalist = !!catalogCategory && Array.isArray(catalogItems) && catalogItems.length > 0;
  const listId = useDatalist ? `catalog-${catalogCategory}-suggestions` : undefined;

  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        placeholder={useDatalist
          ? `Type or pick a ${catalogCategory}…`
          : 'Enter item name...'}
        list={listId}
        autoComplete="off"
      />
      {useDatalist && (
        <datalist id={listId}>
          {catalogItems.map(i => (
            <option key={i.id} value={i.name}>
              {i.subcategory ? `${i.subcategory}` : ''}{i.short_name && i.short_name !== i.name.toLowerCase() ? ` · ${i.short_name}` : ''}
            </option>
          ))}
        </datalist>
      )}
      {catalogCategory && (
        <p className="text-xs text-gray-500 mt-1">
          Suggestions from the canonical {catalogCategory} catalog. You
          can still type a custom name — it'll be added to the event's
          inventory but won't auto-appear in other dropdowns.
        </p>
      )}
    </>
  );
};

export default InventoryManagement;