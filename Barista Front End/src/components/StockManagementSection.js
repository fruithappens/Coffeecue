// components/StockManagementSection.js
import React, { useState } from 'react';
import { Plus, Minus, RefreshCw, AlertTriangle, XCircle, Check, Package } from 'lucide-react';
import useStock from '../hooks/useStock';

const StockManagementSection = () => {
  const {
    items,
    selectedCategory,
    categories,
    lowStockItems,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    showLowStockOnly,
    loadItemDetails,
    updateItemQuantity,
    createItem,
    updateItemProperties,
    deleteItem,
    reportLowStock,
    requestRestock,
    changeCategory,
    refreshData,
    setShowLowStockOnly,
    clearError
  } = useStock();

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showRestockModal, setShowRestockModal] = useState(false);
  const [newItem, setNewItem] = useState({
    name: '',
    category: 'milk',
    amount: 0,
    unit: '',
    capacity: 0
  });
  const [selectedLowStockItems, setSelectedLowStockItems] = useState([]);

  const handleUpdateQuantity = async (item, increase) => {
    const changeAmount = item.category === 'milk' 
      ? 0.5 
      : item.category === 'coffee' 
        ? 0.1 
        : 1;
    
    const newAmount = increase 
      ? Math.min(item.amount + changeAmount, item.capacity) 
      : Math.max(0, item.amount - changeAmount);
    
    if (newAmount !== item.amount) {
      await updateItemQuantity(
        item.id, 
        newAmount, 
        increase ? 'manual_restock' : 'usage',
        `${increase ? 'Added' : 'Used'} ${changeAmount} ${item.unit} of ${item.name}`
      );
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    
    // Basic validation
    if (!newItem.name || !newItem.category || newItem.capacity <= 0) {
      alert('Please fill in all required fields');
      return;
    }
    
    const result = await createItem(newItem);
    
    if (result) {
      setShowAddItemModal(false);
      setNewItem({
        name: '',
        category: 'milk',
        amount: 0,
        unit: '',
        capacity: 0
      });
      alert('Item added successfully');
    }
  };

  const handleRequestRestock = async () => {
    if (selectedLowStockItems.length === 0) {
      alert('Please select at least one item to restock');
      return;
    }
    
    const itemsToRestock = selectedLowStockItems.map(itemId => {
      // Find the item by its ID in the items list
      const item = items.find(item => item.id === itemId);
      
      if (!item) {
        console.error(`Cannot find item with ID ${itemId}`);
        return null;
      }
      
      return {
        itemId: item.id,
        amount: item.capacity - item.amount,
        notes: `Restock to full capacity (${item.capacity} ${item.unit})`
      };
    }).filter(Boolean); // Remove any null items
    
    const result = await requestRestock(itemsToRestock);
    
    if (result) {
      setShowRestockModal(false);
      setSelectedLowStockItems([]);
      alert('Restock request submitted successfully');
    }
  };

  const toggleLowStockItem = (itemId) => {
    setSelectedLowStockItems(prev => {
      if (prev.includes(itemId)) {
        return prev.filter(id => id !== itemId);
      } else {
        return [...prev, itemId];
      }
    });
  };

  // Format for stock display
  const formatAmount = (amount, unit) => {
    return `${amount} ${unit}`.trim();
  };

  // Get status color class
  const getStatusColorClass = (status) => {
    switch (status) {
      case 'danger':
        return 'bg-red-400';
      case 'warning':
        return 'bg-yellow-400';
      case 'good':
      default:
        return 'bg-green-400';
    }
  };

  return (
    <div className="p-4">
      {/* Error notification */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline"> {error}</span>
          <button 
            className="absolute top-0 bottom-0 right-0 px-4 py-3"
            onClick={clearError}
          >
            <XCircle size={20} />
          </button>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex space-x-2 mb-4">
        {categories.map(category => (
          <button
            key={category}
            className={`px-4 py-2 rounded-full ${selectedCategory === category ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
            onClick={() => changeCategory(category)}
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
        <button
          className="ml-auto px-4 py-2 rounded-full bg-gray-200 flex items-center"
          onClick={refreshData}
          disabled={loading || isRefreshing}
        >
          <RefreshCw size={16} className={`mr-1 ${(loading || isRefreshing) ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      
      {/* Inventory header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center">
          {selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Inventory
          <span className="text-xs text-gray-500 ml-2">
            Last updated: {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        </h2>
        
        {/* Low stock filter */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id="show-low-stock"
            checked={showLowStockOnly}
            onChange={(e) => setShowLowStockOnly(e.target.checked)}
            className="mr-2"
          />
          <label htmlFor="show-low-stock" className="text-sm text-gray-700">
            Show low stock only
          </label>
        </div>
      </div>
      
      {/* Inventory items */}
      <div className="space-y-4 bg-white rounded-lg shadow-md p-4">
        {loading || isRefreshing ? (
          <div className="flex justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-500"></div>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center p-8 text-gray-500">
            <Package size={32} className="mx-auto mb-2" />
            <p>No {selectedCategory} items found</p>
          </div>
        ) : (
          // Filter items by selected category
          items.filter(item => item.category === selectedCategory).map(item => (
            <div key={item.id} className="flex items-center justify-between mb-4">
              <div className="w-1/4">
                <div className="font-medium">{item.name}</div>
                <div className="text-sm text-gray-500">
                  Available: {formatAmount(item.amount, item.unit)}
                </div>
              </div>
              <div className="w-1/2 bg-gray-200 rounded-full h-5">
                <div 
                  className={`h-5 rounded-full ${getStatusColorClass(item.status)}`}
                  style={{ width: `${Math.min(100, (item.amount / item.capacity) * 100)}%` }}
                ></div>
              </div>
              <div className="w-1/4 flex justify-end space-x-2">
                <button 
                  className="w-10 h-10 bg-gray-200 rounded-md flex items-center justify-center hover:bg-gray-300"
                  onClick={() => handleUpdateQuantity(item, false)}
                  disabled={item.amount <= 0}
                  title="Decrease quantity"
                >
                  <Minus size={16} />
                </button>
                <button 
                  className="w-10 h-10 bg-gray-200 rounded-md flex items-center justify-center hover:bg-gray-300"
                  onClick={() => handleUpdateQuantity(item, true)}
                  disabled={item.amount >= item.capacity}
                  title="Increase quantity"
                >
                  <Plus size={16} />
                </button>
                {item.status === 'danger' && (
                  <button 
                    className="w-10 h-10 bg-red-100 text-red-600 rounded-md flex items-center justify-center hover:bg-red-200"
                    onClick={() => reportLowStock(item.id, 'urgent')}
                    title="Report critically low stock"
                  >
                    <AlertTriangle size={16} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        
        <button 
          className="w-full py-3 bg-gray-200 rounded-md text-gray-600 mt-4 hover:bg-gray-300 flex items-center justify-center"
          onClick={() => setShowAddItemModal(true)}
        >
          <Plus size={16} className="mr-1" />
          Add New {selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Type
        </button>
      </div>
      
      {/* Actions section */}
      <div className="flex space-x-2 mt-6">
        <button 
          className="flex-1 py-3 bg-green-500 text-white rounded-md font-medium hover:bg-green-600 flex items-center justify-center"
          onClick={refreshData}
        >
          <RefreshCw size={16} className="mr-1" />
          Update Inventory
        </button>
        <button 
          className="flex-1 py-3 bg-gray-500 text-white rounded-md font-medium hover:bg-gray-600 flex items-center justify-center"
          onClick={() => setShowRestockModal(true)}
          disabled={lowStockItems.length === 0}
        >
          Request Restocking
          {lowStockItems.length > 0 && (
            <span className="ml-1 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {lowStockItems.length}
            </span>
          )}
        </button>
        {lowStockItems.length > 0 && (
          <button 
            className="flex-1 py-3 bg-red-500 text-white rounded-md font-medium hover:bg-red-600 flex items-center justify-center"
            onClick={() => {
              const allIds = lowStockItems.map(item => item.id);
              const urgentIds = lowStockItems
                .filter(item => item.status === 'danger')
                .map(item => item.id);
                
              if (urgentIds.length > 0) {
                reportLowStock(urgentIds[0], 'urgent', 'Critical stock level');
                alert(`Reported critical stock level for ${urgentIds.length} items`);
              } else {
                reportLowStock(allIds[0], 'normal', 'Low stock alert');
                alert(`Reported low stock for ${allIds.length} items`);
              }
            }}
          >
            <AlertTriangle size={16} className="mr-1" />
            Report Low Stock ({lowStockItems.length})
          </button>
        )}
      </div>

      {/* Add New Item Modal */}
      {showAddItemModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Add New Item</h3>
            <form onSubmit={handleAddItem}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input 
                  type="text" 
                  value={newItem.name}
                  onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                  className="w-full p-2 border rounded"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select 
                  value={newItem.category}
                  onChange={(e) => setNewItem({...newItem, category: e.target.value})}
                  className="w-full p-2 border rounded"
                  required
                >
                  <option value="milk">Milk</option>
                  <option value="coffee">Coffee</option>
                  <option value="cups">Cups</option>
                </select>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit (e.g., L, kg, etc.)
                </label>
                <input 
                  type="text" 
                  value={newItem.unit}
                  onChange={(e) => setNewItem({...newItem, unit: e.target.value})}
                  className="w-full p-2 border rounded"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Amount
                </label>
                <input 
                  type="number" 
                  min="0"
                  step="0.1"
                  value={newItem.amount}
                  onChange={(e) => setNewItem({...newItem, amount: parseFloat(e.target.value)})}
                  className="w-full p-2 border rounded"
                  required
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Capacity
                </label>
                <input 
                  type="number" 
                  min="0.1"
                  step="0.1"
                  value={newItem.capacity}
                  onChange={(e) => setNewItem({...newItem, capacity: parseFloat(e.target.value)})}
                  className="w-full p-2 border rounded"
                  required
                />
              </div>
              
              <div className="flex justify-end space-x-2">
                <button 
                  type="button"
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                  onClick={() => setShowAddItemModal(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Add Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Restock Modal */}
      {showRestockModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Request Restock</h3>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                Select items that need restocking:
              </p>
              <div className="max-h-60 overflow-y-auto p-2 border rounded">
                {lowStockItems.length === 0 ? (
                  <p className="text-center text-gray-500 py-4">No low stock items</p>
                ) : (
                  lowStockItems.map(item => (
                    <div 
                      key={item.id} 
                      className="flex items-center py-2 border-b last:border-b-0"
                    >
                      <input 
                        type="checkbox"
                        checked={selectedLowStockItems.includes(item.id)}
                        onChange={() => toggleLowStockItem(item.id)}
                        className="mr-2"
                      />
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-gray-500">
                          {formatAmount(item.amount, item.unit)} of {formatAmount(item.capacity, item.unit)}
                          <span 
                            className={`ml-2 px-1 py-0.5 rounded text-xs ${
                              item.status === 'danger' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {item.status === 'danger' ? 'Critical' : 'Low'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            <div className="flex justify-end space-x-2">
              <button 
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                onClick={() => setShowRestockModal(false)}
              >
                Cancel
              </button>
              <button 
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center"
                onClick={handleRequestRestock}
                disabled={selectedLowStockItems.length === 0}
              >
                <Check size={16} className="mr-1" />
                Request Restock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockManagementSection;