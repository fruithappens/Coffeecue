// components/shared/AdminViewSwitcher.jsx
//
// Lets an ADMIN jump straight between the three areas (Barista / Runner /
// Screens) without going back to the landing page.
//
// Two shapes. `embedded` renders it as a header control, which is where it
// belongs and where /barista and /run already put their own. Without that
// prop it falls back to the floating pill for any page that has no header to
// live in.
//
// Steve, looking at the Screens page: "might be worth the switch view being
// up the top at screens ie click on that and get option to change view to
// barista or customer order etc." Right -- floating bottom-right it reads as
// something bolted on, and on a page that HAS a header there is no reason for
// it to float at all. Admins can reach all views, so this saves a lot of clicks.
// Self-gates: renders nothing unless the logged-in user is an admin, and
// hides itself on the landing/login/display screens.
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Coffee, LayoutDashboard, Monitor, Shuffle, X, Smartphone } from 'lucide-react';
import AuthService from '../../services/AuthService';

const VIEWS = [
  // THREE roles, not four interfaces. Organiser and Support became the one
  // runner app; a colour per area was replaced by an icon and a name, so
  // these all wear the same caramel (Steve: areas are told apart by icon,
  // name or graphic -- never by each owning a colour).
  { path: '/barista',  label: 'Barista', Icon: Coffee,          color: '#B8764A' },
  { path: '/run',      label: 'Runner',  Icon: LayoutDashboard, color: '#B8764A' },
  { path: '/displays', label: 'Screens', Icon: Monitor,         color: '#B8764A' },
  // The customer's own door. Steve: "get option to change view to barista or
  // customer order etc." An operator checking what the room actually sees
  // should not have to remember the URL.
  { path: '/order',    label: 'Order here', Icon: Smartphone,   color: '#B8764A', customer: true },
];

const AdminViewSwitcher = ({ embedded = false }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const role = (AuthService.getCurrentUser()?.role || '').toLowerCase();
  if (role !== 'admin') return null;
  // Don't clutter the public/landing/login or the customer-facing display.
  // Also hidden on /barista — that screen has its own "Switch view" control in
  // the header pill row (the floating one collided with the action bar there).
  // /displays now carries it in its own header too, so the floating copy
  // stands down there as well.
  if (!embedded && ['/', '/login', '/auth/login', '/display', '/barista', '/run', '/displays']
      .includes(location.pathname)) return null;

  const items = VIEWS.map((v) => {
    const active = location.pathname.startsWith(v.path.replace('/displays', '/display'));
    return { ...v, active };
  });

  // HEADER SHAPE: a pill that opens a small menu under itself, on the palette
  // rather than the raw greys the floating version was built with.
  if (embedded) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Close view switcher' : 'Switch view'}
          className="h-9 px-3 rounded-full border-2 border-white/25 text-sm font-bold
                     text-cq-cream/90 hover:bg-white/10 inline-flex items-center gap-1.5"
        >
          {open ? <X size={15} /> : <Shuffle size={15} />}
          <span className="hidden sm:inline">{open ? 'Close' : 'Switch view'}</span>
        </button>
        {open ? (
          <>
            <button type="button" aria-hidden tabIndex={-1}
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-40 cursor-default" />
            <div className="absolute right-0 mt-2 z-50 w-64 bg-cq-milk rounded-cq-lg
                            shadow-cq-raised p-1.5">
              {items.map((v) => (
                <React.Fragment key={v.path}>
                {v.customer ? <div className="my-1 border-t border-cq-line" /> : null}
                <button
                  type="button"
                  onClick={() => { setOpen(false); navigate(v.path); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-cq-md
                              text-left font-semibold whitespace-nowrap ${
                    v.active ? 'bg-cq-caramel-wash text-cq-roast'
                             : 'text-cq-ink-2 hover:bg-cq-wash'}`}
                >
                  <v.Icon size={17} className="text-cq-caramel" />
                  {v.label}
                  {v.active ? (
                    <span className="ml-auto text-xs font-bold text-cq-ink-3 whitespace-nowrap">here</span>
                  ) : v.customer ? (
                    <span className="ml-auto text-xs text-cq-ink-3 whitespace-nowrap">customer</span>
                  ) : null}
                </button>
                </React.Fragment>
              ))}
            </div>
          </>
        ) : null}
      </div>
    );
  }

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
