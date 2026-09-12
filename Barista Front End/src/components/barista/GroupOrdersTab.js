// components/GroupOrdersTab.js
import React, { useState, useEffect } from 'react';
import { PlusCircle, Trash2, Check, FileText, Coffee, Copy } from 'lucide-react';
import { DEFAULT_MILK_TYPES } from '../../utils/milkConfig';
import useCatalog from '../../hooks/useCatalog';
import { askConfirm } from '../shared/ConfirmDialog';
import { showToast } from '../shared/Toast';

const GroupOrdersTab = ({ onSubmitGroupOrders }) => {
  // Canonical milk list from /api/catalog/milk. Falls back to
  // DEFAULT_MILK_TYPES if catalog unreachable. Same pattern as
  // StationDefaults — see catalog architecture in
  // CLAUDE_ONBOARDING.md.
  const { items: catalogMilksRaw } = useCatalog('milk');
  const milkOptions = (Array.isArray(catalogMilksRaw) && catalogMilksRaw.length > 0)
    ? catalogMilksRaw.map(c => ({
        id: c.id,
        name: c.name,
        category: c.subcategory || 'standard',
        properties: {
          lactoseFree: !!c.properties?.lactoseFree,
          vegan: !!c.properties?.vegan,
        },
      }))
    : DEFAULT_MILK_TYPES;

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
      showToast('Enter a name for this order first', 'warning');
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
      showToast('Give the group a name first', 'warning');
      return;
    }
    
    if (individualOrders.length === 0) {
      showToast('Add at least one coffee to the group first', 'warning');
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
      showToast(`Group "${groupName}" created — code ${groupCode}`, 'success', 5000);
      setGroupName('');
      setGroupCode('');
      setNotes('');
      setIndividualOrders([]);
    } catch (err) {
      console.error('Failed to save group order:', err);
      showToast('Could not save the group order — try again', 'error');
    }
  };

  const handleSubmitGroupToBarista = (group) => {
    if (onSubmitGroupOrders) {
      onSubmitGroupOrders(group);
      showToast(`Group "${group.groupName}" sent to the barista queue`, 'success');
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (await askConfirm({ title: 'Delete this group?', message: 'The saved group and its coffees are removed from this device.', confirmLabel: 'Delete', danger: true })) {
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
        <h2 className="text-2xl font-bold text-cq-roast">Group Orders</h2>
        <div>
          <button 
            className={`px-4 py-2 rounded-md ${showSavedGroups ? 'bg-cq-roast text-white' : 'bg-cq-wash text-cq-ink-2'}`}
            onClick={() => setShowSavedGroups(!showSavedGroups)}
          >
            {showSavedGroups ? 'Create New Group' : 'View Saved Groups'}
          </button>
        </div>
      </div>
      
      {!showSavedGroups ? (
        <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                Group Name*
              </label>
              <input 
                type="text" 
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                placeholder="e.g. Marketing Team, Room 101"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                Group Code (auto-generated)
              </label>
              <div className="flex">
                <input 
                  type="text" 
                  value={groupCode}
                  onChange={(e) => setGroupCode(e.target.value)}
                  className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                  placeholder="Code will be generated"
                  readOnly
                />
                <button 
                  className="bg-cq-wash px-3 rounded-r border-y border-r"
                  onClick={() => copyGroupCode(groupCode)}
                  title="Copy code"
                >
                  {codeCopied === groupCode ? <Check size={18} className="text-cq-ready" /> : <Copy size={18} />}
                </button>
              </div>
              <p className="text-xs text-cq-ink-3 mt-1">
                This code can be used by members to reference the group order.
              </p>
            </div>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-cq-ink-2 mb-1">
              Group Notes (optional)
            </label>
            <textarea 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
              rows="2"
              placeholder="e.g. Break time at 10:30am, Priority group, etc."
            ></textarea>
          </div>
          
          <hr className="my-4" />
          
          <h3 className="text-lg font-semibold mb-3">Individual Orders</h3>
          
          <div className="bg-cq-wash p-3 rounded-cq-md mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                  Name*
                </label>
                <input 
                  type="text" 
                  value={newOrder.name}
                  onChange={(e) => setNewOrder({...newOrder, name: e.target.value})}
                  className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                  placeholder="Person's name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                  Size
                </label>
                <select 
                  value={newOrder.size}
                  onChange={(e) => setNewOrder({...newOrder, size: e.target.value})}
                  className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                >
                  <option value="Small">Small</option>
                  <option value="Regular">Regular</option>
                  <option value="Large">Large</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                  Coffee Type*
                </label>
                <select 
                  value={newOrder.coffeeType}
                  onChange={(e) => setNewOrder({...newOrder, coffeeType: e.target.value})}
                  className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
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
                <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                  Milk Type
                </label>
                <select 
                  value={newOrder.milkType}
                  onChange={(e) => setNewOrder({...newOrder, milkType: e.target.value})}
                  className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                >
                  <optgroup label="Standard Milks">
                    {milkOptions
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
                    {milkOptions
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
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
              <div>
                <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                  Sugar
                </label>
                <select 
                  value={newOrder.sugar}
                  onChange={(e) => setNewOrder({...newOrder, sugar: e.target.value})}
                  className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                >
                  <option value="No sugar">No sugar</option>
                  <option value="1 sugar">1 sugar</option>
                  <option value="2 sugars">2 sugars</option>
                  <option value="3 sugars">3 sugars</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                  Additional Notes
                </label>
                <input 
                  type="text" 
                  value={newOrder.notes}
                  onChange={(e) => setNewOrder({...newOrder, notes: e.target.value})}
                  className="w-full p-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                  placeholder="e.g. extra hot, decaf, etc."
                />
              </div>
            </div>
            
            <div className="flex items-center mb-2">
              <input 
                type="checkbox" className="w-[18px] h-[18px] rounded-cq-sm border-2 border-cq-line accent-cq-caramel cursor-pointer" 
                id="extraHot"
                checked={newOrder.extraHot}
                onChange={(e) => setNewOrder({...newOrder, extraHot: e.target.checked})}
                className="mr-2 w-[18px] h-[18px] rounded-cq-sm border-2 border-cq-line accent-cq-caramel cursor-pointer"
              />
              <label htmlFor="extraHot" className="text-sm text-cq-ink-2">Extra hot</label>
            </div>
            
            <button 
              className="w-full p-2 flex items-center justify-center bg-cq-ready text-white rounded-md hover:opacity-90"
              onClick={handleAddIndividualOrder}
            >
              <PlusCircle size={18} className="mr-2 w-[18px] h-[18px] rounded-cq-sm border-2 border-cq-line accent-cq-caramel cursor-pointer" />
              Add Coffee Order
            </button>
          </div>
          
          {individualOrders.length > 0 && (
            <>
              <h3 className="text-md font-medium mb-2">Orders in this group: {individualOrders.length}</h3>
              <div className="bg-cq-wash rounded-cq-md p-3 mb-4 max-h-60 overflow-y-auto">
                {individualOrders.map((order, index) => (
                  <div key={order.id} className="flex items-center justify-between p-2 border-b last:border-b-0">
                    <div className="flex items-center">
                      <Coffee size={16} className="mr-2 text-cq-caramel" />
                      <div>
                        <span className="font-medium">{order.name}</span>
                        <span className="text-sm text-cq-ink-2 ml-2">
                          {order.size} {order.coffeeType}, 
                          {milkOptions.find(m => m.id === order.milkType)?.name || order.milkType}, 
                          {order.sugar}
                          {order.extraHot ? ', Extra Hot' : ''}
                          {order.notes ? `, ${order.notes}` : ''}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveOrder(order.id)}
                      className="text-cq-alert hover:text-cq-alert"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              
              <button 
                className="w-full p-3 mt-4 bg-cq-roast text-white rounded-md hover:bg-cq-caramel-deep flex items-center justify-center"
                onClick={handleCreateGroup}
              >
                <FileText size={18} className="mr-2 w-[18px] h-[18px] rounded-cq-sm border-2 border-cq-line accent-cq-caramel cursor-pointer" />
                Save Group Order ({individualOrders.length} coffees)
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4">
          <h3 className="text-xl font-semibold mb-4">Saved Group Orders</h3>
          
          {savedGroups.length === 0 ? (
            <p className="text-cq-ink-3 text-center py-8">No saved group orders yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {savedGroups.map(group => (
                <div key={group.id} className="border-2 border-cq-line rounded-cq-md bg-cq-milk p-4 hover:shadow-cq-card transition-shadow">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="text-lg font-medium">{group.groupName}</h4>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-sm bg-cq-wash px-2 py-1 rounded">
                          Code: {group.groupCode}
                        </span>
                        <button 
                          onClick={() => copyGroupCode(group.groupCode)}
                          className="text-cq-ink-3 hover:text-cq-ink-2"
                          title="Copy code"
                        >
                          {codeCopied === group.groupCode ? 
                            <Check size={16} className="text-cq-ready" /> : 
                            <Copy size={16} />
                          }
                        </button>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button 
                        className="px-3 py-1 bg-cq-roast text-white rounded-md hover:bg-cq-caramel-deep text-sm flex items-center"
                        onClick={() => handleSubmitGroupToBarista(group)}
                      >
                        <Coffee size={14} className="mr-1" />
                        Send to Barista
                      </button>
                      <button 
                        className="px-3 py-1 bg-cq-alert-wash text-cq-alert rounded-md hover:bg-cq-alert-wash text-sm"
                        onClick={() => handleDeleteGroup(group.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  
                  <div className="text-sm text-cq-ink-2 mb-2">
                    Created: {new Date(group.createdAt).toLocaleString()}
                  </div>
                  
                  {group.notes && (
                    <div className="text-sm bg-cq-warn-wash p-2 rounded mb-2">
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
                          <span className="text-cq-ink-2">
                            {order.size} {order.coffeeType}, 
                            {milkOptions.find(m => m.id === order.milkType)?.name || order.milkType}, 
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