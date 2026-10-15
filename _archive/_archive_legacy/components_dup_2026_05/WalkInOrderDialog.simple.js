// components/dialogs/WalkInOrderDialog.js - Simplified version that uses actual inventory
import React, { useState, useEffect } from 'react';
import { XCircle, Coffee, Users, Star, AlertTriangle } from 'lucide-react';
import useStations from '../../hooks/useStations';

const WalkInOrderDialog = ({ onSubmit, onClose }) => {
  const { getCurrentStation, stations } = useStations();
  const currentStation = getCurrentStation();
  
  const [availableMilks, setAvailableMilks] = useState([]);
  const [availableCoffeeTypes, setAvailableCoffeeTypes] = useState([]);
  const [availableSizes, setAvailableSizes] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [inventoryError, setInventoryError] = useState(null);
  
  const [orderDetails, setOrderDetails] = useState({
    customerName: '',
    phoneNumber: '',
    coffeeType: '',
    size: '',
    shots: '1',
    milkType: '',
    sugar: 'No sugar',
    extraHot: false,
    priority: false,
    notes: '',
    collectionStation: null
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Load inventory from API
  useEffect(() => {
    const loadInventory = async () => {
      if (!currentStation) return;
      
      setLoadingInventory(true);
      setInventoryError(null);
      
      try {
        console.log(`🔄 Loading inventory for station ${currentStation.id}...`);
        
        const response = await fetch(`http://localhost:5001/api/inventory?station_id=${currentStation.id}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ Inventory loaded:', data);
          
          // Process milks
          const milks = data.items
            .filter(item => item.category === 'milk' && parseFloat(item.amount) > 0)
            .map(item => ({
              id: item.name.toLowerCase().replace(/\s+/g, '_'),
              name: item.name,
              category: item.name.toLowerCase().includes('oat') || 
                       item.name.toLowerCase().includes('almond') || 
                       item.name.toLowerCase().includes('soy') ? 'alternative' : 'standard'
            }));
          
          // Process cups/sizes
          const sizes = data.items
            .filter(item => item.category === 'cups' && parseFloat(item.amount) > 0)
            .map(item => item.name);
          
          // Set basic coffee types (can be made more dynamic later)
          const coffeeTypes = [
            'Espresso', 'Long Black', 'Flat White', 'Cappuccino', 'Latte', 
            'Mocha', 'Hot Chocolate', 'Chai Latte'
          ];
          
          console.log('🥛 Available milks:', milks);
          console.log('☕ Available sizes:', sizes);
          console.log('☕ Coffee types:', coffeeTypes);
          
          setAvailableMilks(milks);
          setAvailableSizes(sizes);
          setAvailableCoffeeTypes(coffeeTypes);
          
          // Set defaults
          if (milks.length > 0 && !orderDetails.milkType) {
            setOrderDetails(prev => ({ ...prev, milkType: milks[0].id }));
          }
          if (sizes.length > 0 && !orderDetails.size) {
            setOrderDetails(prev => ({ ...prev, size: sizes[0] }));
          }
          if (coffeeTypes.length > 0 && !orderDetails.coffeeType) {
            setOrderDetails(prev => ({ ...prev, coffeeType: coffeeTypes[0] }));
          }
          
        } else {
          throw new Error(`Failed to load inventory: ${response.status}`);
        }
      } catch (error) {
        console.error('❌ Error loading inventory:', error);
        setInventoryError('Failed to load station inventory. Using defaults.');
        
        // Set fallback defaults
        setAvailableMilks([{ id: 'full_cream', name: 'Full Cream Milk', category: 'standard' }]);
        setAvailableSizes(['Regular']);
        setAvailableCoffeeTypes(['Flat White', 'Cappuccino', 'Latte']);
      } finally {
        setLoadingInventory(false);
      }
    };
    
    loadInventory();
  }, [currentStation]);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (isSubmitting) {
      console.log('🚫 Already submitting, ignoring duplicate submission');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      console.log('🔄 Submitting walk-in order:', orderDetails);
      
      const orderData = {
        ...orderDetails,
        orderType: 'walk-in',
        station_id: currentStation?.id,
        stationId: currentStation?.id
      };
      
      await onSubmit(orderData);
      
      // Reset form
      setOrderDetails({
        customerName: '',
        phoneNumber: '',
        coffeeType: availableCoffeeTypes[0] || '',
        size: availableSizes[0] || '',
        shots: '1',
        milkType: availableMilks[0]?.id || '',
        sugar: 'No sugar',
        extraHot: false,
        priority: false,
        notes: '',
        collectionStation: null
      });
      
      onClose();
      
    } catch (error) {
      console.error('❌ Failed to submit order:', error);
      alert('Failed to create order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleInputChange = (field, value) => {
    console.log(`🔄 Updating ${field} to:`, value);
    setOrderDetails(prev => ({ ...prev, [field]: value }));
  };
  
  if (loadingInventory) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white p-6 rounded-lg">
          <p>Loading station inventory...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Add Walk-in Order</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <XCircle size={24} />
            </button>
          </div>
          
          {inventoryError && (
            <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
              <AlertTriangle size={16} className="inline mr-2" />
              {inventoryError}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Name *
              </label>
              <input
                type="text"
                value={orderDetails.customerName}
                onChange={(e) => handleInputChange('customerName', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={orderDetails.phoneNumber}
                onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Coffee Type *
              </label>
              <select
                value={orderDetails.coffeeType}
                onChange={(e) => handleInputChange('coffeeType', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select coffee type</option>
                {availableCoffeeTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Size *
              </label>
              <select
                value={orderDetails.size}
                onChange={(e) => handleInputChange('size', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select size</option>
                {availableSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Milk Type *
              </label>
              <select
                value={orderDetails.milkType}
                onChange={(e) => handleInputChange('milkType', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select milk type</option>
                {availableMilks.map((milk) => (
                  <option key={milk.id} value={milk.id}>
                    {milk.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sugar
              </label>
              <select
                value={orderDetails.sugar}
                onChange={(e) => handleInputChange('sugar', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="No sugar">No sugar</option>
                <option value="1 sugar">1 sugar</option>
                <option value="2 sugars">2 sugars</option>
                <option value="3 sugars">3 sugars</option>
                <option value="Sweetener">Sweetener</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Special Notes
              </label>
              <textarea
                value={orderDetails.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows="2"
                placeholder="Any special instructions..."
              />
            </div>
            
            <div className="flex items-center space-x-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={orderDetails.priority}
                  onChange={(e) => handleInputChange('priority', e.target.checked)}
                  className="mr-2"
                />
                <Star size={16} className="mr-1" />
                VIP Priority
              </label>
              
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={orderDetails.extraHot}
                  onChange={(e) => handleInputChange('extraHot', e.target.checked)}
                  className="mr-2"
                />
                Extra Hot
              </label>
            </div>
            
            <div className="flex space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400"
              >
                {isSubmitting ? 'Adding Order...' : 'Add Order'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default WalkInOrderDialog;