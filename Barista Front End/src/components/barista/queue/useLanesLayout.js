// Lanes or a column? A landscape tablet or any laptop gets three lanes side
// by side (the bird's-eye view Steve asked for: eight on the bench, twenty
// waiting, five to hand over, no scrolling to find a heading). A phone or a
// portrait tablet keeps the single column with a jump bar and a pinned
// Ready strip.
import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1024px) and (orientation: landscape), (min-width: 1280px)';

export default function useLanesLayout() {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : false);
  const [lanes, setLanes] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setLanes(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', onChange); else mq.removeListener(onChange); };
  }, []);
  return lanes;
}
