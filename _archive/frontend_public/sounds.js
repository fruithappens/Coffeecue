// Sound notification system for Barista Interface
(function() {
  console.log('Sound system initialized');
  
  // Debug and initialize sounds
  try {
    // Check if audio files exist by checking for 404 errors
    const audioFiles = [
      '/static/audio/notification.mp3',
      '/static/audio/order-ready.mp3',
      '/static/audio/error.mp3',
      '/static/audio/payment.mp3'
    ];
    
    // Map of files to check for fallback options
    const audioFileMap = {
      '/static/audio/notification.mp3': [
        '/static/audio/notification.mp3',
        '/audio/notification.mp3',
        '/notification.mp3'
      ],
      '/static/audio/order-ready.mp3': [
        '/static/audio/order-ready.mp3',
        '/audio/order-ready.mp3',
        '/order-ready.mp3'
      ],
      '/static/audio/error.mp3': [
        '/static/audio/error.mp3',
        '/audio/error.mp3',
        '/error.mp3'
      ]
    };
    
    // Pre-fetch sound files to warm up browser cache
    audioFiles.forEach(file => {
      const xhr = new XMLHttpRequest();
      xhr.open('HEAD', file, true);
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status === 404) {
            console.warn(`Sound file not found: ${file} (status: ${xhr.status})`);
          } else {
            console.log(`Sound file found: ${file} (status: ${xhr.status})`);
          }
        }
      };
      xhr.send();
    });
  } catch (e) {
    console.error('Error checking audio files:', e);
  }
  
  // Define our sounds - make sure to only load when needed
  const sounds = {
    newOrder: null,
    orderCompleted: null,
    error: null
  };
  
  // Function to initialize sounds lazily when needed
  function initSound(name) {
    if (sounds[name]) return sounds[name]; // Return if already initialized
    
    let audioPath = '';
    
    // Find the correct path based on sound name
    switch (name) {
      case 'newOrder':
        try {
          const paths = [
            '/static/audio/notification.mp3',
            '/audio/notification.mp3',
            '/notification.mp3'
          ];
          // The first path that successfully loads will be used
          audioPath = paths[0]; // Start with first option
        } catch (e) {
          console.error(`Error initializing ${name} sound:`, e);
        }
        break;
        
      case 'orderCompleted':
        try {
          const paths = [
            '/static/audio/order-ready.mp3',
            '/audio/order-ready.mp3',
            '/order-ready.mp3'
          ];
          audioPath = paths[0];
        } catch (e) {
          console.error(`Error initializing ${name} sound:`, e);
        }
        break;
        
      case 'error':
        try {
          const paths = [
            '/static/audio/error.mp3',
            '/audio/error.mp3',
            '/error.mp3'
          ];
          audioPath = paths[0];
        } catch (e) {
          console.error(`Error initializing ${name} sound:`, e);
        }
        break;
        
      default:
        console.warn(`Unknown sound type: ${name}`);
        return null;
    }
    
    try {
      // Create and configure the audio object
      sounds[name] = new Audio(audioPath);
      sounds[name].volume = 0.5;
      console.log(`Initialized ${name} sound from ${audioPath}`);
      return sounds[name];
    } catch (e) {
      console.error(`Failed to create audio object for ${name}:`, e);
      return null;
    }
  }
  
  // Check if sounds are enabled
  function areSoundsEnabled() {
    return localStorage.getItem('coffee_sound_enabled') !== 'false';
  }
  
  // Function to play a sound if enabled
  function playSound(soundName) {
    if (!areSoundsEnabled()) {
      console.log(`Sound disabled: ${soundName}`);
      return;
    }
    
    try {
      // Initialize sound if not already loaded
      let sound = sounds[soundName];
      if (!sound) {
        sound = initSound(soundName);
      }
      
      if (sound) {
        // Reset the sound to the beginning if it's already playing
        sound.pause();
        sound.currentTime = 0;
        
        // Set the volume from settings
        sound.volume = 0.8; // Louder default volume
        
        // Play the sound with a promise to handle autoplay restrictions
        const playPromise = sound.play();
        
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.warn(`Error playing sound ${soundName}:`, error);
            
            if (error.name === 'NotAllowedError') {
              console.log('Browser blocked autoplay. Will retry with user interaction.');
              
              // Try to play on next user interaction
              const playOnInteraction = () => {
                sound.play().catch(e => console.error('Still failed to play sound:', e));
                document.removeEventListener('click', playOnInteraction);
              };
              document.addEventListener('click', playOnInteraction, { once: true });
            }
          });
        }
        
        console.log(`Playing sound: ${soundName}`);
      } else {
        console.warn(`Sound not found: ${soundName}`);
      }
    } catch (error) {
      console.error(`Error playing sound ${soundName}:`, error);
    }
  }
  
  // Listen for events that should trigger sounds
  window.addEventListener('app:newOrder', () => playSound('newOrder'));
  window.addEventListener('app:orderCompleted', () => playSound('orderCompleted'));
  window.addEventListener('app:error', () => playSound('error'));
  
  // Update sound setting when it changes
  window.addEventListener('app:toggleSound', (event) => {
    const enabled = event.detail?.enabled;
    if (typeof enabled === 'boolean') {
      localStorage.setItem('coffee_sound_enabled', enabled ? 'true' : 'false');
      console.log(`Sound ${enabled ? 'enabled' : 'disabled'}`);
    }
  });
  
  // Expose to window for direct use
  window.coffeeSounds = {
    play: playSound,
    enable: () => {
      localStorage.setItem('coffee_sound_enabled', 'true');
      console.log('Sounds enabled');
    },
    disable: () => {
      localStorage.setItem('coffee_sound_enabled', 'false');
      console.log('Sounds disabled');
    },
    isEnabled: areSoundsEnabled,
    testSounds: () => {
      playSound('newOrder');
      setTimeout(() => playSound('orderCompleted'), 1500);
      setTimeout(() => playSound('error'), 3000);
    }
  };
})();