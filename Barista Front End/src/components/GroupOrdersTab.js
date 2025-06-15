// components/GroupOrdersTab.js
import React, { useState, useEffect } from 'react';
import { PlusCircle, Trash2, Check, FileText, Coffee, Copy } from 'lucide-react';
import { DEFAULT_MILK_TYPES } from '../utils/milkConfig';

const GroupOrdersTab = ({ onSubmitGroupOrders }) => {
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [notes, setNotes] = useState('');
  const [individualOrders, setIndividualOrders] = useState([]);
  const [newOrder, setNewOrder] = useState({
    name: '',
    coffeeType: 'Flat White',
    size: 'Regular',
    milkType: 'full_cream',
    sugar: 'No sugar',
    extraHot: false,
    notes: ''
  });
  const [savedGroups, setSavedGroups] = useState([]);
  const [showSavedGroups, setShowSavedGroups] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  
  // Load saved groups from localStorage on init
  useEffect(() => {
    try {
      const savedGroupsData = localStorage.getItem('coffee_group_orders');
      if (savedGroupsData) {
        setSavedGroups(JSON.parse(savedGroupsData));
      }
    } catch (err) {
      console.error('Failed to load saved groups:', err);
    }
  }, []);

  // Generate a random code when group name changes
  useEffect(() => {
    if (groupName) {
      // Create a code based on group name prefix + random 4 digits
      const namePrefix = groupName.trim().substring(0, 3).toUpperCase();
      const randomDigits = Math.floor(1000 + Math.random() * 9000);
      setGroupCode(`${namePrefix}-${randomDigits}`);
    }
  }, [groupName]);

  const handleAddIndividualOrder = () => {
    if (!newOrder.name) {
      alert('Please enter a name for this order');
      return;
    }
    
    setIndividualOrders([...individualOrders, { ...newOrder, id: Date.now() }]);
    
    // Reset form for next entry, but keep coffee preferences for faster entry
    setNewOrder({
      ...newOrder,
      name: ''
    });
  };

  const handleRemoveOrder = (orderId) => {
    setIndividualOrders(individualOrders.filter(order => order.id !== orderId));
  };

  const handleCreateGroup = () => {
    if (!groupName) {
      alert('Please enter a group name');
      return;
    }
    
    if (individualOrders.length === 0) {
      alert('Please add at least one coffee order to the group');
      return;
    }
    
    // Create the group object
    const groupOrder = {
      id: Date.now(),
      groupName,
      groupCode,
      notes,
      orders: individualOrders,
      createdAt: new Date().toISOString()
    };
    
    // Save to local storage
    try {
      const updatedGroups = [...savedGroups, groupOrder];
      localStorage.setItem('coffee_group_orders', JSON.stringify(updatedGroups));
      setSavedGroups(updatedGroups);
      
      // Show confirmation and clear form
      alert(`Group "${groupName}" created with code ${groupCode}`);
      setGroupName('');
      setGroupCode('');
      setNotes('');
      setIndividualOrders([]);
    } catch (err) {
      console.error('Failed to save group order:', err);
      alert('Failed to save group order. Please try again.');
    }
  };

  const handleSubmitGroupToBarista = (group) => {
    if (onSubmitGroupOrders) {
      onSubmitGroupOrders(group);
      alert(`Group "${group.groupName}" has been sent to the barista queue!`);
    }
  };

  const handleDeleteGroup = (groupId) => {
    if (window.confirm('Are you sure you want to delete this group?')) {
      const updatedGroups = savedGroups.filter(group => group.id !== groupId);
      localStorage.setItem('coffee_group_orders', JSON.stringify(updatedGroups));
      setSavedGroups(updatedGroups);
    }
  };

  const copyGroupCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(code);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  return (
    <div className="p-4">
      <div className="flex justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Group Orders</h2>
        <div>
          <button 
            className={`px-4 py-2 rounded-md ${showSavedGroups ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            onClick={() => setShowSavedGroups(!showSavedGroups)}
          >
            {showSavedGroups ? 'Create New Group' : 'View Saved Groups'}
          </button>
        </div>
      </div>
      
      {!showSavedGroups ? (
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Group Name*
              </label>
              <input 
                type="text" 
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full p-2 border rounded"
                placeholder="e.g. Marketing Team, Room 101"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Group Code (auto-generated)
              </label>
              <div className="flex">
                <input 
                  type="text" 
                  value={groupCode}
                  onChange={(e) => setGroupCode(e.target.value)}
                  className="w-full p-2 border rounded-l"
                  placeholder="Code will be generated"
                  readOnly
                />
                <button 
                  className="bg-gray-200 px-3 rounded-r border-y border-r"
                  onClick={() => copyGroupCode(groupCode)}
                  title="Copy code"
                >
                  {codeCopied === groupCode ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                This code can be used by members to reference the group order.
              </p>
            </div>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Group Notes (optional)
            </label>
            <textarea 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2 border rounded"
              rows="2"
              placeholder="e.g. Break time at 10:30am, Priority group, etc."
            ></textarea>
          </div>
          
          <hr className="my-4" />
          
          <h3 className="text-lg font-semibold mb-3">Individual Orders</h3>
          
          <div className="bg-gray-50 p-3 rounded-lg mb-4">
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name*
                </label>
                <input 
                  type="text" 
                  value={newOrder.name}
                  onChange={(e) => setNewOrder({...newOrder, name: e.target.value})}
                  className="w-full p-2 border rounded"
                  placeholder="Person's name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Size
                </label>
                <select 
                  value={newOrder.size}
                  onChange={(e) => setNewOrder({...newOrder, size: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <option value="Small">Small</option>
                  <option value="Regular">Regular</option>
                  <option value="Large">Large</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Coffee Type*
                </label>
                <select 
                  value={newOrder.coffeeType}
                  onChange={(e) => setNewOrder({...newOrder, coffeeType: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <option value="Espresso">Espresso</option>
                  <option value="Long Black">Long Black</option>
                  <option value="Flat White">Flat White</option>
                  <option value="Cappuccino">Cappuccino</option>
                  <option value="Latte">Latte</option>
                  <option value="Mocha">Mocha</option>
                  <option value="Hot Chocolate">Hot Chocolate</option>
                  <option value="Chai Latte">Chai Latte</option>
                  <option value="Tea">Tea</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Milk Type
                </label>
                <select 
                  value={newOrder.milkType}
                  onChange={(e) => setNewOrder({...newOrder, milkType: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <optgroup label="Standard Milks">
                    {DEFAULT_MILK_TYPES
                      .filter(milk => milk.category === 'standard')
                      .map(milk => (
                        <option key={milk.id} value={milk.id}>
                          {milk.name}
                          {milk.properties.lactoseFree ? ' (Lactose-Free)' : ''}
                          {milk.properties.lowFat ? ' (Low-Fat)' : ''}
                        </option>
                      ))
                    }
                  </optgroup>
                  <optgroup label="Alternative Milks">
                    {DEFAULT_MILK_TYPES
                      .filter(milk => milk.category === 'alternative')
                      .map(milk => (
                        <option key={milk.id} value={milk.id}>
                          {milk.name}
                          {milk.properties.vegan ? ' (Vegan)' : ''}
                        </option>
                      ))
                    }
                  </optgroup>
                  <option value="no_milk">No milk</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sugar
                </label>
                <select 
                  value={newOrder.sugar}
                  onChange={(e) => setNewOrder({...newOrder, sugar: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <option value="No sugar">No sugar</option>
                  <option value="1 sugar">1 sugar</option>
                  <option value="2 sugars">2 sugars</option>
                  <option value="3 sugars">3 sugars</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Additional Notes
                </label>
                <input 
                  type="text" 
                  value={newOrder.notes}
                  onChange={(e) => setNewOrder({...newOrder, notes: e.target.value})}
                  className="w-full p-2 border rounded"
                  placeholder="e.g. extra hot, decaf, etc."
                />
              </div>
            </div>
            
            <div className="flex items-center mb-2">
              <input 
                type="checkbox" 
                id="extraHot"
                checked={newOrder.extraHot}
                onChange={(e) => setNewOrder({...newOrder, extraHot: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="extraHot" className="text-sm text-gray-700">Extra hot</label>
            </div>
            
            <button 
              className="w-full p-2 flex items-center justify-center bg-green-600 text-white rounded-md hover:bg-green-700"
              onClick={handleAddIndividualOrder}
            >
              <PlusCircle size={18} className="mr-2" />
              Add Coffee Order
            </button>
          </div>
          
          {individualOrders.length > 0 && (
            <>
              <h3 className="text-md font-medium mb-2">Orders in this group: {individualOrders.length}</h3>
              <div className="bg-gray-50 rounded-lg p-3 mb-4 max-h-60 overflow-y-auto">
                {individualOrders.map((order, index) => (
                  <div key={order.id} className="flex items-center justify-between p-2 border-b last:border-b-0">
                    <div className="flex items-center">
                      <Coffee size={16} className="mr-2 text-amber-600" />
                      <div>
                        <span className="font-medium">{order.name}</span>
                        <span className="text-sm text-gray-600 ml-2">
                          {order.size} {order.coffeeType}, 
                          {DEFAULT_MILK_TYPES.find(m => m.id === order.milkType)?.name || order.milkType}, 
                          {order.sugar}
                          {order.extraHot ? ', Extra Hot' : ''}
                          {order.notes ? `, ${order.notes}` : ''}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveOrder(order.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              
              <button 
                className="w-full p-3 mt-4 bg-amber-600 text-white rounded-md hover:bg-amber-700 flex items-center justify-center"
                onClick={handleCreateGroup}
              >
                <FileText size={18} className="mr-2" />
                Save Group Order ({individualOrders.length} coffees)
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md p-4">
          <h3 className="text-xl font-semibold mb-4">Saved Group Orders</h3>
          
          {savedGroups.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No saved group orders yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {savedGroups.map(group => (
                <div key={group.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="text-lg font-medium">{group.groupName}</h4>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                          Code: {group.groupCode}
                        </span>
                        <button 
                          onClick={() => copyGroupCode(group.groupCode)}
                          className="text-gray-500 hover:text-gray-700"
                          title="Copy code"
                        >
                          {codeCopied === group.groupCode ? 
                            <Check size={16} className="text-green-600" /> : 
                            <Copy size={16} />
                          }
                        </button>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button 
                        className="px-3 py-1 bg-amber-600 text-white rounded-md hover:bg-amber-700 text-sm flex items-center"
                        onClick={() => handleSubmitGroupToBarista(group)}
                      >
                        <Coffee size={14} className="mr-1" />
                        Send to Barista
                      </button>
                      <button 
                        className="px-3 py-1 bg-red-100 text-red-600 rounded-md hover:bg-red-200 text-sm"
                        onClick={() => handleDeleteGroup(group.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-2">
                    Created: {new Date(group.createdAt).toLocaleString()}
                  </div>
                  
                  {group.notes && (
                    <div className="text-sm bg-yellow-50 p-2 rounded mb-2">
                      Notes: {group.notes}
                    </div>
                  )}
                  
                  <div className="mt-2">
                    <div className="text-sm font-medium">
                      {group.orders.length} {group.orders.length === 1 ? 'coffee' : 'coffees'} in this group
                    </div>
                    <div className="mt-1 max-h-32 overflow-y-auto">
                      {group.orders.map((order, idx) => (
                        <div key={idx} className="text-sm p-1 border-b last:border-b-0">
                          <span className="font-medium">{order.name}</span>:&nbsp;
                          <span className="text-gray-600">
                            {order.size} {order.coffeeType}, 
                            {DEFAULT_MILK_TYPES.find(m => m.id === order.milkType)?.name || order.milkType}, 
                            {order.sugar}
                            {order.extraHot ? ', Extra Hot' : ''}
                            {order.notes ? `, ${order.notes}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GroupOrdersTab;