import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types.ts';
import { api } from '../api.ts';
import { X, CheckCircle2, Shield, Store, Users, Landmark } from 'lucide-react';

/* ------------------------------------------------------------------
   Buyoll Auth Component – animated Login / Sign-up for 4 roles:
   Roles: member | merchant | lender | admin
   Props:
     onClose: () => void
     onSuccess: (user: User, targetRoute?: string) => void
     onNotify: (type: 'success' | 'error' | 'info', message: string) => void
     initialRole?: 'member' | 'merchant' | 'lender' | 'admin'
------------------------------------------------------------------- */

export const ROLES = {
  member: {
    label: 'Member',
    nameLabel: 'Full name',
    canRegister: true,
    loginTitle: 'Welcome back!',
    loginText: 'Pick up where you left off and check your balance, repayments and rewards.',
    regTitle: 'Join the circle',
    regText: 'Create a member account to save, borrow and shop with trusted merchants.',
    defaultEmail: 'samuel@buyoll.com',
  },
  merchant: {
    label: 'Merchant',
    nameLabel: 'Business name',
    canRegister: true,
    loginTitle: 'Good to see you',
    loginText: 'Manage your store, orders and settlements in one place.',
    regTitle: 'Grow your store',
    regText: 'Register your business to accept members and get paid faster.',
    defaultEmail: 'direct@buyoll.com',
  },
  lender: {
    label: 'Lender',
    nameLabel: 'Institution / Full name',
    canRegister: true,
    loginTitle: 'Welcome back',
    loginText: 'Review applications, portfolio performance and repayments.',
    regTitle: 'Fund with confidence',
    regText: 'Register as a lender to reach verified members and merchants.',
    defaultEmail: 'grace.lender@buyoll.com',
  },
  admin: {
    label: 'Admin',
    nameLabel: '',
    canRegister: false,
    loginTitle: 'Admin console',
    loginText: 'Restricted access. Admin accounts are created by invitation only.',
    regTitle: '',
    regText: '',
    defaultEmail: 'cityandcountyre@gmail.com',
  },
} as const;

export type RoleKey = keyof typeof ROLES;

export const ROLE_ROUTES: Record<RoleKey, string> = {
  member: 'my-chamas',
  merchant: 'vendor-dashboard',
  lender: 'lenders-dashboard',
  admin: 'admin-dashboard',
};

const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5Z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 8L4 7.5V8l8 5.5L20 8v-.5Z" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9Zm-8-2a3 3 0 0 1 6 0v2H9Z" />
  </svg>
);

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  icon: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
}

function Field({ id, label, type = 'text', icon, value, onChange, autoComplete }: FieldProps) {
  return (
    <div className="ax-field">
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder=" "
        required
        autoComplete={autoComplete}
      />
      <label htmlFor={id}>{label}</label>
      <span className="ax-icon">{icon}</span>
    </div>
  );
}

interface AuthModalProps {
  onClose: () => void;
  onSuccess: (user: User, targetRoute?: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  initialRole?: RoleKey;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  onClose,
  onSuccess,
  onNotify,
  initialRole = 'member',
}) => {
  const [role, setRole] = useState<RoleKey>(initialRole);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [login, setLogin] = useState({ identifier: '', password: '' });
  const [reg, setReg] = useState({ name: '', email: '', password: '' });

  const cfg = ROLES[role];
  const active = mode === 'register' && cfg.canRegister;

  const pickRole = (r: RoleKey) => {
    setRole(r);
    setError('');
    setNotice('');
    if (!ROLES[r].canRegister) setMode('login');
  };

  const switchMode = (m: 'login' | 'register') => {
    setError('');
    setNotice('');
    setMode(m);
  };

  // One-click demo credentials autofill
  const handleUseDemo = (targetRole: RoleKey) => {
    pickRole(targetRole);
    setMode('login');
    setLogin({
      identifier: ROLES[targetRole].defaultEmail,
      password: 'password123',
    });
    setNotice(`Loaded demo ${ROLES[targetRole].label} credentials (${ROLES[targetRole].defaultEmail}). Click Log In.`);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.login({
        role,
        identifier: login.identifier.trim(),
        password: login.password.trim() || undefined,
      });

      onNotify('success', res.notice || `Welcome back, ${res.user.name}!`);
      onSuccess(res.user, ROLE_ROUTES[role]);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please verify your credentials.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.register({
        role,
        name: reg.name.trim(),
        email: reg.email.trim(),
        password: reg.password.trim(),
      });

      onNotify('success', res.notice || `Account created successfully! Welcome to Buyoll.`);
      onSuccess(res.user, ROLE_ROUTES[role]);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not create account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <style>{css}</style>

      <div className="relative w-full max-w-[940px] flex flex-col items-center">
        {/* Close Button at top corner */}
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute -top-12 right-0 sm:-right-3 text-white/80 hover:text-white bg-black/40 hover:bg-black/70 p-2 rounded-full transition-all z-50 cursor-pointer shadow-md"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Main Card with Animated Diagonal */}
        <div className={`ax-box ${active ? 'is-active' : ''}`}>
          <div className="ax-diagonal" aria-hidden="true" />

          {/* Role picker tabs */}
          <div className="ax-roles" role="tablist" aria-label="Account type">
            {(Object.keys(ROLES) as RoleKey[]).map((key) => {
              const r = ROLES[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={role === key}
                  className={role === key ? 'on' : ''}
                  onClick={() => pickRole(key)}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* LOGIN FORM */}
          <form className="ax-form ax-login" onSubmit={handleLoginSubmit} aria-hidden={active}>
            <div className="flex items-center justify-center gap-2 mb-2">
              <img
                src="./buyoll_logo.png"
                alt="Buyoll"
                className="h-8 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <h1 className="ax-anim" style={{ '--li': 0 } as React.CSSProperties}>
              {cfg.label} login
            </h1>

            <div className="ax-anim" style={{ '--li': 1 } as React.CSSProperties}>
              <Field
                id="l-id"
                label="Email or Phone number"
                type="text"
                icon={<MailIcon />}
                autoComplete="email"
                value={login.identifier}
                onChange={(e) => setLogin({ ...login, identifier: e.target.value })}
              />
            </div>

            <div className="ax-anim" style={{ '--li': 2 } as React.CSSProperties}>
              <Field
                id="l-pw"
                label="Password"
                type="password"
                icon={<LockIcon />}
                autoComplete="current-password"
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.target.value })}
              />
            </div>

            <div className="ax-anim" style={{ '--li': 3 } as React.CSSProperties}>
              <button className="ax-btn" disabled={busy} type="submit">
                {busy && !active ? 'Logging in…' : `Log in as ${cfg.label}`}
              </button>
            </div>

            {error && !active && (
              <p className="ax-error" role="alert">
                {error}
              </p>
            )}
            {notice && !active && (
              <p className="ax-notice" role="status">
                {notice}
              </p>
            )}

            <p className="ax-alt ax-anim" style={{ '--li': 4 } as React.CSSProperties}>
              {cfg.canRegister ? (
                <>
                  No account yet?{' '}
                  <button type="button" onClick={() => switchMode('register')}>
                    Sign up
                  </button>
                </>
              ) : (
                'Admin accounts are created by invitation.'
              )}
            </p>
          </form>

          {/* REGISTER FORM */}
          <form className="ax-form ax-register" onSubmit={handleRegisterSubmit} aria-hidden={!active}>
            <div className="flex items-center justify-center gap-2 mb-2">
              <img
                src="./buyoll_logo.png"
                alt="Buyoll"
                className="h-8 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <h1 className="ax-anim" style={{ '--li': 0 } as React.CSSProperties}>
              {cfg.label} sign-up
            </h1>

            <div className="ax-anim" style={{ '--li': 1 } as React.CSSProperties}>
              <Field
                id="r-name"
                label={cfg.nameLabel || 'Name'}
                icon={<UserIcon />}
                autoComplete="name"
                value={reg.name}
                onChange={(e) => setReg({ ...reg, name: e.target.value })}
              />
            </div>

            <div className="ax-anim" style={{ '--li': 2 } as React.CSSProperties}>
              <Field
                id="r-mail"
                label="Email address"
                type="email"
                icon={<MailIcon />}
                autoComplete="email"
                value={reg.email}
                onChange={(e) => setReg({ ...reg, email: e.target.value })}
              />
            </div>

            <div className="ax-anim" style={{ '--li': 3 } as React.CSSProperties}>
              <Field
                id="r-pw"
                label="Password (min 4 chars)"
                type="password"
                icon={<LockIcon />}
                autoComplete="new-password"
                value={reg.password}
                onChange={(e) => setReg({ ...reg, password: e.target.value })}
              />
            </div>

            <div className="ax-anim" style={{ '--li': 4 } as React.CSSProperties}>
              <button className="ax-btn" disabled={busy} type="submit">
                {busy && active ? 'Creating account…' : 'Create account'}
              </button>
            </div>

            {error && active && (
              <p className="ax-error" role="alert">
                {error}
              </p>
            )}

            <p className="ax-alt ax-anim" style={{ '--li': 5 } as React.CSSProperties}>
              Already registered?{' '}
              <button type="button" onClick={() => switchMode('login')}>
                Log in
              </button>
            </p>
          </form>

          {/* Info panels sitting on the green diagonal */}
          <aside className="ax-info ax-info-login">
            <h2>{cfg.loginTitle}</h2>
            <p>{cfg.loginText}</p>
          </aside>
          <aside className="ax-info ax-info-register">
            <h2>{cfg.regTitle || cfg.loginTitle}</h2>
            <p>{cfg.regText || cfg.loginText}</p>
          </aside>
        </div>

        {/* Demo Fast-Login Pills for Seamless Testing */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-[11px] text-slate-300">
          <span className="font-semibold text-slate-400">Quick Demo Logins:</span>
          <button
            type="button"
            onClick={() => handleUseDemo('member')}
            className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-emerald-300" />
            <span>Member (Samuel)</span>
          </button>
          <button
            type="button"
            onClick={() => handleUseDemo('merchant')}
            className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Store className="w-3.5 h-3.5 text-teal-300" />
            <span>Merchant (Buyoll Direct)</span>
          </button>
          <button
            type="button"
            onClick={() => handleUseDemo('lender')}
            className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Landmark className="w-3.5 h-3.5 text-amber-300" />
            <span>Lender (Grace)</span>
          </button>
          <button
            type="button"
            onClick={() => handleUseDemo('admin')}
            className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5 text-purple-300" />
            <span>Admin (Buyoll System)</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');

.ax-box {
  --bg: #ffffff;
  --ink: #12301f;
  --mute: #5f7366;
  --o1: #15803d;
  --o2: #0a4d27;
  --g3: #22b25a;
  position: relative;
  width: min(920px, 100%);
  height: 600px;
  background: var(--bg);
  overflow: hidden;
  border-radius: 20px;
  border: 2px solid var(--o1);
  box-shadow: 0 10px 35px rgba(21, 128, 61, 0.35), inset 0 0 22px rgba(34, 178, 90, 0.1);
  font-family: 'Poppins', system-ui, sans-serif;
  color: var(--ink);
}

:root[data-theme="dark"] .ax-box,
.dark .ax-box {
  --bg: #111A17;
  --ink: #F3F4F6;
  --mute: #A7B0AB;
  --o1: #4ADE9A;
  --o2: #0a3d20;
  --g3: #12372A;
  border-color: #24312C;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7), inset 0 0 22px rgba(74, 222, 154, 0.05);
}

.ax-diagonal {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, var(--o2), var(--g3));
  clip-path: polygon(45% 0, 100% 0, 100% 100%, 78% 100%);
  transition: clip-path 0.9s ease;
}

.is-active .ax-diagonal {
  clip-path: polygon(0 0, 55% 0, 22% 100%, 0 100%);
}

.ax-roles {
  position: absolute;
  z-index: 10;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid #cfe3d6;
  box-shadow: 0 2px 10px rgba(10, 77, 39, 0.15);
  border-radius: 999px;
}

:root[data-theme="dark"] .ax-roles,
.dark .ax-roles {
  background: #1A2622;
  border-color: #24312C;
  box-shadow: 0 4px 14px rgba(0,0,0,0.4);
}

.ax-roles button {
  border: 0;
  background: none;
  color: var(--mute);
  font: 500 12.5px 'Poppins', sans-serif;
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: 0.25s;
}

.ax-roles button:hover {
  color: var(--o1);
}

.ax-roles button.on {
  background: linear-gradient(90deg, var(--o2), var(--o1));
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.ax-form {
  position: absolute;
  top: 0;
  width: 50%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 60px 44px 20px;
  z-index: 4;
}

.ax-login {
  left: 0;
}

.ax-register {
  right: 0;
}

.ax-form h1 {
  font-size: 26px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 14px;
  color: var(--ink);
}

/* Staggered slide / blur animation */
.ax-anim {
  transition: transform 0.7s ease, opacity 0.7s ease, filter 0.7s ease;
  transition-delay: calc(0.1s * var(--li, 0));
}

.ax-login .ax-anim {
  transform: translateX(0);
  opacity: 1;
  filter: none;
}

.ax-register .ax-anim {
  transform: translateX(120%);
  opacity: 0;
  filter: blur(10px);
  transition-delay: 0s;
}

.is-active .ax-login .ax-anim {
  transform: translateX(-120%);
  opacity: 0;
  filter: blur(10px);
  transition-delay: 0s;
}

.is-active .ax-register .ax-anim {
  transform: translateX(0);
  opacity: 1;
  filter: none;
  transition-delay: calc(0.35s + 0.1s * var(--li, 0));
}

.ax-login:not([aria-hidden="true"]) .ax-anim {
  transition-delay: calc(0.35s + 0.1s * var(--li, 0));
}

.ax-form[aria-hidden="true"] {
  pointer-events: none;
}

.ax-field {
  position: relative;
  margin: 16px 0;
}

.ax-field input {
  width: 100%;
  background: none;
  border: 0;
  border-bottom: 2px solid #c3d3c9;
  color: var(--ink);
  font: 500 14px 'Poppins', sans-serif;
  padding: 8px 30px 6px 0;
  outline: 0;
  transition: border-color 0.3s;
}

:root[data-theme="dark"] .ax-field input,
.dark .ax-field input {
  border-bottom-color: #24312C;
}

.ax-field input:focus {
  border-color: var(--o1);
}

.ax-field label {
  position: absolute;
  left: 0;
  top: 8px;
  font-size: 13.5px;
  color: var(--mute);
  pointer-events: none;
  transition: 0.3s;
}

.ax-field input:focus + label,
.ax-field input:not(:placeholder-shown) + label {
  top: -14px;
  font-size: 11.5px;
  color: var(--o1);
  font-weight: 600;
}

.ax-icon {
  position: absolute;
  right: 0;
  top: 8px;
  color: #8aa093;
  display: flex;
}

.ax-field input:focus ~ .ax-icon {
  color: var(--o1);
}

.ax-btn {
  width: 100%;
  margin-top: 6px;
  padding: 11px;
  border: 2px solid var(--o1);
  border-radius: 999px;
  cursor: pointer;
  font: 600 14px 'Poppins', sans-serif;
  color: #ffffff;
  background: linear-gradient(90deg, var(--o2), var(--o1));
  box-shadow: 0 4px 14px rgba(21, 128, 61, 0.3);
  transition: box-shadow 0.3s, transform 0.2s;
}

.ax-btn:hover:not(:disabled) {
  box-shadow: 0 6px 20px rgba(21, 128, 61, 0.5);
  transform: translateY(-1px);
}

.ax-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.ax-alt {
  text-align: center;
  font-size: 12.5px;
  margin: 14px 0 0;
  color: var(--mute);
}

.ax-alt button {
  background: none;
  border: 0;
  color: var(--o1);
  font: 600 12.5px 'Poppins', sans-serif;
  cursor: pointer;
  padding: 0;
}

.ax-alt button:hover {
  text-decoration: underline;
}

.ax-notice {
  margin: 10px 0 0;
  font-size: 12.5px;
  text-align: center;
  color: #15803d;
  font-weight: 500;
}

:root[data-theme="dark"] .ax-notice,
.dark .ax-notice {
  color: #4ADE9A;
}

.ax-error {
  margin: 10px 0 0;
  font-size: 12.5px;
  text-align: center;
  color: #dc2626;
  font-weight: 500;
}

.ax-info {
  position: absolute;
  z-index: 2;
  width: 44%;
  top: 50%;
  transform: translateY(-50%);
  transition: opacity 0.6s, transform 0.8s;
  padding: 0 10px;
}

.ax-info h2 {
  color: #ffffff;
  font-size: 28px;
  line-height: 1.15;
  margin: 0 0 10px;
  font-weight: 700;
}

.ax-info p {
  font-size: 13.5px;
  line-height: 1.55;
  margin: 0;
  color: #ffffff;
  opacity: 0.95;
}

.ax-info-login {
  right: 32px;
  text-align: right;
}

.ax-info-register {
  left: 32px;
  text-align: left;
  opacity: 0;
  transform: translateY(-50%) translateX(-60px);
  pointer-events: none;
}

.is-active .ax-info-login {
  opacity: 0;
  transform: translateY(-50%) translateX(60px);
}

.is-active .ax-info-register {
  opacity: 1;
  transform: translateY(-50%);
  transition-delay: 0.4s;
}

@media (max-width: 720px) {
  .ax-box {
    height: auto;
    min-height: 560px;
    border-width: 1px;
  }
  .ax-diagonal,
  .ax-info {
    display: none;
  }
  .ax-roles {
    left: 12px;
    right: 12px;
    transform: none;
    justify-content: space-between;
  }
  .ax-roles button {
    flex: 1;
    padding: 6px 2px;
    font-size: 11.5px;
  }
  .ax-form {
    width: 100%;
    padding: 80px 22px 24px;
  }
  .ax-register {
    display: none;
  }
  .is-active .ax-register {
    display: flex;
  }
  .is-active .ax-login {
    display: none;
  }
  .ax-login .ax-anim,
  .ax-register .ax-anim,
  .is-active .ax-register .ax-anim {
    transform: none;
    opacity: 1;
    filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ax-anim,
  .ax-diagonal,
  .ax-info {
    transition: none !important;
  }
}
`;
