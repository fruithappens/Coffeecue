import React, { useState, useEffect } from 'react';
import { 
  Coffee, Plus, Minus, Edit2, Save, X, Search, 
  ChevronDown, ChevronRight, Info, Settings,
  CheckCircle, Circle, Trash2, Copy, Globe, Monitor
} from 'lucide-react';
import useStations from '../hooks/useStations';

// Menu version for auto-updates
const MENU_VERSION = "2.0";

// Default coffee menu with all common types
const defaultCoffeeMenu = {
  // Espresso-Based Drinks
  "espresso": {
    id: "espresso",
    name: "Espresso",
    category: "espresso-based",
    enabled: true,
    description: "Single or double shot of concentrated coffee",
    requiresMilk: false,
    sizes: {
      "single": {
        enabled: true,
        name: "Single",
        shots: 1,
        milkRatio: 0,
        waterRatio: 0,
        cupSize: "small-8oz",
        price: 3.50
      },
      "double": {
        enabled: true,
        name: "Double",
        shots: 2,
        milkRatio: 0,
        waterRatio: 0,
        cupSize: "small-8oz",
        price: 4.00
      }
    },
    instructions: "Grind 7-9g for single, 14-18g for double. Extract 25-30 seconds.",
    customizable: {
      extraShot: true,
      decaf: true
    }
  },
  "long-black": {
    id: "long-black",
    name: "Long Black",
    category: "espresso-based",
    enabled: true,
    description: "Espresso with hot water",
    requiresMilk: false,
    sizes: {
      "small": {
        enabled: true,
        shots: 2,
        milkRatio: 0,
        waterRatio: 120, // ml
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 0,
        waterRatio: 240,
        cupSize: "medium-12oz"
      }
    },
    instructions: "Add hot water first, then float espresso on top to preserve crema.",
    customizable: {
      extraShot: true,
      decaf: true,
      strength: true
    }
  },
  "cappuccino": {
    id: "cappuccino",
    name: "Cappuccino",
    category: "espresso-based",
    enabled: true,
    description: "Espresso with steamed milk and thick foam",
    requiresMilk: true,
    sizes: {
      "small": {
        enabled: true,
        shots: 1,
        milkRatio: 120,
        foamThickness: "thick",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 180,
        foamThickness: "thick",
        cupSize: "medium-12oz"
      }
    },
    instructions: "1/3 espresso, 1/3 steamed milk, 1/3 foam. Dust with chocolate if requested.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true,
      chocolate: true
    }
  },
  "latte": {
    id: "latte",
    name: "Latte",
    category: "espresso-based",
    enabled: true,
    description: "Espresso with steamed milk and thin foam layer",
    requiresMilk: true,
    sizes: {
      "small": {
        enabled: true,
        shots: 1,
        milkRatio: 220,
        foamThickness: "thin",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 340,
        foamThickness: "thin",
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 2,
        milkRatio: 450,
        foamThickness: "thin",
        cupSize: "large-16oz"
      }
    },
    instructions: "Steam milk to 65°C with microfoam. Pour steadily for latte art.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true,
      temperature: true,
      syrup: true
    }
  },
  "flat-white": {
    id: "flat-white",
    name: "Flat White",
    category: "espresso-based",
    enabled: true,
    description: "Espresso with steamed milk and microfoam",
    requiresMilk: true,
    sizes: {
      "small": {
        enabled: true,
        shots: 2,
        milkRatio: 160,
        foamThickness: "micro",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 240,
        foamThickness: "micro",
        cupSize: "medium-12oz"
      }
    },
    instructions: "Double ristretto shots. Steam milk to create velvety microfoam.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true
    }
  },
  "macchiato": {
    id: "macchiato",
    name: "Macchiato",
    category: "espresso-based",
    enabled: true,
    description: "Espresso 'marked' with a dollop of foamed milk",
    requiresMilk: true,
    sizes: {
      "single": {
        enabled: true,
        name: "Single",
        shots: 1,
        milkRatio: 15,
        foamThickness: "dollop",
        cupSize: "small-8oz"
      },
      "double": {
        enabled: true,
        name: "Double",
        shots: 2,
        milkRatio: 30,
        foamThickness: "dollop",
        cupSize: "small-8oz"
      }
    },
    instructions: "Pull espresso, add small dollop of foamed milk on top.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true
    }
  },
  "piccolo": {
    id: "piccolo",
    name: "Piccolo Latte",
    category: "espresso-based",
    enabled: true,
    description: "Single shot espresso with steamed milk in a small glass",
    requiresMilk: true,
    sizes: {
      "standard": {
        enabled: true,
        name: "Standard",
        shots: 1,
        milkRatio: 90,
        foamThickness: "thin",
        cupSize: "piccolo-glass"
      }
    },
    instructions: "Single ristretto shot in 90ml glass, topped with steamed milk.",
    customizable: {
      decaf: true,
      milkType: true
    }
  },
  "cortado": {
    id: "cortado",
    name: "Cortado",
    category: "espresso-based",
    enabled: true,
    description: "Equal parts espresso and steamed milk",
    requiresMilk: true,
    sizes: {
      "standard": {
        enabled: true,
        name: "Standard",
        shots: 2,
        milkRatio: 60,
        foamThickness: "minimal",
        cupSize: "cortado-glass"
      }
    },
    instructions: "1:1 ratio of espresso to milk. Serve in gibraltar glass.",
    customizable: {
      decaf: true,
      milkType: true
    }
  },
  "mocha": {
    id: "mocha",
    name: "Mocha",
    category: "espresso-based",
    enabled: true,
    description: "Espresso with chocolate and steamed milk",
    requiresMilk: true,
    requiresExtra: ["chocolate-powder", "chocolate-syrup"],
    sizes: {
      "small": {
        enabled: true,
        shots: 1,
        milkRatio: 200,
        chocolateRatio: 30,
        foamThickness: "medium",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 300,
        chocolateRatio: 45,
        foamThickness: "medium",
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 2,
        milkRatio: 400,
        chocolateRatio: 60,
        foamThickness: "medium",
        cupSize: "large-16oz"
      }
    },
    instructions: "Add chocolate to cup, pull shots over chocolate, add steamed milk.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true,
      whippedCream: true,
      syrup: true
    }
  },
  "affogato": {
    id: "affogato",
    name: "Affogato",
    category: "espresso-based",
    enabled: true,
    description: "Espresso poured over vanilla ice cream",
    requiresMilk: false,
    requiresExtra: ["ice-cream"],
    sizes: {
      "standard": {
        enabled: true,
        name: "Standard",
        shots: 1,
        iceCreamScoops: 1,
        cupSize: "dessert-glass"
      },
      "double": {
        enabled: true,
        name: "Double",
        shots: 2,
        iceCreamScoops: 2,
        cupSize: "dessert-glass"
      }
    },
    instructions: "Place ice cream in glass/cup, pour hot espresso over top. Serve immediately.",
    customizable: {
      extraShot: true,
      decaf: true,
      liqueur: true
    }
  },
  
  // Milk-Based Variations
  "hot-chocolate": {
    id: "hot-chocolate",
    name: "Hot Chocolate",
    category: "milk-based",
    enabled: true,
    description: "Rich chocolate drink with steamed milk",
    requiresMilk: true,
    requiresExtra: ["chocolate-powder"],
    sizes: {
      "small": {
        enabled: true,
        shots: 0,
        milkRatio: 240,
        chocolateRatio: 30,
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 0,
        milkRatio: 360,
        chocolateRatio: 45,
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 0,
        milkRatio: 480,
        chocolateRatio: 60,
        cupSize: "large-16oz"
      }
    },
    instructions: "Mix chocolate powder with small amount of hot milk, then add remaining steamed milk.",
    customizable: {
      marshmallows: true,
      whippedCream: true,
      milkType: true,
      temperature: true
    }
  },
  "babycino": {
    id: "babycino",
    name: "Babycino",
    category: "milk-based",
    enabled: true,
    description: "Warm frothy milk for kids",
    requiresMilk: true,
    sizes: {
      "kids": {
        enabled: true,
        name: "Kids Size",
        shots: 0,
        milkRatio: 120,
        foamThickness: "extra-thick",
        cupSize: "kids-cup"
      }
    },
    instructions: "Steam milk to 50°C (cooler than adult drinks). Create extra thick foam. Dust with chocolate.",
    customizable: {
      chocolate: true,
      marshmallows: true,
      temperature: true
    }
  },
  "turmeric-latte": {
    id: "turmeric-latte",
    name: "Turmeric Latte",
    category: "milk-based",
    enabled: true,
    description: "Golden milk with turmeric and spices",
    requiresMilk: true,
    requiresExtra: ["turmeric-powder"],
    sizes: {
      "small": {
        enabled: true,
        shots: 0,
        milkRatio: 240,
        turmericRatio: 5, // grams
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 0,
        milkRatio: 360,
        turmericRatio: 7,
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 0,
        milkRatio: 480,
        turmericRatio: 10,
        cupSize: "large-16oz"
      }
    },
    instructions: "Mix turmeric powder with spices, add small amount of hot milk to form paste, then add remaining steamed milk.",
    customizable: {
      milkType: true,
      honey: true,
      ginger: true,
      cinnamon: true,
      temperature: true
    }
  },
  "chai-latte": {
    id: "chai-latte",
    name: "Chai Latte",
    category: "milk-based",
    enabled: true,
    description: "Spiced tea with steamed milk",
    requiresMilk: true,
    requiresExtra: ["chai-concentrate"],
    sizes: {
      "small": {
        enabled: true,
        shots: 0,
        chaiRatio: 120,
        milkRatio: 120,
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 0,
        chaiRatio: 180,
        milkRatio: 180,
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 0,
        chaiRatio: 240,
        milkRatio: 240,
        cupSize: "large-16oz"
      }
    },
    instructions: "1:1 ratio chai concentrate to steamed milk. Can add espresso for 'dirty chai'.",
    customizable: {
      dirtyOption: true, // Add espresso shot
      milkType: true,
      honey: true,
      cinnamon: true
    }
  },
  "matcha-latte": {
    id: "matcha-latte",
    name: "Matcha Latte",
    category: "milk-based",
    enabled: true,
    description: "Matcha green tea with steamed milk",
    requiresMilk: true,
    requiresExtra: ["matcha-powder"],
    sizes: {
      "small": {
        enabled: true,
        matchaGrams: 2,
        milkRatio: 240,
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        matchaGrams: 3,
        milkRatio: 360,
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        matchaGrams: 4,
        milkRatio: 480,
        cupSize: "large-16oz"
      }
    },
    instructions: "Whisk matcha with small amount of hot water, add steamed milk.",
    customizable: {
      milkType: true,
      sweetener: true,
      temperature: true
    }
  },
  
  // Filter/Drip Coffee
  "filter-coffee": {
    id: "filter-coffee",
    name: "Filter Coffee",
    category: "filter-drip",
    enabled: true,
    description: "Regular brewed coffee",
    requiresMilk: false,
    sizes: {
      "small": {
        enabled: true,
        coffeeRatio: 240,
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        coffeeRatio: 360,
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        coffeeRatio: 480,
        cupSize: "large-16oz"
      }
    },
    instructions: "Brew at 92-96°C, ratio 1:15 to 1:17 coffee to water.",
    customizable: {
      strength: true,
      milk: true,
      sugar: true
    }
  },
  "cold-brew": {
    id: "cold-brew",
    name: "Cold Brew",
    category: "filter-drip",
    enabled: true,
    description: "Coffee steeped in cold water for 12-24 hours",
    requiresMilk: false,
    sizes: {
      "small": {
        enabled: true,
        coldBrewRatio: 200,
        waterRatio: 40,
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        coldBrewRatio: 300,
        waterRatio: 60,
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        coldBrewRatio: 400,
        waterRatio: 80,
        cupSize: "large-16oz"
      }
    },
    instructions: "Serve over ice. Can dilute concentrate with water or milk.",
    customizable: {
      milk: true,
      syrup: true,
      ice: true
    }
  },
  
  // Cold Variations
  "iced-latte": {
    id: "iced-latte",
    name: "Iced Latte",
    category: "cold-drinks",
    enabled: true,
    description: "Cold latte over ice",
    requiresMilk: true,
    sizes: {
      "small": {
        enabled: true,
        shots: 1,
        milkRatio: 200,
        iceRatio: "full",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 300,
        iceRatio: "full",
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 2,
        milkRatio: 400,
        iceRatio: "full",
        cupSize: "large-16oz"
      }
    },
    instructions: "Fill cup with ice, add espresso, top with cold milk.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true,
      syrup: true,
      lessIce: true
    }
  },
  "iced-chocolate": {
    id: "iced-chocolate",
    name: "Iced Chocolate",
    category: "cold-drinks",
    enabled: true,
    description: "Cold chocolate drink over ice",
    requiresMilk: true,
    requiresExtra: ["chocolate-powder"],
    sizes: {
      "small": {
        enabled: true,
        shots: 0,
        milkRatio: 220,
        chocolateRatio: 30,
        iceRatio: "full",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 0,
        milkRatio: 320,
        chocolateRatio: 45,
        iceRatio: "full",
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 0,
        milkRatio: 420,
        chocolateRatio: 60,
        iceRatio: "full",
        cupSize: "large-16oz"
      }
    },
    instructions: "Mix chocolate powder with small amount of hot milk to dissolve, add cold milk, pour over ice.",
    customizable: {
      whippedCream: true,
      milkType: true,
      marshmallows: true,
      lessIce: true,
      syrup: true
    }
  },
  "iced-cappuccino": {
    id: "iced-cappuccino",
    name: "Iced Cappuccino",
    category: "cold-drinks",
    enabled: true,
    description: "Cold cappuccino over ice with foam",
    requiresMilk: true,
    sizes: {
      "small": {
        enabled: true,
        shots: 1,
        milkRatio: 180,
        foamRatio: 60,
        iceRatio: "full",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 250,
        foamRatio: 80,
        iceRatio: "full",
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 2,
        milkRatio: 350,
        foamRatio: 100,
        iceRatio: "full",
        cupSize: "large-16oz"
      }
    },
    instructions: "Pull shots over ice, add cold milk, top with cold foam. Dust with chocolate if desired.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true,
      chocolate: true,
      lessIce: true
    }
  },
  "iced-mocha": {
    id: "iced-mocha",
    name: "Iced Mocha",
    category: "cold-drinks",
    enabled: true,
    description: "Cold mocha over ice",
    requiresMilk: true,
    requiresExtra: ["chocolate-powder"],
    sizes: {
      "small": {
        enabled: true,
        shots: 1,
        milkRatio: 200,
        chocolateRatio: 30,
        iceRatio: "full",
        cupSize: "small-8oz"
      },
      "medium": {
        enabled: true,
        shots: 2,
        milkRatio: 300,
        chocolateRatio: 45,
        iceRatio: "full",
        cupSize: "medium-12oz"
      },
      "large": {
        enabled: true,
        shots: 2,
        milkRatio: 400,
        chocolateRatio: 60,
        iceRatio: "full",
        cupSize: "large-16oz"
      }
    },
    instructions: "Mix chocolate with small amount of hot milk, add espresso, cold milk, pour over ice.",
    customizable: {
      extraShot: true,
      decaf: true,
      milkType: true,
      whippedCream: true,
      lessIce: true,
      syrup: true
    }
  }
};

// Category display configuration
const categoryConfig = {
  "espresso-based": { 
    name: "Espresso Based", 
    color: "amber",
    description: "Traditional espresso drinks" 
  },
  "milk-based": { 
    name: "Milk Based Variations", 
    color: "blue",
    description: "Non-coffee milk drinks" 
  },
  "filter-drip": { 
    name: "Filter & Drip Coffee", 
    color: "brown",
    description: "Brewed coffee options" 
  },
  "cold-drinks": { 
    name: "Cold Drinks", 
    color: "cyan",
    description: "Iced and cold options" 
  },
  "custom": { 
    name: "Custom Drinks", 
    color: "purple",
    description: "Your custom creations" 
  }
};

const MenuManagement = () => {
  const { stations } = useStations();
  const [menuItems, setMenuItems] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [expandedItems, setExpandedItems] = useState({});
  const [editingItem, setEditingItem] = useState(null);
  const [showAddDrink, setShowAddDrink] = useState(false);
  const [availableCups, setAvailableCups] = useState([]);
  const [showAddSize, setShowAddSize] = useState(null); // drinkId when adding new size
  const [globalMenuEnabled, setGlobalMenuEnabled] = useState(true); // Global toggle for station restrictions
  
  // Load menu and cups on mount
  useEffect(() => {
    loadMenu();
    loadAvailableCups();
    // Load global menu setting
    const savedGlobalMenu = localStorage.getItem('global_menu_enabled');
    if (savedGlobalMenu !== null) {
      setGlobalMenuEnabled(savedGlobalMenu === 'true');
    }
  }, []);
  
  // Load menu from localStorage or use defaults
  const loadMenu = () => {
    const savedMenu = localStorage.getItem('event_menu');
    const savedVersion = localStorage.getItem('event_menu_version');
    
    // Check if we need to update the menu
    if (savedMenu && savedVersion === MENU_VERSION) {
      try {
        const parsedMenu = JSON.parse(savedMenu);
        // Ensure all menu items have stationAvailability
        Object.keys(parsedMenu).forEach(drinkId => {
          if (!parsedMenu[drinkId].stationAvailability) {
            parsedMenu[drinkId].stationAvailability = {};
          }
        });
        setMenuItems(parsedMenu);
      } catch (e) {
        console.error('Error loading menu:', e);
        initializeDefaultMenu();
      }
    } else {
      // First time or version mismatch - use default menu
      console.log('Loading new menu version:', MENU_VERSION);
      initializeDefaultMenu();
    }
  };
  
  // Initialize default menu with station availability
  const initializeDefaultMenu = () => {
    const menuWithStations = { ...defaultCoffeeMenu };
    Object.keys(menuWithStations).forEach(drinkId => {
      menuWithStations[drinkId].stationAvailability = {};
    });
    setMenuItems(menuWithStations);
    localStorage.setItem('event_menu', JSON.stringify(menuWithStations));
    localStorage.setItem('event_menu_version', MENU_VERSION);
  };
  
  // Load available cups from inventory
  const loadAvailableCups = () => {
    const inventory = localStorage.getItem('event_inventory');
    if (inventory) {
      try {
        const inventoryData = JSON.parse(inventory);
        const cups = inventoryData.cups || [];
        // Add some default options if no cups in inventory
        const defaultCups = [
          { id: 'small-8oz', name: 'Small (8oz)', enabled: true },
          { id: 'medium-12oz', name: 'Medium (12oz)', enabled: true },
          { id: 'large-16oz', name: 'Large (16oz)', enabled: true },
          { id: 'extra-large-20oz', name: 'Extra Large (20oz)', enabled: true }
        ];
        setAvailableCups(cups.length > 0 ? cups.filter(c => c.enabled) : defaultCups);
      } catch (e) {
        console.error('Error loading cups:', e);
      }
    }
  };
  
  // Save menu to localStorage
  const saveMenu = (menu) => {
    localStorage.setItem('event_menu', JSON.stringify(menu));
    localStorage.setItem('event_menu_version', MENU_VERSION);
    setMenuItems(menu);
  };
  
  // Toggle global menu enabled
  const toggleGlobalMenu = () => {
    const newValue = !globalMenuEnabled;
    setGlobalMenuEnabled(newValue);
    localStorage.setItem('global_menu_enabled', String(newValue));
  };
  
  // Toggle drink enabled/disabled
  const toggleDrinkEnabled = (drinkId) => {
    const updatedMenu = {
      ...menuItems,
      [drinkId]: {
        ...menuItems[drinkId],
        enabled: !menuItems[drinkId].enabled
      }
    };
    saveMenu(updatedMenu);
  };
  
  // Toggle station availability for a drink
  const toggleStationAvailability = (drinkId, stationId) => {
    const updatedMenu = {
      ...menuItems,
      [drinkId]: {
        ...menuItems[drinkId],
        stationAvailability: {
          ...menuItems[drinkId].stationAvailability,
          [stationId]: !menuItems[drinkId].stationAvailability?.[stationId]
        }
      }
    };
    saveMenu(updatedMenu);
  };
  
  // Toggle size enabled/disabled
  const toggleSizeEnabled = (drinkId, sizeKey) => {
    const updatedMenu = {
      ...menuItems,
      [drinkId]: {
        ...menuItems[drinkId],
        sizes: {
          ...menuItems[drinkId].sizes,
          [sizeKey]: {
            ...menuItems[drinkId].sizes[sizeKey],
            enabled: !menuItems[drinkId].sizes[sizeKey].enabled
          }
        }
      }
    };
    saveMenu(updatedMenu);
  };
  
  // Update drink details
  const updateDrinkDetails = (drinkId, updates) => {
    const updatedMenu = {
      ...menuItems,
      [drinkId]: {
        ...menuItems[drinkId],
        ...updates
      }
    };
    saveMenu(updatedMenu);
  };
  
  // Update size details
  const updateSizeDetails = (drinkId, sizeKey, updates) => {
    const updatedMenu = {
      ...menuItems,
      [drinkId]: {
        ...menuItems[drinkId],
        sizes: {
          ...menuItems[drinkId].sizes,
          [sizeKey]: {
            ...menuItems[drinkId].sizes[sizeKey],
            ...updates
          }
        }
      }
    };
    saveMenu(updatedMenu);
  };
  
  // Add new size to drink
  const addSizeToDrink = (drinkId, sizeData) => {
    const sizeKey = sizeData.name.toLowerCase().replace(/\s+/g, '-');
    const drink = menuItems[drinkId];
    
    const newSize = {
      enabled: true,
      name: sizeData.name,
      shots: sizeData.shots || (drink.requiresMilk ? 2 : 1),
      cupSize: sizeData.cupSize,
      ...(drink.requiresMilk && { milkRatio: sizeData.milkRatio || 300 }),
      ...(drink.id === 'long-black' && { waterRatio: sizeData.waterRatio || 200 })
    };
    
    const updatedMenu = {
      ...menuItems,
      [drinkId]: {
        ...menuItems[drinkId],
        sizes: {
          ...menuItems[drinkId].sizes,
          [sizeKey]: newSize
        }
      }
    };
    saveMenu(updatedMenu);
    setShowAddSize(null);
  };
  
  // Delete size from drink
  const deleteSizeFromDrink = (drinkId, sizeKey) => {
    // Don't allow deleting if it's the only size
    const sizeCount = Object.keys(menuItems[drinkId].sizes).length;
    if (sizeCount <= 1) {
      alert('Cannot delete the only size. Each drink must have at least one size option.');
      return;
    }
    
    if (window.confirm('Are you sure you want to delete this size?')) {
      const updatedMenu = {
        ...menuItems,
        [drinkId]: {
          ...menuItems[drinkId],
          sizes: Object.fromEntries(
            Object.entries(menuItems[drinkId].sizes).filter(([key]) => key !== sizeKey)
          )
        }
      };
      saveMenu(updatedMenu);
    }
  };
  
  // Add custom drink
  const addCustomDrink = (drinkData) => {
    const drinkId = drinkData.name.toLowerCase().replace(/\s+/g, '-');
    const newDrink = {
      id: drinkId,
      name: drinkData.name,
      category: 'custom',
      enabled: true,
      description: drinkData.description,
      requiresMilk: drinkData.requiresMilk,
      sizes: {
        small: {
          enabled: true,
          shots: drinkData.defaultShots || 1,
          milkRatio: drinkData.requiresMilk ? 220 : 0,
          cupSize: "small-8oz"
        }
      },
      instructions: drinkData.instructions || '',
      customizable: {
        extraShot: true,
        decaf: true,
        milkType: drinkData.requiresMilk
      }
    };
    
    const updatedMenu = {
      ...menuItems,
      [drinkId]: newDrink
    };
    saveMenu(updatedMenu);
    setShowAddDrink(false);
  };
  
  // Delete drink (any drink can now be deleted)
  const deleteDrink = (drinkId) => {
    if (window.confirm(`Are you sure you want to delete ${menuItems[drinkId].name}? This cannot be undone.`)) {
      const updatedMenu = { ...menuItems };
      delete updatedMenu[drinkId];
      saveMenu(updatedMenu);
    }
  };
  
  // Filter drinks
  const getFilteredDrinks = () => {
    return Object.values(menuItems).filter(drink => {
      const matchesSearch = drink.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          drink.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = filterCategory === 'all' || drink.category === filterCategory;
      return matchesSearch && matchesCategory;
    });
  };
  
  // Group drinks by category
  const getDrinksByCategory = () => {
    const filtered = getFilteredDrinks();
    const grouped = {};
    
    filtered.forEach(drink => {
      if (!grouped[drink.category]) {
        grouped[drink.category] = [];
      }
      grouped[drink.category].push(drink);
    });
    
    return grouped;
  };
  
  // Restore default menu
  const restoreDefaultMenu = () => {
    if (window.confirm('This will restore the default menu and overwrite any custom drinks. Are you sure?')) {
      initializeDefaultMenu();
      loadAvailableCups(); // Reload cups in case inventory changed
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Menu Management</h2>
        <div className="flex space-x-2">
          <button
            onClick={restoreDefaultMenu}
            className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center"
            title="Restore default menu"
          >
            <Settings size={20} className="mr-2" />
            Restore Defaults
          </button>
          <button
            onClick={() => setShowAddDrink(true)}
            className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 flex items-center"
          >
            <Plus size={20} className="mr-2" />
            Add Custom Drink
          </button>
        </div>
      </div>
      
      {/* Search and Filters */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="relative">
          <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search drinks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Categories</option>
          {Object.entries(categoryConfig).map(([key, config]) => (
            <option key={key} value={key}>{config.name}</option>
          ))}
        </select>
      </div>
      
      {/* Global Menu Toggle */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Globe size={24} className="text-blue-600" />
            <div>
              <h3 className="font-semibold text-gray-800">Station Menu Configuration</h3>
              <p className="text-sm text-gray-600">
                {globalMenuEnabled 
                  ? "All menu items are available at all stations" 
                  : "Menu items can be restricted to specific stations"}
              </p>
            </div>
          </div>
          <button
            onClick={toggleGlobalMenu}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              globalMenuEnabled ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                globalMenuEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {!globalMenuEnabled && stations && stations.length > 0 && (
          <div className="mt-3 text-sm text-gray-600 bg-white rounded p-3">
            <p className="font-medium mb-1">Available stations:</p>
            <div className="flex flex-wrap gap-2">
              {stations.map(station => (
                <span key={station.id} className="px-2 py-1 bg-gray-100 rounded text-xs">
                  {station.name || `Station ${station.id}`}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 p-4 rounded-md">
          <div className="text-2xl font-bold text-gray-800">
            {Object.keys(menuItems).length}
          </div>
          <div className="text-sm text-gray-600">Total Drinks</div>
        </div>
        <div className="bg-green-50 p-4 rounded-md">
          <div className="text-2xl font-bold text-green-600">
            {Object.values(menuItems).filter(d => d.enabled).length}
          </div>
          <div className="text-sm text-gray-600">Active Drinks</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-md">
          <div className="text-2xl font-bold text-blue-600">
            {Object.values(menuItems).filter(d => d.requiresMilk).length}
          </div>
          <div className="text-sm text-gray-600">Milk-Based</div>
        </div>
        <div className="bg-purple-50 p-4 rounded-md">
          <div className="text-2xl font-bold text-purple-600">
            {Object.values(menuItems).filter(d => d.category === 'custom').length}
          </div>
          <div className="text-sm text-gray-600">Custom Drinks</div>
        </div>
      </div>
      
      {/* Drinks by Category */}
      {Object.entries(getDrinksByCategory()).map(([category, drinks]) => (
        <div key={category} className="mb-8">
          <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
            <Coffee className={`mr-2 text-${categoryConfig[category]?.color || 'gray'}-600`} />
            {categoryConfig[category]?.name || category}
            <span className="ml-2 text-sm text-gray-500">
              ({drinks.length} drinks)
            </span>
          </h3>
          
          <div className="space-y-2">
            {drinks.map(drink => (
              <div key={drink.id} className="border border-gray-200 rounded-lg">
                {/* Drink Header */}
                <div className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => toggleDrinkEnabled(drink.id)}
                      className={`p-2 rounded-md border-2 transition-colors ${
                        drink.enabled 
                          ? 'bg-green-50 border-green-500 text-green-600' 
                          : 'bg-gray-50 border-gray-300 text-gray-400'
                      }`}
                    >
                      {drink.enabled ? <CheckCircle size={18} /> : <Circle size={18} />}
                    </button>
                    
                    <div className="flex-1">
                      <h4 className={`font-medium ${!drink.enabled ? 'text-gray-400' : 'text-gray-900'}`}>
                        {drink.name}
                      </h4>
                      <p className="text-sm text-gray-600">{drink.description}</p>
                      {drink.requiresMilk && (
                        <span className="text-xs text-blue-600">Requires milk</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setExpandedItems({
                        ...expandedItems,
                        [drink.id]: !expandedItems[drink.id]
                      })}
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded"
                    >
                      {expandedItems[drink.id] ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </button>
                    
                    <button
                      onClick={() => deleteDrink(drink.id)}
                      className="p-2 text-red-500 hover:bg-red-100 rounded"
                      title="Delete this drink"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                
                {/* Expanded Details */}
                {expandedItems[drink.id] && (
                  <div className="border-t border-gray-200 p-4 bg-gray-50">
                    {/* Instructions */}
                    <div className="mb-4">
                      <label className="text-sm font-medium text-gray-700 flex items-center mb-2">
                        <Info size={16} className="mr-1" />
                        Preparation Instructions
                      </label>
                      <textarea
                        value={drink.instructions}
                        onChange={(e) => updateDrinkDetails(drink.id, { instructions: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        rows="2"
                        placeholder="Enter preparation instructions..."
                      />
                    </div>
                    
                    {/* Sizes */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="text-sm font-medium text-gray-700">Size Configurations</h5>
                        <button
                          onClick={() => setShowAddSize(drink.id)}
                          className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 flex items-center"
                        >
                          <Plus size={14} className="mr-1" />
                          Add Size
                        </button>
                      </div>
                      
                      <div className="space-y-3">
                        {Object.entries(drink.sizes).map(([sizeKey, size]) => (
                          <div key={sizeKey} className="bg-white p-3 rounded border border-gray-200">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center">
                                <button
                                  onClick={() => toggleSizeEnabled(drink.id, sizeKey)}
                                  className={`p-1 rounded border-2 mr-2 transition-colors ${
                                    size.enabled 
                                      ? 'bg-green-50 border-green-500 text-green-600' 
                                      : 'bg-gray-50 border-gray-300 text-gray-400'
                                  }`}
                                >
                                  {size.enabled ? <CheckCircle size={14} /> : <Circle size={14} />}
                                </button>
                                <input
                                  type="text"
                                  value={size.name || sizeKey.charAt(0).toUpperCase() + sizeKey.slice(1)}
                                  onChange={(e) => updateSizeDetails(drink.id, sizeKey, { name: e.target.value })}
                                  className="font-medium bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                                />
                              </div>
                              <div className="flex items-center space-x-2">
                                <select
                                  value={size.cupSize}
                                  onChange={(e) => updateSizeDetails(drink.id, sizeKey, { cupSize: e.target.value })}
                                  className="text-sm px-2 py-1 border border-gray-300 rounded"
                                >
                                  {availableCups.map(cup => (
                                    <option key={cup.id} value={cup.id}>{cup.name}</option>
                                  ))}
                                </select>
                                {Object.keys(drink.sizes).length > 1 && (
                                  <button
                                    onClick={() => deleteSizeFromDrink(drink.id, sizeKey)}
                                    className="p-1 text-red-500 hover:bg-red-100 rounded"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                            
                            {size.enabled && (
                              <div className="grid grid-cols-3 gap-2 text-sm">
                                {size.shots !== undefined && (
                                  <div>
                                    <label className="text-gray-600">Shots</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="4"
                                      value={size.shots}
                                      onChange={(e) => updateSizeDetails(drink.id, sizeKey, { 
                                        shots: parseInt(e.target.value) || 0 
                                      })}
                                      className="w-full px-2 py-1 border border-gray-300 rounded"
                                    />
                                  </div>
                                )}
                                
                                {size.milkRatio !== undefined && (
                                  <div>
                                    <label className="text-gray-600">Milk (ml)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={size.milkRatio}
                                      onChange={(e) => updateSizeDetails(drink.id, sizeKey, { 
                                        milkRatio: parseInt(e.target.value) || 0 
                                      })}
                                      className="w-full px-2 py-1 border border-gray-300 rounded"
                                    />
                                  </div>
                                )}
                                
                                {size.waterRatio !== undefined && (
                                  <div>
                                    <label className="text-gray-600">Water (ml)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={size.waterRatio}
                                      onChange={(e) => updateSizeDetails(drink.id, sizeKey, { 
                                        waterRatio: parseInt(e.target.value) || 0 
                                      })}
                                      className="w-full px-2 py-1 border border-gray-300 rounded"
                                    />
                                  </div>
                                )}
                                
                                {size.price !== undefined && (
                                  <div>
                                    <label className="text-gray-600">Price ($)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.50"
                                      value={size.price}
                                      onChange={(e) => updateSizeDetails(drink.id, sizeKey, { 
                                        price: parseFloat(e.target.value) || 0 
                                      })}
                                      className="w-full px-2 py-1 border border-gray-300 rounded"
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Station Availability - Only show when global menu is disabled */}
                    {!globalMenuEnabled && stations && stations.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                          <Monitor size={16} className="mr-1" />
                          Station Availability
                        </h5>
                        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-3">
                          <p className="text-xs text-yellow-800">
                            Select which stations can make this drink. If no stations are selected, this drink will be available at all stations.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {stations.map(station => {
                            const isAvailable = drink.stationAvailability?.[station.id] !== false;
                            return (
                              <label key={station.id} className="flex items-center p-2 border rounded hover:bg-gray-50">
                                <input
                                  type="checkbox"
                                  checked={isAvailable}
                                  onChange={() => toggleStationAvailability(drink.id, station.id)}
                                  className="mr-2"
                                />
                                <span className="text-sm text-gray-700">
                                  {station.name || `Station ${station.id}`}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {/* Customization Options */}
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Customization Options</h5>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(drink.customizable || {})
                          .filter(([option]) => !['sweetener', 'sugar', 'honey'].includes(option)) // Filter out sweetener options
                          .map(([option, enabled]) => (
                          <label key={option} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => updateDrinkDetails(drink.id, {
                                customizable: {
                                  ...drink.customizable,
                                  [option]: e.target.checked
                                }
                              })}
                              className="mr-2"
                            />
                            <span className="text-sm text-gray-700">
                              {option.replace(/([A-Z])/g, ' $1').trim()}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      
      {/* Add Size Modal */}
      {showAddSize && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Add Size to {menuItems[showAddSize]?.name}</h3>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              addSizeToDrink(showAddSize, {
                name: formData.get('name'),
                cupSize: formData.get('cupSize'),
                shots: parseInt(formData.get('shots')) || 1,
                milkRatio: parseInt(formData.get('milkRatio')) || 0,
                waterRatio: parseInt(formData.get('waterRatio')) || 0
              });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Size Name
                  </label>
                  <input
                    name="name"
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g., Extra Large"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cup Size
                  </label>
                  <select
                    name="cupSize"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    {availableCups.map(cup => (
                      <option key={cup.id} value={cup.id}>{cup.name}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default Shots
                  </label>
                  <input
                    name="shots"
                    type="number"
                    min="0"
                    max="4"
                    defaultValue="2"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                
                {menuItems[showAddSize]?.requiresMilk && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Milk Amount (ml)
                    </label>
                    <input
                      name="milkRatio"
                      type="number"
                      min="0"
                      defaultValue="400"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                )}
                
                {menuItems[showAddSize]?.id === 'long-black' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Water Amount (ml)
                    </label>
                    <input
                      name="waterRatio"
                      type="number"
                      min="0"
                      defaultValue="300"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                )}
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddSize(null)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                >
                  Add Size
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Add Custom Drink Modal */}
      {showAddDrink && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Add Custom Drink</h3>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              addCustomDrink({
                name: formData.get('name'),
                description: formData.get('description'),
                requiresMilk: formData.get('requiresMilk') === 'true',
                defaultShots: parseInt(formData.get('defaultShots')) || 1,
                instructions: formData.get('instructions')
              });
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Drink Name
                  </label>
                  <input
                    name="name"
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g., Turmeric Latte"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <input
                    name="description"
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g., Golden milk with turmeric and spices"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Requires Milk?
                  </label>
                  <select
                    name="requiresMilk"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default Shots (if coffee-based)
                  </label>
                  <input
                    name="defaultShots"
                    type="number"
                    min="0"
                    max="4"
                    defaultValue="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Instructions (optional)
                  </label>
                  <textarea
                    name="instructions"
                    rows="2"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="How to prepare this drink..."
                  />
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddDrink(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                >
                  Add Drink
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuManagement;