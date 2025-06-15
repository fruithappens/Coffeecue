// Enhanced Coffee Cue Sound System - Updated with testSounds fix and diagnostics
(function() {
  console.log('☕ Coffee Cue Sound System v2.3 with volume control support...');
  
  // Sound configuration with unique sounds for different events
  const soundConfig = {
    // Order lifecycle sounds
    newOrder: {
      file: '/static/audio/notification.mp3',
      volume: 0.7,
      description: 'New order notification'
    },
    orderStarted: {
      file: '/static/audio/scan-success.mp3',
      volume: 0.6,
      description: 'Order processing started'
    },
    orderComplete: {
      file: '/static/audio/order-ready.mp3',
      volume: 0.8,
      description: 'Order completed'
    },
    orderPickedUp: {
      file: '/static/audio/payment.mp3',
      volume: 0.6,
      description: 'Order picked up by customer'
    },
    
    // Alert sounds
    lowStock: {
      file: '/static/audio/error.mp3',
      volume: 0.9,
      pitch: 0.8, // Lower pitch for warning
      description: 'Low stock warning'
    },
    error: {
      file: '/static/audio/error.mp3',
      volume: 0.9,
      description: 'Error notification'
    },
    
    // UI feedback sounds
    buttonClick: {
      // Using base64 encoded short click sound
      file: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAABAAAD',
      volume: 0.3,
      description: 'Button click feedback'
    },
    success: {
      file: '/static/audio/scan-success.mp3',
      volume: 0.5,
      description: 'Success action'
    },
    
    // Special events
    vipOrder: {
      file: '/static/audio/notification.mp3',
      volume: 0.9,
      pitch: 1.2, // Higher pitch for VIP
      description: 'VIP order notification'
    },
    rushOrder: {
      file: '/static/audio/notification.mp3',
      volume: 0.9,
      rate: 1.5, // Faster playback for urgency
      description: 'Rush order notification'
    }
  };
  
  // Sound cache to avoid recreating Audio objects
  const soundCache = {};
  const audioContext = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
  
  // Initialize a sound with optional pitch/rate modification
  function initSound(name) {
    const config = soundConfig[name];
    if (!config) {
      console.warn(`Unknown sound: ${name}`);
      return null;
    }
    
    // Return cached sound if available and not modified
    if (soundCache[name] && !config.pitch && !config.rate) {
      return soundCache[name];
    }
    
    try {
      const audio = new Audio(config.file);
      audio.volume = config.volume || 0.5;
      
      // Apply pitch/rate modifications if supported
      if (audioContext && (config.pitch || config.rate)) {
        // Note: This is a simplified example. Full implementation would require Web Audio API
        audio.playbackRate = config.rate || 1.0;
      }
      
      // Handle load errors gracefully
      audio.addEventListener('error', (e) => {
        console.warn(`🚫 Audio file load error for ${name}: ${config.file}`, e);
        console.warn(`Error details:`, {
          error: e.error,
          target: e.target,
          networkState: audio.networkState,
          readyState: audio.readyState
        });
      });
      
      // Add success listener for debugging
      audio.addEventListener('canplaythrough', () => {
        console.log(`✅ Audio file loaded successfully: ${name} (${config.file})`);
      });
      
      // Add metadata listener for debugging
      audio.addEventListener('loadedmetadata', () => {
        console.log(`📊 Audio metadata loaded for ${name}: duration=${audio.duration}s`);
      });
      
      soundCache[name] = audio;
      console.log(`✅ Initialized sound: ${name}`);
      return audio;
    } catch (e) {
      console.warn(`❌ Failed to initialize sound ${name}:`, e);
      console.warn('Audio files may not be accessible in development mode.');
      return null;
    }
  }
  
  // Play a sound with options
  function playSound(soundName, options = {}) {
    // Check if sounds are enabled
    const soundsEnabled = localStorage.getItem('coffee_sound_enabled') !== 'false';
    const specificSoundEnabled = localStorage.getItem(`coffee_sound_${soundName}`) !== 'false';
    
    if (!soundsEnabled || !specificSoundEnabled) {
      console.log(`🔇 Sound disabled: ${soundName}`);
      return Promise.resolve();
    }
    
    const sound = initSound(soundName);
    if (!sound) {
      return Promise.reject(new Error(`Sound not found: ${soundName}`));
    }
    
    // Reset sound
    sound.currentTime = 0;
    
    // Apply volume - check for passed options, then check localStorage, then use config default
    if (options.volume !== undefined) {
      sound.volume = Math.max(0, Math.min(1, options.volume));
    } else {
      // Try to get volume from localStorage settings
      try {
        const settings = JSON.parse(localStorage.getItem('coffee_cue_barista_settings') || '{}');
        if (settings.soundVolume !== undefined) {
          sound.volume = Math.max(0, Math.min(1, settings.soundVolume / 100));
        }
      } catch (e) {
        // Fall back to config volume if localStorage fails
        sound.volume = soundConfig[soundName].volume || 0.5;
      }
    }
    
    // Play the sound
    console.log(`🔊 Playing: ${soundName}`);
    return sound.play().then(() => {
      console.log(`✅ Successfully played sound: ${soundName}`);
    }).catch(error => {
      console.log(`❌ Sound play failed for ${soundName}:`, error.name, error.message);
      
      if (error.name === 'NotAllowedError') {
        console.warn('🚫 Browser autoplay blocked. Click anywhere to enable sounds.');
        // Set up one-time click handler to enable audio
        document.addEventListener('click', () => {
          console.log('🖱️ User clicked - attempting to play sound again');
          sound.play().then(() => {
            console.log(`✅ Sound played after user interaction: ${soundName}`);
          }).catch(retryError => {
            console.error(`❌ Sound still failed after user click: ${soundName}`, retryError);
          });
        }, { once: true });
        return Promise.reject(error);
      } else if (error.name === 'NotSupportedError') {
        const config = soundConfig[soundName];
        console.warn(`❌ Audio file not supported or missing: ${soundName} (${config?.file || 'unknown file'})`);
        console.warn('This is normal in development mode or if audio files are not accessible.');
        // Return resolved promise to prevent uncaught errors
        return Promise.resolve();
      } else {
        console.error(`❌ Unexpected audio error for ${soundName}:`, error);
        console.error('Error details:', {
          name: error.name,
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        // Return resolved promise to prevent uncaught errors
        return Promise.resolve();
      }
    });
  }
  
  // Play multiple sounds in sequence
  function playSequence(sounds, delay = 500) {
    sounds.forEach((soundName, index) => {
      setTimeout(() => playSound(soundName), index * delay);
    });
  }
  
  // Volume control
  function setVolume(soundName, volume) {
    const sound = soundCache[soundName];
    if (sound) {
      sound.volume = Math.max(0, Math.min(1, volume));
    }
  }
  
  function setMasterVolume(volume) {
    Object.keys(soundCache).forEach(soundName => {
      setVolume(soundName, volume * (soundConfig[soundName].volume || 0.5));
    });
  }
  
  // Test all sounds
  function testAllSounds() {
    console.log('🎵 Testing all sounds...');
    const soundNames = Object.keys(soundConfig);
    
    soundNames.forEach((soundName, index) => {
      setTimeout(() => {
        console.log(`Testing: ${soundName} - ${soundConfig[soundName].description}`);
        playSound(soundName);
      }, index * 1500);
    });
  }
  
  // Diagnostic function for debugging audio issues
  function diagnoseAudio() {
    console.log('🔍 Running audio system diagnostics...');
    
    // Check browser support
    console.log('Browser audio support:');
    console.log('- Audio constructor:', typeof Audio !== 'undefined');
    console.log('- AudioContext:', typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined');
    
    // Check sound cache
    console.log('\nSound cache status:');
    Object.keys(soundConfig).forEach(soundName => {
      const cached = soundCache[soundName];
      if (cached) {
        console.log(`- ${soundName}: cached, readyState=${cached.readyState}, networkState=${cached.networkState}`);
      } else {
        console.log(`- ${soundName}: not cached`);
      }
    });
    
    // Check localStorage settings
    console.log('\nSound settings:');
    console.log('- Master enabled:', localStorage.getItem('coffee_sound_enabled') !== 'false');
    Object.keys(soundConfig).forEach(soundName => {
      console.log(`- ${soundName} enabled:`, localStorage.getItem(`coffee_sound_${soundName}`) !== 'false');
    });
    
    // Test a simple audio file
    console.log('\nTesting basic audio file access...');
    try {
      const testAudio = new Audio('/static/audio/notification.mp3');
      testAudio.volume = 0.1; // Very quiet for testing
      
      testAudio.addEventListener('canplaythrough', () => {
        console.log('✅ Test audio file can play through');
        testAudio.play().then(() => {
          console.log('✅ Test audio played successfully');
        }).catch(error => {
          console.error('❌ Test audio play failed:', error);
        });
      });
      
      testAudio.addEventListener('error', (e) => {
        console.error('❌ Test audio file load failed:', e);
      });
      
      testAudio.load(); // Force load
    } catch (error) {
      console.error('❌ Cannot create test audio:', error);
    }
  }
  
  // Preload sounds for better performance
  function preloadSounds() {
    console.log('📦 Preloading sounds...');
    Object.keys(soundConfig).forEach(soundName => {
      if (!soundConfig[soundName].file.startsWith('data:')) {
        initSound(soundName);
      }
    });
  }
  
  // Event listeners for app events
  window.addEventListener('coffee:newOrder', (e) => {
    const order = e.detail;
    if (order?.priority || order?.vip) {
      playSound('vipOrder');
    } else if (order?.rush) {
      playSound('rushOrder');
    } else {
      playSound('newOrder');
    }
  });
  
  window.addEventListener('coffee:orderStarted', () => playSound('orderStarted'));
  window.addEventListener('coffee:orderComplete', () => playSound('orderComplete'));
  window.addEventListener('coffee:orderPickedUp', () => playSound('orderPickedUp'));
  window.addEventListener('coffee:lowStock', () => playSound('lowStock'));
  window.addEventListener('coffee:error', () => playSound('error'));
  
  // Expose API
  window.coffeeSounds = {
    play: playSound,
    playSound: playSound,
    playSequence: playSequence,
    setVolume: setVolume,
    setMasterVolume: setMasterVolume,
    test: testAllSounds,
    testSounds: testAllSounds,
    preload: preloadSounds,
    diagnose: diagnoseAudio,
    
    // Configuration
    enable: () => localStorage.setItem('coffee_sound_enabled', 'true'),
    disable: () => localStorage.setItem('coffee_sound_enabled', 'false'),
    isEnabled: () => localStorage.getItem('coffee_sound_enabled') !== 'false',
    
    // Per-sound configuration
    enableSound: (name) => localStorage.setItem(`coffee_sound_${name}`, 'true'),
    disableSound: (name) => localStorage.setItem(`coffee_sound_${name}`, 'false'),
    
    // Get available sounds
    getSounds: () => Object.keys(soundConfig).map(key => ({
      name: key,
      ...soundConfig[key]
    }))
  };
  
  // Auto-preload after a short delay
  setTimeout(preloadSounds, 1000);
  
  console.log('✅ Coffee Cue Sound System ready!');
  console.log('💡 Use window.coffeeSounds.test() to test all sounds');
  console.log('🔍 Use window.coffeeSounds.diagnose() to debug audio issues');
})();