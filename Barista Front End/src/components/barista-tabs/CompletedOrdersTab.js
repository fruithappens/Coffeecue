// CompletedOrdersTab.js
import React from 'react';
import { Search } from 'lucide-react';

const CompletedOrdersTab = ({
  historyTab,
  setHistoryTab,
  searchTerm,
  setSearchTerm,
  searchOrders,
  completedOrders,
  previousOrders,
  yesterdayOrders,
  thisWeekOrders,
  searchResults,
  loading,
  renderCompletedOrder,
  renderPreviousOrder
}) => {
  return (
    <div>
      <div className="bg-white rounded-lg shadow-md p-4 mb-4">
        <h2 className="text-xl font-bold mb-3">Completed Orders</h2>
        <div className="flex space-x-2 mb-4">
          <button 
            className={`${historyTab === 'completed' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
            onClick={() => setHistoryTab('completed')}
          >
            Today
          </button>
          <button 
            className={`${historyTab === 'yesterday' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
            onClick={() => {
              setHistoryTab('yesterday');
              // Call the API to get yesterday's orders if not already loaded
              if (yesterdayOrders.length === 0 && !loading) {
                fetchYesterdayOrders();
              }
            }}
          >
            Yesterday
          </button>
          <button 
            className={`${historyTab === 'thisWeek' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full`}
            onClick={() => {
              setHistoryTab('thisWeek');
              // Call the API to get this week's orders if not already loaded
              if (thisWeekOrders.length === 0 && !loading) {
                fetchThisWeekOrders();
              }
            }}
          >
            This Week
          </button>
          <button 
            className={`${historyTab === 'search' ? 'bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300'} px-6 py-2 rounded-full ml-auto`}
            onClick={() => setHistoryTab('search')}
          >
            Search Orders
          </button>
        </div>
        
        {/* Search Box - Only shown when search tab is active */}
        {historyTab === 'search' && (
          <div className="mb-4">
            <div className="flex">
              <input
                type="text"
                placeholder="Search by customer name, order number, or coffee type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 p-2 border rounded-l-md"
              />
              <button
                className="bg-amber-600 text-white px-4 py-2 rounded-r-md"
                onClick={() => searchOrders(searchTerm)}
              >
                Search
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Content based on active history tab */}
      {historyTab === 'completed' && (
        <>
          <h3 className="text-xl font-bold mb-3 ml-2">Ready for Pickup</h3>
          <div className="space-y-2 mb-6">
            {completedOrders.length > 0 ? (
              completedOrders.map(order => renderCompletedOrder(order))
            ) : (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                <p>No orders ready for pickup</p>
              </div>
            )}
          </div>
          
          <h3 className="text-xl font-bold mb-3 ml-2">Previously Completed</h3>
          <div className="space-y-2">
            {previousOrders.length > 0 ? (
              previousOrders.map(order => renderPreviousOrder(order))
            ) : (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                <p>No previous orders to display</p>
              </div>
            )}
          </div>
        </>
      )}
      
      {historyTab === 'yesterday' && (
        <>
          <h3 className="text-xl font-bold mb-3 ml-2">Yesterday's Orders</h3>
          <div className="space-y-2">
            {loading ? (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                <p className="text-gray-500">Loading yesterday's orders...</p>
              </div>
            ) : yesterdayOrders.length > 0 ? (
              yesterdayOrders.map(order => renderPreviousOrder(order))
            ) : (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                <p>No orders from yesterday</p>
              </div>
            )}
          </div>
        </>
      )}
      
      {historyTab === 'thisWeek' && (
        <>
          <h3 className="text-xl font-bold mb-3 ml-2">This Week's Orders</h3>
          <div className="space-y-2">
            {loading ? (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                <p className="text-gray-500">Loading this week's orders...</p>
              </div>
            ) : thisWeekOrders.length > 0 ? (
              thisWeekOrders.map(order => renderPreviousOrder(order))
            ) : (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                <p>No orders from this week</p>
              </div>
            )}
          </div>
        </>
      )}
      
      {historyTab === 'search' && (
        <>
          <h3 className="text-xl font-bold mb-3 ml-2">Search Results</h3>
          <div className="space-y-2">
            {loading ? (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-2"></div>
                <p className="text-gray-500">Searching orders...</p>
              </div>
            ) : searchResults.length > 0 ? (
              searchResults.map(order => renderPreviousOrder(order))
            ) : (
              <div className="text-center py-6 bg-white rounded-lg shadow-sm text-gray-500">
                <p>No matching orders found</p>
                <p className="text-sm text-gray-400">Try a different search term</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CompletedOrdersTab;