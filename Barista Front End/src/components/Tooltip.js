// components/Tooltip.js
import React, { useState, useRef, useEffect } from 'react';

const Tooltip = ({ children, content, position = 'top', width = 'auto', delay = 400 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const targetRef = useRef(null);
  const tooltipRef = useRef(null);
  const timerRef = useRef(null);

  // Calculate position when tooltip becomes visible
  useEffect(() => {
    if (isVisible && targetRef.current && tooltipRef.current) {
      const targetRect = targetRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      
      let x = 0;
      let y = 0;
      
      // Position based on the specified direction
      switch (position) {
        case 'top':
          x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
          y = targetRect.top - tooltipRect.height - 8;
          break;
        case 'bottom':
          x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
          y = targetRect.bottom + 8;
          break;
        case 'left':
          x = targetRect.left - tooltipRect.width - 8;
          y = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
          break;
        case 'right':
          x = targetRect.right + 8;
          y = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
          break;
        default:
          x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
          y = targetRect.top - tooltipRect.height - 8;
      }
      
      // Prevent tooltip from going outside viewport
      const padding = 10;
      x = Math.max(padding, Math.min(x, window.innerWidth - tooltipRect.width - padding));
      y = Math.max(padding, Math.min(y, window.innerHeight - tooltipRect.height - padding));
      
      setCoords({ x, y });
    }
  }, [isVisible, position]);

  // Show tooltip with delay
  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  // Hide tooltip
  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsVisible(false);
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Get arrow position class
  const getArrowClass = () => {
    switch (position) {
      case 'top': return 'after:top-full after:left-1/2 after:-translate-x-1/2 after:border-t-gray-800';
      case 'bottom': return 'after:bottom-full after:left-1/2 after:-translate-x-1/2 after:border-b-gray-800';
      case 'left': return 'after:left-full after:top-1/2 after:-translate-y-1/2 after:border-l-gray-800';
      case 'right': return 'after:right-full after:top-1/2 after:-translate-y-1/2 after:border-r-gray-800';
      default: return 'after:top-full after:left-1/2 after:-translate-x-1/2 after:border-t-gray-800';
    }
  };

  return (
    <div 
      className="inline-block relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={targetRef}
    >
      {children}
      
      {isVisible && (
        <div
          ref={tooltipRef}
          className={`fixed z-50 bg-gray-800 text-white rounded shadow-lg
                     after:absolute after:content-[''] after:border-8 after:border-transparent
                     ${getArrowClass()} transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
          style={{
            left: `${coords.x}px`,
            top: `${coords.y}px`,
            width: width
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default Tooltip;
