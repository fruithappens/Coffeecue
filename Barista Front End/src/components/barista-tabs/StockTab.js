// StockTab.js
import React from 'react';
import { Package } from 'lucide-react';

// StockItem component for the StockTab
const StockItem = ({ item, category, updateStockItem, deleteStockItem, addStockItem }) => {
  // Stock item implementation would go here
  // This is a placeholder for now, would need to be extracted from BaristaInterface.js
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 flex justify-between items-center">
      <div>
        <h3 className="font-medium">{item.name}</h3>
        <div className="text-sm text-gray-600">
          {item.amount} / {item.capacity} {item.unit}
        </div>
      </div>
      <div className="flex gap-2">
        {/* Stock controls would go here */}
      </div>
    </div>
  );
};

// DismissibleInfoPanel component for info panels
const DismissibleInfoPanel = ({ id, title, message, borderColor, bgColor, isDismissed, onDismiss, extraContent }) => {
  if (isDismissed) return null;
  
  return (
    <div className={`mb-4 rounded-lg shadow-md p-4 border-l-4 border-${borderColor}-500 bg-${bgColor}-50`}>
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="text-gray-700">{message}</p>
          {extraContent}
        </div>
        <button 
          className="text-gray-400 hover:text-gray-600" 
          onClick={() => onDismiss(id)}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

const StockTab = ({ 
  dismissedPanels,
  dismissPanel,
  lowCount,
  criticalCount,
  stockCategories,
  selectedStockCategory,
  setSelectedStockCategory,
  stockLoading,
  getCategoryStock,
  updateStockItem,
  addStockItem,
  deleteStockItem,
  resetStock
}) => {
  return (
    <div className="p-4">
      {/* Local Stock Management Information */}
      <DismissibleInfoPanel
        id="stockInfoPanel"
        title="Station-Specific Inventory Management"
        message="This station's inventory is saved locally. Each station manages its own inventory independently."
        borderColor="green"
        bgColor="green"
        isDismissed={dismissedPanels.stockInfoPanel}
        onDismiss={dismissPanel}
        extraContent={
          (lowCount > 0 || criticalCount > 0) && (
            <p className="font-medium">
              {criticalCount > 0 && <span className="text-red-600 mr-2">Critical: {criticalCount} items</span>}
              {lowCount > 0 && <span className="text-yellow-600">Low: {lowCount} items</span>}
            </p>
          )
        }
      />
      
      {/* Category Selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {stockCategories.map(category => (
          <button
            key={category}
            className={`px-4 py-2 rounded-full ${selectedStockCategory === category ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
            onClick={() => setSelectedStockCategory(category)}
          >
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Stock Items */}
      <h2 className="text-xl font-bold mb-4 flex items-center justify-between">
        <span>{selectedStockCategory.charAt(0).toUpperCase() + selectedStockCategory.slice(1)} Inventory</span>
        
        {/* Add New Item button - Inline for better accessibility */}
        <button 
          className="px-4 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600"
          onClick={() => {
            // Prompt for new item details
            const name = prompt(`Enter new ${selectedStockCategory} item name:`);
            if (name) {
              const capacity = parseFloat(prompt(`Enter capacity (maximum amount) for ${name}:`, "10"));
              if (!isNaN(capacity) && capacity > 0) {
                const unit = prompt(`Enter unit of measurement (e.g., L, kg, pcs):`, 
                  selectedStockCategory === 'milk' || selectedStockCategory === 'syrups' ? 'L' : 
                  selectedStockCategory === 'coffee' ? 'kg' : 'pcs');
                
                if (unit) {
                  // Add the new item
                  addStockItem(selectedStockCategory, {
                    name,
                    amount: capacity, // Start with full capacity
                    capacity,
                    unit,
                    status: 'good',
                    lowThreshold: capacity * 0.25, // 25% of capacity
                    criticalThreshold: capacity * 0.1 // 10% of capacity
                  });
                }
              }
            }
          }}
        >
          + Add New Item
        </button>
      </h2>
      
      <div className="space-y-4 bg-white rounded-lg shadow-md p-4">
        {stockLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-500"></div>
          </div>
        ) : getCategoryStock(selectedStockCategory).length > 0 ? (
          getCategoryStock(selectedStockCategory).map(item => (
            <StockItem 
              key={item.id}
              item={item} 
              category={selectedStockCategory}
              updateStockItem={updateStockItem}
              deleteStockItem={deleteStockItem}
              addStockItem={addStockItem}
            />
          ))
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Package size={48} className="mx-auto mb-2 text-gray-400" />
            <p>No {selectedStockCategory} items found</p>
            <p className="text-sm text-gray-400">Click the 'Add New Item' button to add stock items</p>
          </div>
        )}
      </div>
      
      {/* Stock Action Buttons */}
      <div className="flex flex-wrap gap-2 mt-6">
        <button 
          className="flex-1 py-3 bg-green-500 text-white rounded-md font-medium hover:bg-green-600"
          onClick={() => {
            // Show confirmation message in alert and proceed if user enters "yes"
            const userConfirmed = window.prompt(`Type 'yes' to confirm restocking all ${selectedStockCategory} items to full capacity:`) === 'yes';
            
            if (userConfirmed) {
              // Get all items in the current category
              const items = getCategoryStock(selectedStockCategory);
              // Update each item to full capacity
              items.forEach(item => {
                updateStockItem(selectedStockCategory, item.id, item.capacity);
              });
            }
          }}
        >
          Restock All to Full
        </button>
        
        <button 
          className="flex-1 py-3 bg-gray-500 text-white rounded-md font-medium hover:bg-gray-600"
          onClick={() => {
            // Prompt for item selection to delete
            const items = getCategoryStock(selectedStockCategory);
            if (items.length === 0) {
              alert(`No ${selectedStockCategory} items to delete`);
              return;
            }
            
            // Create item options as a numbered list
            let message = `Select item to delete:\n`;
            items.forEach((item, index) => {
              message += `${index + 1}. ${item.name}\n`;
            });
            
            // Get selection
            const selection = prompt(message);
            if (selection) {
              const index = parseInt(selection, 10) - 1;
              if (!isNaN(index) && index >= 0 && index < items.length) {
                const item = items[index];
                // Ask for confirmation using prompt instead of confirm
                const deleteConfirmed = window.prompt(`Type 'yes' to confirm deleting ${item.name}:`) === 'yes';
                if (deleteConfirmed) {
                  deleteStockItem(selectedStockCategory, item.id);
                }
              } else {
                alert('Invalid selection');
              }
            }
          }}
        >
          Delete Item
        </button>
        
        <button 
          className="flex-1 py-3 bg-red-500 text-white rounded-md font-medium hover:bg-red-600"
          onClick={() => {
            // Ask for confirmation using prompt instead of confirm
            const resetConfirmed = window.prompt('Type \'yes\' to reset all stock to default values. This cannot be undone:') === 'yes';
            if (resetConfirmed) {
              resetStock();
            }
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
};

export default StockTab;