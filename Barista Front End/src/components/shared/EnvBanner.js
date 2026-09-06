import React, { useEffect, useState } from 'react';

// Unmissable "TEST COPY" stripe on every screen of any environment that is
// not production (GET /api/env). Production returns env=production and this
// renders nothing. Exists so the copy of CupQ used to judge the
// re-imagining can never be mistaken for the live app -- by anyone, on any
// device, including a TV.
export default function EnvBanner() {
  const [env, setEnv] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/env').then((r) => (r.ok ? r.json() : null)).then((b) => {
      if (!cancelled && b && b.test_copy) setEnv(b.env);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!env) return undefined;
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = '22px';
    return () => { document.body.style.paddingTop = prev; };
  }, [env]);
  if (!env) return null;
  return (
    <div
      role="status"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 22, zIndex: 100000,
        background: 'repeating-linear-gradient(135deg,#B4472F 0 14px,#8E2F1E 14px 28px)',
        color: '#fff', font: '700 12px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        letterSpacing: '.12em', textTransform: 'uppercase', textAlign: 'center', pointerEvents: 'none' }}
    >
      Test copy ({env}) &mdash; not the live app &middot; nothing here texts anyone
    </div>
  );
}
