// Audio fallback system for development mode
// This provides basic sound functionality when audio files aren't accessible

(function() {
  console.log('🔧 Audio fallback system loading...');
  
  // Simple beep sound using Web Audio API
  function createBeepSound(frequency = 440, duration = 200, volume = 0.3) {
    if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
      console.warn('Web Audio API not supported');
      return null;
    }
    
    const audioContext = new (AudioContext || webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration / 1000);
    
    return oscillator;
  }
  
  // Fallback sound definitions
  const fallbackSounds = {
    newOrder: () => createBeepSound(800, 300, 0.3),
    orderComplete: () => createBeepSound(600, 200, 0.3),
    orderPickedUp: () => createBeepSound(500, 150, 0.3),
    error: () => createBeepSound(300, 400, 0.4),
    lowStock: () => createBeepSound(400, 300, 0.4),
    success: () => createBeepSound(700, 200, 0.3)
  };
  
  // Enhanced coffee sounds system with fallback
  window.coffeeSoundsFallback = {
    play: function(soundName) {
      console.log(`🔊 Playing fallback sound: ${soundName}`);
      
      if (fallbackSounds[soundName]) {
        try {
          fallbackSounds[soundName]();
          console.log(`✅ Fallback sound played: ${soundName}`);
        } catch (error) {
          console.error(`❌ Fallback sound failed: ${soundName}`, error);
        }
      } else {
        console.warn(`❌ Unknown fallback sound: ${soundName}`);
      }
    },
    
    testSounds: function() {
      console.log('🎵 Testing all fallback sounds...');
      const sounds = Object.keys(fallbackSounds);
      sounds.forEach((sound, index) => {
        setTimeout(() => {
          this.play(sound);
        }, index * 500);
      });
    },
    
    diagnose: function() {
      console.log('🔍 Fallback audio system diagnostics:');
      console.log('- Web Audio API support:', typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined');
      console.log('- Available fallback sounds:', Object.keys(fallbackSounds));
      console.log('- This system generates synthetic beeps when audio files are not accessible');
    }
  };
  
  console.log('✅ Audio fallback system ready!');
  console.log('💡 Use window.coffeeSoundsFallback.testSounds() to test fallback sounds');
})();