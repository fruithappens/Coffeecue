// AccountRecoveryPages.js — /forgot-password and /reset-password (16 Oct 2026).
//
// People reset their own password by email instead of asking Steve or their
// organiser. The server answers the same whether or not the login exists,
// and the link works once, for 30 minutes (routes/account_recovery_routes.py).
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

const Card = ({ title, children }) => (
  <div className="cq min-h-screen bg-cq-cream flex items-center justify-center px-4 py-10">
    <div className="w-full max-w-sm bg-cq-milk rounded-cq-xl shadow-cq-card p-6 space-y-4">
      <div className="text-sm font-bold text-cq-caramel-deep tracking-wide">CupQ</div>
      <h1 className="text-2xl font-extrabold text-cq-roast">{title}</h1>
      {children}
    </div>
  </div>
);

const input = 'w-full h-11 px-3 rounded-cq-md border-2 border-cq-line focus:border-cq-caramel outline-none';
const button = 'w-full h-11 rounded-cq-md bg-cq-caramel text-white font-bold hover:bg-cq-caramel-deep disabled:opacity-50';

const post = async (path, body) => {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch (e) { /* not JSON */ }
  if (r.status === 429) return { ok: false, message: 'Too many tries. Wait a while, then try again.' };
  return { ok: r.ok && j.success !== false, message: j.message || (r.ok ? '' : 'Something went wrong. Try again.') };
};

export const ForgotPasswordPage = () => {
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { document.title = 'Forgot password | CupQ'; }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await post('/api/auth/forgot-password', { login: login.trim() });
    setBusy(false);
    if (r.ok) setDone(r.message); else setErr(r.message);
  };
  return (
    <Card title="Forgot your password?">
      {done ? (
        <>
          <p className="text-cq-ink-2 leading-relaxed">{done}</p>
          <Link to="/login" className="block text-center font-bold text-cq-caramel-deep">Back to sign in</Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-cq-ink-2 text-sm">Type your username or email. We'll email you a link to choose a new password.</p>
          <input className={input} value={login} onChange={e => setLogin(e.target.value)}
            placeholder="Username or email" autoComplete="username" autoFocus aria-label="Username or email" />
          {err && <p className="text-sm text-cq-alert">{err}</p>}
          <button type="submit" className={button} disabled={busy || !login.trim()}>
            {busy ? 'Sending…' : 'Email me a link'}
          </button>
          <Link to="/login" className="block text-center text-sm text-cq-ink-3">Back to sign in</Link>
        </form>
      )}
    </Card>
  );
};

export const ResetPasswordPage = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { document.title = 'Choose a new password | CupQ'; }, []);
  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) { setErr('Use at least 8 characters.'); return; }
    if (pw !== pw2) { setErr("The two passwords don't match."); return; }
    setBusy(true); setErr('');
    const r = await post('/api/auth/reset-password', { token, password: pw });
    setBusy(false);
    if (r.ok) setDone(r.message); else setErr(r.message);
  };
  if (!token) {
    return (
      <Card title="This link isn't complete">
        <p className="text-cq-ink-2">Open the link from the email again, or ask for a new one.</p>
        <Link to="/forgot-password" className="block text-center font-bold text-cq-caramel-deep">Ask for a new link</Link>
      </Card>
    );
  }
  return (
    <Card title="Choose a new password">
      {done ? (
        <>
          <p className="text-cq-ink-2">{done}</p>
          <Link to="/login" className={`${button} flex items-center justify-center`}>Sign in</Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input className={input} type="password" value={pw} onChange={e => setPw(e.target.value)}
            placeholder="New password (8 or more characters)" autoComplete="new-password" autoFocus aria-label="New password" />
          <input className={input} type="password" value={pw2} onChange={e => setPw2(e.target.value)}
            placeholder="The same again" autoComplete="new-password" aria-label="New password again" />
          {err && (
            <p className="text-sm text-cq-alert">
              {err}{' '}
              {/expired|valid|used/i.test(err) && <Link to="/forgot-password" className="font-bold underline">Ask for a new link</Link>}
            </p>
          )}
          <button type="submit" className={button} disabled={busy || !pw || !pw2}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
    </Card>
  );
};
