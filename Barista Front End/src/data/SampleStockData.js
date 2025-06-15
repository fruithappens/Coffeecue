// data/sampleStockData.js
// Sample stock data for offline mode and development

const sampleStockData = {
  // Combined data for all stations
  allStations: {
    milk: [
      { id: 1, name: 'Full Cream', amount: 4, unit: 'L', capacity: 5, status: 'good' },
      { id: 2, name: 'Skim', amount: 1.5, unit: 'L', capacity: 5, status: 'warning' },
      { id: 3, name: 'Soy', amount: 0.5, unit: 'L', capacity: 5, status: 'danger' },
      { id: 4, name: 'Almond', amount: 2, unit: 'L', capacity: 5, status: 'good' },
      { id: 5, name: 'Oat', amount: 3, unit: 'L', capacity: 5, status: 'good' }
    ],
    coffee: [
      { id: 1, name: 'House Blend', amount: 1.2, unit: 'kg', capacity: 2, status: 'warning' },
      { id: 2, name: 'Single Origin', amount: 0.8, unit: 'kg', capacity: 2, status: 'warning' }
    ],
    cups: [
      { id: 1, name: 'Small', amount: 45, unit: '', capacity: 50, status: 'good' },
      { id: 2, name: 'Regular', amount: 37, unit: '', capacity: 100, status: 'good' },
      { id: 3, name: 'Large', amount: 12, unit: '', capacity: 50, status: 'warning' }
    ]
  },
  
  // Individual station data
  stations: {
    1: {
      milk: [
        { id: 1, name: 'Full Cream', amount: 4, unit: 'L', capacity: 5, status: 'good' },
        { id: 2, name: 'Skim', amount: 1.5, unit: 'L', capacity: 5, status: 'warning' },
        { id: 3, name: 'Soy', amount: 0.5, unit: 'L', capacity: 5, status: 'danger' },
        { id: 4, name: 'Almond', amount: 2, unit: 'L', capacity: 5, status: 'good' },
        { id: 5, name: 'Oat', amount: 3, unit: 'L', capacity: 5, status: 'good' }
      ],
      coffee: [
        { id: 1, name: 'House Blend', amount: 1.2, unit: 'kg', capacity: 2, status: 'warning' }
      ],
      cups: [
        { id: 1, name: 'Small', amount: 45, unit: '', capacity: 50, status: 'good' },
        { id: 2, name: 'Regular', amount: 37, unit: '', capacity: 100, status: 'good' },
        { id: 3, name: 'Large', amount: 12, unit: '', capacity: 50, status: 'warning' }
      ]
    },
    2: {
      milk: [
        { id: 1, name: 'Full Cream', amount: 3.5, unit: 'L', capacity: 5, status: 'good' },
        { id: 2, name: 'Skim', amount: 2.0, unit: 'L', capacity: 5, status: 'good' },
        { id: 3, name: 'Soy', amount: 1.2, unit: 'L', capacity: 5, status: 'warning' },
        { id: 4, name: 'Almond', amount: 0.6, unit: 'L', capacity: 5, status: 'danger' },
        { id: 5, name: 'Oat', amount: 0.8, unit: 'L', capacity: 5, status: 'danger' }
      ],
      coffee: [
        { id: 1, name: 'House Blend', amount: 0.9, unit: 'kg', capacity: 2, status: 'warning' },
        { id: 2, name: 'Single Origin', amount: 0.5, unit: 'kg', capacity: 2, status: 'danger' }
      ],
      cups: [
        { id: 1, name: 'Small', amount: 32, unit: '', capacity: 50, status: 'good' },
        { id: 2, name: 'Regular', amount: 55, unit: '', capacity: 100, status: 'good' },
        { id: 3, name: 'Large', amount: 8, unit: '', capacity: 50, status: 'danger' }
      ]
    },
    3: {
      milk: [
        { id: 1, name: 'Full Cream', amount: 4.5, unit: 'L', capacity: 5, status: 'good' },
        { id: 2, name: 'Skim', amount: 3.2, unit: 'L', capacity: 5, status: 'good' },
        { id: 3, name: 'Soy', amount: 2.2, unit: 'L', capacity: 5, status: 'good' },
        { id: 4, name: 'Almond', amount: 3.5, unit: 'L', capacity: 5, status: 'good' },
        { id: 5, name: 'Oat', amount: 2.8, unit: 'L', capacity: 5, status: 'good' }
      ],
      coffee: [
        { id: 1, name: 'House Blend', amount: 1.7, unit: 'kg', capacity: 2, status: 'good' },
        { id: 2, name: 'Single Origin', amount: 1.2, unit: 'kg', capacity: 2, status: 'good' }
      ],
      cups: [
        { id: 1, name: 'Small', amount: 42, unit: '', capacity: 50, status: 'good' },
        { id: 2, name: 'Regular', amount: 85, unit: '', capacity: 100, status: 'good' },
        { id: 3, name: 'Large', amount: 28, unit: '', capacity: 50, status: 'good' }
      ]
    }
  }
};

export default sampleStockData;
