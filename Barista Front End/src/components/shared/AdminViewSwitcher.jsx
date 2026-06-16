// components/shared/AdminViewSwitcher.jsx
//
// Small floating control that lets an ADMIN jump straight between the four
// areas (Organiser / Barista / Support / Display) without going back to the
// landing page. Admins can reach all views, so this saves a lot of clicks.
// Self-gates: renders nothing unless the logged-in user is an admin, and
// hides itself on the landing/login/display screens.
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Coffee, LayoutDashboard, LifeBuoy, Monitor, Shuffle, X } from 'lucide-react';
import AuthService from '../../services/AuthService';

const VIEWS = [
  { path: '/organiser', label: 'Organiser', Icon: LayoutDashboard, color: '#2563eb' },
  { path: '/barista',   label: 'Barista',   Icon: Coffee,          color: '#d97706' },
  { path: '/support',   label: 'Support',   Icon: LifeBuoy,        color: '#0d9488' },
  { path: '/displays',  label: 'Display',   Icon: Monitor,         color: '#7c3aed' },
];

const AdminViewSwitcher = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const role = (AuthService.getCurrentUser()?.role || '').toLowerCase();
  if (role !== 'admin') return null;
  // Don't clutter the public/landing/login or the customer-facing display.
  // Also hidden on /barista — that screen has its own "Switch view" control in
  // the header pill row (the floating one collided with the action bar there).
  if (['/', '/login', '/auth/login', '/display', '/barista'].includes(location.pathname)) return null;

  return (
    // RIGHT EDGE, vertically centred. It used to float bottom-left, where it
    // overlapped the Barista sticky action bar (Add Walk-in / Refresh) and the
    // bottom-right messages bubble — so it was "mostly hidden". The literal
    // top-right corner is occupied by the Barista header's own control pills
    // (and the full-width tab row just below), so the mid-right edge is the one
    // spot clear of the top header, tab row, bottom action bar AND the
    // bottom-right messages bubble across all four interfaces. The view list
    // drops DOWNWARD from the toggle (4 items fit in the lower half).
    // Hidden on mobile (hidden md:block): it's a desktop power-user convenience
    // and collides with the mobile header/drawer chrome. On phones, admins
    // switch via Back → Home.
    <div className="hidden md:block" style={{ position: 'fixed', top: '50%', right: 12, transform: 'translateY(-50%)', zIndex: 1000 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close view switcher' : 'Switch view'}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#1f2937', color: '#fff', border: 'none',
            borderRadius: 9999, padding: '10px 16px',
            boxShadow: '0 6px 18px rgba(0,0,0,0.3)', cursor: 'pointer',
            fontWeight: 600, fontSize: 14,
          }}
        >
          {open ? <X size={18} /> : <Shuffle size={18} />} {open ? 'Close' : 'Switch view'}
        </button>
        {open && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {VIEWS.map(v => {
              const active = location.pathname.startsWith(v.path.replace('/displays', '/display'));
              return (
                <button
                  key={v.path}
                  onClick={() => { setOpen(false); navigate(v.path); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, minWidth: 150,
                    background: '#fff', color: '#1f2937',
                    border: active ? `2px solid ${v.color}` : '1px solid #e5e7eb',
                    borderRadius: 10, padding: '9px 14px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', cursor: 'pointer',
                    fontWeight: 500, fontSize: 14,
                  }}
                >
                  <v.Icon size={18} style={{ color: v.color }} /> {v.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminViewSwitcher;
