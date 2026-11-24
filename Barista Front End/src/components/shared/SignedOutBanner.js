// SignedOutBanner.js -- staff screens only: "you've been signed out".
//
// A banner, not a bounce to the login page: a barista may have a customer's
// order half-typed, and can finish reading the screen first.
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AuthService from '../../services/AuthService';
import { isPublicPath } from '../../utils/publicPaths';
import { SIGNED_IN, SIGNED_OUT, isSignedOut } from '../../utils/signedOut';

const SignedOutBanner = () => {
  const { pathname } = useLocation();
  const [out, setOut] = useState(isSignedOut());
  useEffect(() => {
    const on = () => setOut(true);
    const off = () => setOut(false);
    window.addEventListener(SIGNED_OUT, on);
    window.addEventListener(SIGNED_IN, off);
    return () => {
      window.removeEventListener(SIGNED_OUT, on);
      window.removeEventListener(SIGNED_IN, off);
    };
  }, []);

  if (!out || pathname === '/' || pathname.startsWith('/login') || isPublicPath(pathname)) return null;
  return (
    <div role="alert"
      className="cq fixed top-0 inset-x-0 z-[200] flex flex-wrap items-center justify-center gap-3 px-4 py-3 bg-cq-alert text-white shadow-cq-card">
      <span className="font-bold">You've been signed out, so this screen has stopped updating.</span>
      <button type="button"
        onClick={() => AuthService.forceLogoutWithMessage('Sign in again to carry on.')}
        className="h-11 px-5 rounded-cq-md bg-white text-cq-roast font-bold">Sign in</button>
    </div>
  );
};

export default SignedOutBanner;
