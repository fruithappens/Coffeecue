// src/TailwindTest.js
import React from 'react';

const TailwindTest = () => {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-amber-800 mb-4">Tailwind CSS Test</h1>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-amber-100 p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-amber-700">Amber Colors Working</h2>
          <p className="text-amber-600 mt-2">If this text is amber, tailwind is working correctly!</p>
        </div>
        
        <div className="bg-blue-100 p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-blue-700">Blue Box Working</h2>
          <p className="text-blue-600 mt-2">If this background is blue, tailwind is working correctly!</p>
        </div>
      </div>
      
      <button className="mt-4 bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded transition duration-300">
        Working Button
      </button>
    </div>
  );
};

export default TailwindTest;