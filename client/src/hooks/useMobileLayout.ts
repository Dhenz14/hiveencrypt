import { useState, useEffect } from 'react';

export function useMobileLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return { isMobile, showChat, setShowChat };
}
