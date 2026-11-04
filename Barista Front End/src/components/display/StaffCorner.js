// StaffCorner.js — the small button in the top corner of the customer pages
// that takes staff to sign-in, so nobody has to type /login. It has no label
// on purpose (Steve): baristas are told it's there, customers don't need it.
// A device that's already signed in goes straight on to its own screen; the
// login page does that. Not on the kiosk or the board: those are public
// screens with no reason to lead anywhere else.
//
// Fixed and above the order sheet, which covers the whole page. It goes away
// once anything scrolls, so a customer can't tap it instead of a drink and
// lose their order.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';

export default function StaffCorner() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (e) => {
      const el = e.target === document ? document.documentElement : e.target;
      setScrolled((el.scrollTop || 0) > 8);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, []);

  if (scrolled) return null;
  return (
    <Link
      to="/login"
      aria-label="Staff sign in"
      title="Staff sign in"
      className="fixed top-0 left-0 flex h-11 w-11 items-center justify-center text-cq-roast opacity-50 hover:opacity-80 focus:opacity-100"
      style={{ zIndex: 9999 }}
    >
      <LogIn size={16} aria-hidden="true" />
    </Link>
  );
}
