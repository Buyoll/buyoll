import React, { useState, useEffect } from 'react';
import { User } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import { X, Eye, EyeOff, AtSign, Phone, KeyRound, ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react';

export interface RoleConfig {
  label: string;
  nameLabel: string;
  canRegister: boolean;
  loginTitle: string;
  loginText: string;
  regTitle: string;
  regText: string;
}

export const ROLES: Record<string, RoleConfig> = {
  member: {
    label: 'Member',
    nameLabel: 'Full name',
    canRegister: true,
    loginTitle: 'Welcome back!',
    loginText: 'Pick up where you left off and check your balance, repayments and rewards.',
    regTitle: 'Join the circle',
    regText: 'Create a member account to save, borrow and shop with trusted merchants.',
  },
  merchant: {
    label: 'Merchant',
    nameLabel: 'Business / Shop name',
    canRegister: true,
    loginTitle: 'Good to see you',
    loginText: 'Manage your store, orders and settlements in one place.',
    regTitle: 'Merchant registration',
    regText: 'Register your merchant business on Buyoll to launch product Groups and accept member orders.',
  },
  lender: {
    label: 'Lender',
    nameLabel: 'Institution / Full name',
    canRegister: true,
    loginTitle: 'Welcome back',
    loginText: 'Review applications, portfolio performance and repayments.',
    regTitle: 'Lender registration',
    regText: 'Accredit your lending profile on Buyoll to fund Group emergency advances and earn interest.',
  },
  admin: {
    label: 'Admin',
    nameLabel: 'Admin full name',
    canRegister: false,
    loginTitle: 'Admin console',
    loginText: 'Restricted access. Sign in with your administrator username/email, password, and security passkey.',
    regTitle: 'Admin access closed',
    regText: 'Administrator self-registration is permanently disabled.',
  },
};

export type RoleKey = 'member' | 'merchant' | 'lender' | 'admin';

export const ROLE_ROUTES: Record<RoleKey, string> = {
  member: 'home',
  merchant: 'vendor-dashboard',
  lender: 'lenders-dashboard',
  admin: 'admin-dashboard',
};

const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5Z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
    <path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 8L4 7.5V8l8 5.5L20 8v-.5Z" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
    <path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9Zm-8-2a3 3 0 0 1 6 0v2H9Z" />
  </svg>
);

function validatePasswordRule(pw: string): string | null {
  if (!pw || pw.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return 'Password must include at least one letter and one number.';
  }
  return null;
}

function computePasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'bg-slate-200' };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;

  if (pw.length < 8) return { score: 1, label: 'Too short (min 8)', color: 'bg-red-500' };
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return { score: 1, label: 'Needs letter & number', color: 'bg-amber-500' };
  }
  if (score < 3) return { score: 2, label: 'Fair', color: 'bg-amber-500' };
  if (score < 4) return { score: 3, label: 'Good', color: 'bg-emerald-500' };
  return { score: 4, label: 'Strong', color: 'bg-emerald-600' };
}

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  icon: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  required?: boolean;
  errorText?: string;
  rightToggle?: React.ReactNode;
}

function Field({
  id,
  label,
  type = 'text',
  icon,
  value,
  onChange,
  autoComplete,
  required = true,
  errorText,
  rightToggle,
}: FieldProps) {
  return (
    <div className="ax-field-wrap">
      <div className="ax-field">
        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder=" "
          required={required}
          autoComplete={autoComplete}
        />
        <label htmlFor={id}>{label}</label>
        <span className="ax-icon">
          {rightToggle ? rightToggle : icon}
        </span>
      </div>
      {errorText && <p className="ax-field-err">{errorText}</p>}
    </div>
  );
}

interface AuthModalProps {
  onClose: () => void;
  onSuccess: (user: User, targetRoute?: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  initialRole?: RoleKey;
  portalMode?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  onClose,
  onSuccess,
  onNotify,
  initialRole = 'member',
  portalMode = false,
}) => {
  const effectiveInitialRole: RoleKey = portalMode ? 'admin' : initialRole === 'admin' ? 'member' : initialRole;
  const [role, setRole] = useState<RoleKey>(effectiveInitialRole);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);

  const [login, setLogin] = useState({
    identifier: '',
    password: '',
    passkey: '',
    rememberMe: true,
  });
  const [reg, setReg] = useState({
    name: '',
    username: '',
    email: '',
    phone: '',
    password: '',
  });

  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showLoginPasskey, setShowLoginPasskey] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);
  const [showResetPasskey, setShowResetPasskey] = useState(false);

  const [usernameStatus, setUsernameStatus] = useState<{ checking: boolean; available?: boolean; message?: string }>({
    checking: false,
  });

  // Forgot & Reset OTP state (Password, Username, or Admin Recovery)
  const [forgotType, setForgotType] = useState<'forgot_password' | 'forgot_username'>('forgot_password');
  const [forgotStep, setForgotStep] = useState<'request' | 'verify' | 'reset'>('request');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [resetNewPw, setResetNewPw] = useState('');
  const [resetNewPasskey, setResetNewPasskey] = useState('');
  const [resetNewUsername, setResetNewUsername] = useState('');
  const [recoveredUsername, setRecoveredUsername] = useState('');

  useEffect(() => {
    if (portalMode) {
      setRole('admin');
      setMode('login');
    }
  }, [portalMode]);

  useEffect(() => {
    const clean = reg.username.trim();
    if (mode !== 'register' || !clean) {
      setUsernameStatus({ checking: false });
      return;
    }
    if (clean.length < 3 || clean.length > 30) {
      setUsernameStatus({ checking: false, available: false, message: 'Username must be 3–30 characters.' });
      return;
    }
    const timer = setTimeout(() => {
      setUsernameStatus({ checking: true });
      api
        .checkUsername(clean)
        .then((res) => {
          setUsernameStatus({
            checking: false,
            available: res.valid && res.available,
            message: res.valid
              ? res.available
                ? 'Username available'
                : res.message || 'That username is not available. Please choose a different one.'
              : res.message || 'Invalid username format.',
          });
        })
        .catch(() => setUsernameStatus({ checking: false }));
    }, 300);
    return () => clearTimeout(timer);
  }, [reg.username, mode]);

  const cfg = ROLES[role];
  const canRegisterEffective = !portalMode && role !== 'admin' && cfg.canRegister;
  const active = mode === 'register' && canRegisterEffective;
  const strength = computePasswordStrength(reg.password);
  const resetStrength = computePasswordStrength(resetNewPw);

  const pickRole = (r: RoleKey) => {
    if (!portalMode && r === 'admin') return;
    if (portalMode && r !== 'admin') return;
    setRole(r);
    setError('');
    setNotice('');
    setFieldErrors({});
    setShowRecoveryPrompt(false);
    setFailedAttempts(0);
  };

  const switchMode = (m: 'login' | 'register' | 'forgot', nextForgotType: 'forgot_password' | 'forgot_username' = 'forgot_password') => {
    if (m === 'register' && (portalMode || role === 'admin')) {
      setError('Administrator registration is disabled.');
      return;
    }
    setError('');
    setNotice('');
    setFieldErrors({});
    if (m === 'forgot') {
      setForgotType(nextForgotType);
      setForgotStep('request');
      setForgotIdentifier(login.identifier.trim() || '');
      setForgotOtp('');
      setVerificationToken('');
      setResetNewPw('');
      setResetNewPasskey('');
      setResetNewUsername('');
      setRecoveredUsername('');
    }
    setMode(m);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setFieldErrors({});

    if (!login.identifier.trim()) {
      setFieldErrors({ identifier: portalMode ? 'Please enter your admin username or email.' : 'Please enter your username, email, or phone number.' });
      return;
    }

    if (portalMode) {
      if (!login.password) {
        setFieldErrors({ password: 'Please enter your administrator password.' });
        return;
      }
      if (!login.passkey) {
        setFieldErrors({ passkey: 'Please enter your administrator security passkey.' });
        return;
      }
    }

    setBusy(true);
    try {
      const res = portalMode
        ? await api.adminLogin({
            identifier: login.identifier.trim(),
            password: login.password,
            passkey: login.passkey,
            rememberMe: login.rememberMe,
          })
        : await api.login({
            role,
            identifier: login.identifier.trim(),
            password: login.password,
            rememberMe: login.rememberMe,
          });

      setFailedAttempts(0);
      setShowRecoveryPrompt(false);
      onNotify('success', res.notice || `Welcome back, ${res.user.name}!`);
      const userActiveRole = (res.user.activeRole || res.user.role || role) as RoleKey;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('user:login'));
      }
      onSuccess(res.user, ROLE_ROUTES[userActiveRole] || 'home');
      onClose();
    } catch (err: any) {
      if (err?.fields) setFieldErrors(err.fields);
      const nextFails = failedAttempts + 1;
      setFailedAttempts(nextFails);
      if (!portalMode && (err?.fields?.showRecoveryPrompt === 'true' || nextFails >= 3)) {
        setShowRecoveryPrompt(true);
      }
      setError(err?.message || 'Login failed. Please verify your credentials.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (portalMode || role === 'admin') {
      setError('Administrator registration is disabled.');
      return;
    }
    setError('');
    setNotice('');
    const errs: Record<string, string> = {};

    const cleanName = reg.name.trim();
    const cleanUn = reg.username.trim();
    const cleanEmail = reg.email.trim().toLowerCase();

    if (cleanName.length < 2) errs.name = 'Name must be at least 2 characters.';
    if (!cleanUn || cleanUn.length < 3 || cleanUn.length > 30) {
      errs.username = 'Username must be 3–30 characters.';
    } else if (usernameStatus.available === false) {
      errs.username = usernameStatus.message || 'That username is not available. Please choose a different one.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      errs.email = 'Please enter a valid email address.';
    }
    const pwErr = validatePasswordRule(reg.password);
    if (pwErr) {
      errs.password = pwErr;
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('Please fix the highlighted fields.');
      return;
    }

    setFieldErrors({});
    setBusy(true);
    try {
      const referrer = typeof window !== 'undefined' ? localStorage.getItem('buyoll_referrer') : null;
      const res = await api.register({
        role,
        name: cleanName,
        username: cleanUn,
        email: cleanEmail,
        phone: reg.phone.trim() || undefined,
        password: reg.password,
        shopName: role === 'merchant' ? cleanName : undefined,
        referredBy: referrer || undefined,
        rememberMe: true,
      });

      onNotify('success', res.notice || `Account created successfully as ${cfg.label}! Welcome to Buyoll.`);
      const userActiveRole = (res.user.activeRole || res.user.role || role) as RoleKey;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('user:signin'));
      }
      onSuccess(res.user, ROLE_ROUTES[userActiveRole] || 'home');
      onClose();
    } catch (err: any) {
      if (err?.fields) setFieldErrors(err.fields);
      setError(err?.message || 'Could not create account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!forgotIdentifier.trim()) {
      setError(
        portalMode
          ? 'Enter your administrator username or email.'
          : forgotType === 'forgot_username'
          ? 'Enter your registered email or phone number.'
          : 'Enter your username, email, or phone number.'
      );
      return;
    }
    setBusy(true);
    try {
      const res = portalMode
        ? await api.adminForgotStart({ identifier: forgotIdentifier.trim() })
        : await api.forgotStart({ type: forgotType, identifier: forgotIdentifier.trim() });
      setNotice(
        res.devOtp
          ? `${res.message} Verification OTP: ${res.devOtp}`
          : res.message || 'Verification code sent. Enter the 6-digit OTP below.'
      );
      setForgotStep('verify');
    } catch (err: any) {
      setError(err?.message || 'Unable to process recovery request.');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!forgotOtp.trim()) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setBusy(true);
    try {
      if (portalMode) {
        const res = await api.adminForgotVerify({
          identifier: forgotIdentifier.trim(),
          otp: forgotOtp.trim(),
        });
        setVerificationToken(res.verificationToken);
        setNotice('OTP verified. Set your new administrator password and/or passkey.');
        setForgotStep('reset');
      } else {
        const res = await api.forgotVerify({
          type: forgotType,
          identifier: forgotIdentifier.trim(),
          otp: forgotOtp.trim(),
        });
        if (forgotType === 'forgot_username' && res.sentExisting && res.username) {
          setRecoveredUsername(res.username);
          setLogin((prev) => ({ ...prev, identifier: res.username || prev.identifier }));
          setNotice(res.message || `Your username is: ${res.username}`);
        } else if (res.verificationToken) {
          setVerificationToken(res.verificationToken);
          setNotice(
            forgotType === 'forgot_username'
              ? 'Verified! Choose a new username below.'
              : 'OTP verified. Choose your new strong password below.'
          );
          setForgotStep('reset');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid or expired OTP code.');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (portalMode) {
      if (!resetNewPw && !resetNewPasskey) {
        setError('Provide a new password, a new security passkey, or both.');
        return;
      }
      if (resetNewPw) {
        const pwErr = validatePasswordRule(resetNewPw);
        if (pwErr) {
          setError(pwErr);
          return;
        }
      }
      if (resetNewPasskey && resetNewPasskey.length < 8) {
        setError('Security passkey must be at least 8 characters.');
        return;
      }
    } else if (forgotType === 'forgot_password') {
      const pwErr = validatePasswordRule(resetNewPw);
      if (pwErr) {
        setError(pwErr);
        return;
      }
    } else if (forgotType === 'forgot_username') {
      if (!resetNewUsername.trim() || resetNewUsername.trim().length < 3) {
        setError('Please enter a valid username (min 3 characters).');
        return;
      }
    }

    setBusy(true);
    try {
      if (portalMode) {
        const res = await api.adminForgotReset({
          verificationToken,
          newPassword: resetNewPw || undefined,
          newPasskey: resetNewPasskey || undefined,
        });
        setMode('login');
        setNotice(res.message || 'Administrator credentials updated. Sign in with your new credentials.');
      } else if (forgotType === 'forgot_password') {
        const res = await api.forgotResetPassword({
          verificationToken,
          newPassword: resetNewPw,
        });
        setMode('login');
        setFailedAttempts(0);
        setShowRecoveryPrompt(false);
        setNotice(res.message || 'Password updated! You can now sign in.');
      } else {
        const res = await api.forgotResetUsername({
          verificationToken,
          newUsername: resetNewUsername.trim(),
        });
        setLogin((prev) => ({ ...prev, identifier: res.username }));
        setMode('login');
        setFailedAttempts(0);
        setShowRecoveryPrompt(false);
        setNotice(res.message || `Username updated to ${res.username}. Sign in below.`);
      }
      setForgotOtp('');
      setVerificationToken('');
      setResetNewPw('');
      setResetNewPasskey('');
      setResetNewUsername('');
    } catch (err: any) {
      setError(err?.message || 'Failed to complete reset.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <style>{css}</style>

      <div className="relative w-full max-w-[960px] flex flex-col items-center my-auto">
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="absolute -top-11 right-0 sm:-right-2 text-white/80 hover:text-white bg-black/40 hover:bg-black/70 p-2 rounded-full transition-all z-50 cursor-pointer shadow-md"
        >
          <X className="w-5 h-5" />
        </button>

        <div className={`ax-box ${active ? 'is-active' : ''}`}>
          <div className="ax-diagonal" aria-hidden="true" />

          {!portalMode ? (
            <div className="ax-roles" role="tablist" aria-label="Account type">
              {(['member', 'merchant', 'lender'] as RoleKey[]).map((key) => {
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
          ) : (
            <div className="ax-roles" role="tablist" aria-label="Account type">
              <button type="button" role="tab" aria-selected={true} className="on !w-full !flex-1" disabled>
                Buyoll Administrator Portal
              </button>
            </div>
          )}

          {/* LOGIN OR ACCOUNT RECOVERY FORM (LEFT PANEL) */}
          {mode === 'forgot' ? (
            <form
              className="ax-form ax-login"
              onSubmit={
                forgotStep === 'request'
                  ? handleForgotRequest
                  : forgotStep === 'verify'
                  ? handleForgotVerifyOtp
                  : handleForgotResetSubmit
              }
            >
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#ff6600] hover:underline mb-3 self-start cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to login
              </button>

              {!portalMode && (
                <div className="flex gap-1.5 mb-3 bg-slate-100 dark:bg-[#1A2622] p-1 rounded-full">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot', 'forgot_password')}
                    className={`flex-1 py-1 text-[11px] font-semibold rounded-full cursor-pointer transition-colors ${
                      forgotType === 'forgot_password'
                        ? 'bg-[#ff6600] text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Forgot Password
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('forgot', 'forgot_username')}
                    className={`flex-1 py-1 text-[11px] font-semibold rounded-full cursor-pointer transition-colors ${
                      forgotType === 'forgot_username'
                        ? 'bg-[#ff6600] text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Forgot Username
                  </button>
                </div>
              )}

              <h1 style={{ fontSize: '21px', marginBottom: '6px' }}>
                {portalMode
                  ? 'Admin Credential Recovery'
                  : forgotType === 'forgot_username'
                  ? 'Recover your username'
                  : 'Reset your password'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center mb-3">
                {forgotStep === 'request'
                  ? portalMode
                    ? 'Enter your admin username or email to receive a 6-digit recovery code.'
                    : forgotType === 'forgot_username'
                    ? 'Enter your registered email or phone number to receive a 6-digit verification code.'
                    : 'Enter your username, email, or phone to receive a 6-digit verification code.'
                  : forgotStep === 'verify'
                  ? 'Enter the 6-digit verification code sent to your contact.'
                  : portalMode
                  ? 'Choose a new administrator password and/or security passkey.'
                  : forgotType === 'forgot_username'
                  ? 'Choose a new username for your account.'
                  : 'Create a strong new password (at least 8 chars, 1 letter, 1 number).'}
              </p>

              {forgotStep === 'request' && (
                <>
                  <Field
                    id="f-id"
                    label={
                      portalMode
                        ? 'Admin Username or Email'
                        : forgotType === 'forgot_username'
                        ? 'Registered Email or Phone'
                        : 'Username, Email, or Phone'
                    }
                    icon={<MailIcon />}
                    value={forgotIdentifier}
                    onChange={(e) => setForgotIdentifier(e.target.value)}
                  />
                  <button className="ax-btn mt-2" disabled={busy} type="submit">
                    {busy ? 'Sending OTP…' : 'Send Verification Code'}
                  </button>
                </>
              )}

              {forgotStep === 'verify' && (
                <>
                  {recoveredUsername ? (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-center space-y-2">
                      <p className="text-xs text-emerald-900 dark:text-emerald-200">
                        Your registered username is:
                      </p>
                      <p className="text-sm font-mono font-bold text-[#ff6600]">@{recoveredUsername}</p>
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="ax-btn mt-2"
                      >
                        Continue to Log In
                      </button>
                    </div>
                  ) : (
                    <>
                      <Field
                        id="f-otp"
                        label="6-Digit Verification Code"
                        icon={<KeyRound className="w-4 h-4" />}
                        value={forgotOtp}
                        onChange={(e) => setForgotOtp(e.target.value)}
                      />
                      <button className="ax-btn mt-2" disabled={busy} type="submit">
                        {busy ? 'Verifying…' : 'Verify Code'}
                      </button>
                    </>
                  )}
                </>
              )}

              {forgotStep === 'reset' && (
                <>
                  {portalMode ? (
                    <>
                      <Field
                        id="f-admin-pw"
                        label="New Password (optional)"
                        type={showResetPw ? 'text' : 'password'}
                        icon={<LockIcon />}
                        required={false}
                        value={resetNewPw}
                        onChange={(e) => setResetNewPw(e.target.value)}
                        rightToggle={
                          <button
                            type="button"
                            onClick={() => setShowResetPw((s) => !s)}
                            aria-label={showResetPw ? 'Hide password' : 'Show password'}
                            className="cursor-pointer hover:text-[#ff6600]"
                          >
                            {showResetPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        }
                      />
                      <Field
                        id="f-admin-pk"
                        label="New Security Passkey (optional)"
                        type={showResetPasskey ? 'text' : 'password'}
                        icon={<KeyRound className="w-4 h-4" />}
                        required={false}
                        value={resetNewPasskey}
                        onChange={(e) => setResetNewPasskey(e.target.value)}
                        rightToggle={
                          <button
                            type="button"
                            onClick={() => setShowResetPasskey((s) => !s)}
                            aria-label={showResetPasskey ? 'Hide passkey' : 'Show passkey'}
                            className="cursor-pointer hover:text-[#ff6600]"
                          >
                            {showResetPasskey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        }
                      />
                    </>
                  ) : forgotType === 'forgot_password' ? (
                    <>
                      <Field
                        id="f-newpw"
                        label="New Password (min 8 chars, letter + number)"
                        type={showResetPw ? 'text' : 'password'}
                        icon={<LockIcon />}
                        value={resetNewPw}
                        onChange={(e) => setResetNewPw(e.target.value)}
                        rightToggle={
                          <button
                            type="button"
                            onClick={() => setShowResetPw((s) => !s)}
                            aria-label={showResetPw ? 'Hide password' : 'Show password'}
                            className="cursor-pointer hover:text-[#ff6600]"
                          >
                            {showResetPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        }
                      />
                      {resetNewPw && (
                        <div className="mt-1 mb-1">
                          <div className="h-1 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${resetStrength.color}`}
                              style={{ width: `${Math.min(100, (resetStrength.score / 4) * 100)}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Strength: <span className="font-semibold">{resetStrength.label}</span>
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <Field
                      id="f-newun"
                      label="New Username"
                      icon={<AtSign className="w-4 h-4" />}
                      value={resetNewUsername}
                      onChange={(e) => setResetNewUsername(e.target.value.replace(/\s+/g, ''))}
                    />
                  )}
                  <button className="ax-btn mt-2" disabled={busy} type="submit">
                    {busy ? 'Saving…' : 'Save & Continue'}
                  </button>
                </>
              )}

              {error && (
                <p className="ax-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="ax-notice" role="status">
                  {notice}
                </p>
              )}
            </form>
          ) : (
            <form className="ax-form ax-login" onSubmit={handleLoginSubmit} aria-hidden={active}>
              <div className="flex items-center justify-center gap-2 mb-1">
                <img
                  src={resolveImageUrl('buyoll_logo.png')}
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
                  label={portalMode ? 'Username or Email' : 'Username, Email, or Phone'}
                  type="text"
                  icon={<MailIcon />}
                  autoComplete="username"
                  value={login.identifier}
                  errorText={fieldErrors.identifier}
                  onChange={(e) => setLogin({ ...login, identifier: e.target.value })}
                />
              </div>

              <div className="ax-anim" style={{ '--li': 2 } as React.CSSProperties}>
                <Field
                  id="l-pw"
                  label="Password"
                  type={showLoginPw ? 'text' : 'password'}
                  icon={<LockIcon />}
                  autoComplete="current-password"
                  required={portalMode}
                  value={login.password}
                  errorText={fieldErrors.password}
                  onChange={(e) => setLogin({ ...login, password: e.target.value })}
                  rightToggle={
                    <button
                      type="button"
                      onClick={() => setShowLoginPw((s) => !s)}
                      aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                      className="cursor-pointer hover:text-[#ff6600]"
                    >
                      {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
              </div>

              {portalMode && (
                <div className="ax-anim" style={{ '--li': 2 } as React.CSSProperties}>
                  <Field
                    id="l-passkey"
                    label="Security Passkey"
                    type={showLoginPasskey ? 'text' : 'password'}
                    icon={<KeyRound className="w-4 h-4" />}
                    autoComplete="off"
                    required={true}
                    value={login.passkey}
                    errorText={fieldErrors.passkey}
                    onChange={(e) => setLogin({ ...login, passkey: e.target.value })}
                    rightToggle={
                      <button
                        type="button"
                        onClick={() => setShowLoginPasskey((s) => !s)}
                        aria-label={showLoginPasskey ? 'Hide passkey' : 'Show passkey'}
                        className="cursor-pointer hover:text-[#ff6600]"
                      >
                        {showLoginPasskey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    }
                  />
                </div>
              )}

              <div className="ax-anim flex flex-wrap items-center justify-between gap-2 text-xs mt-1 mb-3" style={{ '--li': 2 } as React.CSSProperties}>
                <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={login.rememberMe}
                    onChange={(e) => setLogin({ ...login, rememberMe: e.target.checked })}
                    className="accent-[#ff6600] rounded"
                  />
                  <span>Remember me</span>
                </label>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot', 'forgot_password')}
                    className="text-[#ff6600] font-semibold hover:underline cursor-pointer"
                  >
                    {portalMode ? 'Forgot password / passkey?' : 'Forgot password?'}
                  </button>
                  {!portalMode && (
                    <button
                      type="button"
                      onClick={() => switchMode('forgot', 'forgot_username')}
                      className="text-slate-500 hover:text-[#ff6600] font-semibold hover:underline cursor-pointer"
                    >
                      Forgot username?
                    </button>
                  )}
                </div>
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

              {showRecoveryPrompt && !portalMode && !active && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-1.5 font-semibold mb-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Having trouble signing in?</span>
                  </div>
                  <p className="text-[11px] opacity-90 mb-2">
                    After multiple failed attempts, you can quickly recover your account via OTP:
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => switchMode('forgot', 'forgot_password')}
                      className="flex-1 py-1.5 px-2 bg-[#ff6600] text-white rounded-lg font-semibold text-[11px] cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode('forgot', 'forgot_username')}
                      className="flex-1 py-1.5 px-2 bg-white dark:bg-[#1A2622] border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 rounded-lg font-semibold text-[11px] cursor-pointer"
                    >
                      Forgot Username?
                    </button>
                  </div>
                </div>
              )}

              {notice && !active && (
                <p className="ax-notice" role="status">
                  {notice}
                </p>
              )}

              <p className="ax-alt ax-anim" style={{ '--li': 4 } as React.CSSProperties}>
                {canRegisterEffective ? (
                  <>
                    No account yet?{' '}
                    <button type="button" onClick={() => switchMode('register')}>
                      Sign up
                    </button>
                  </>
                ) : portalMode ? (
                  <span className="text-xs text-slate-400">Administrator self-registration is disabled.</span>
                ) : (
                  'Merchant & Lender accounts are subject to review.'
                )}
              </p>
            </form>
          )}

          {/* REGISTER FORM (RIGHT PANEL) - Non-admin only */}
          <form className="ax-form ax-register" onSubmit={handleRegisterSubmit} aria-hidden={!active}>
            <h1 className="ax-anim" style={{ '--li': 0, marginBottom: '6px' } as React.CSSProperties}>
              {cfg.label} sign-up
            </h1>

            <div className="ax-anim" style={{ '--li': 1 } as React.CSSProperties}>
              <Field
                id="r-name"
                label={cfg.nameLabel || 'Name'}
                icon={<UserIcon />}
                autoComplete="name"
                value={reg.name}
                errorText={fieldErrors.name}
                onChange={(e) => setReg({ ...reg, name: e.target.value })}
              />
            </div>

            <div className="ax-anim" style={{ '--li': 1 } as React.CSSProperties}>
              <Field
                id="r-username"
                label="Username (e.g. jane.m)"
                icon={<AtSign className="w-4 h-4" />}
                autoComplete="username"
                value={reg.username}
                errorText={
                  fieldErrors.username ||
                  (usernameStatus.available === false ? usernameStatus.message : undefined)
                }
                onChange={(e) =>
                  setReg({ ...reg, username: e.target.value.replace(/\s+/g, '') })
                }
                rightToggle={
                  usernameStatus.available ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AtSign className="w-4 h-4" />
                  )
                }
              />
            </div>

            <div className="ax-anim grid grid-cols-1 sm:grid-cols-2 gap-x-3" style={{ '--li': 2 } as React.CSSProperties}>
              <Field
                id="r-mail"
                label="Email address"
                type="email"
                icon={<MailIcon />}
                autoComplete="email"
                value={reg.email}
                errorText={fieldErrors.email}
                onChange={(e) => setReg({ ...reg, email: e.target.value })}
              />
              <Field
                id="r-phone"
                label="Phone (optional)"
                type="tel"
                icon={<Phone className="w-4 h-4" />}
                autoComplete="tel"
                required={false}
                value={reg.phone}
                errorText={fieldErrors.phone}
                onChange={(e) => setReg({ ...reg, phone: e.target.value })}
              />
            </div>

            <div className="ax-anim" style={{ '--li': 3 } as React.CSSProperties}>
              <Field
                id="r-pw"
                label="Password (min 8 chars, letter + number)"
                type={showRegPw ? 'text' : 'password'}
                icon={<LockIcon />}
                autoComplete="new-password"
                value={reg.password}
                errorText={fieldErrors.password}
                onChange={(e) => setReg({ ...reg, password: e.target.value })}
                rightToggle={
                  <button
                    type="button"
                    onClick={() => setShowRegPw((s) => !s)}
                    aria-label={showRegPw ? 'Hide password' : 'Show password'}
                    className="cursor-pointer hover:text-[#ff6600]"
                  >
                    {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              {reg.password && (
                <div className="mt-1 mb-1">
                  <div className="h-1 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${strength.color}`}
                      style={{ width: `${Math.min(100, (strength.score / 4) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Strength: <span className="font-semibold">{strength.label}</span>
                  </p>
                </div>
              )}
            </div>

            <div className="ax-anim" style={{ '--li': 4 } as React.CSSProperties}>
              <button className="ax-btn" disabled={busy} type="submit">
                {busy && active ? 'Creating account…' : `Register as ${cfg.label}`}
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

          <aside className="ax-info ax-info-login">
            <h2>{cfg.loginTitle}</h2>
            <p>{cfg.loginText}</p>
          </aside>
          <aside className="ax-info ax-info-register">
            <h2>{cfg.regTitle || cfg.loginTitle}</h2>
            <p>{cfg.regText || cfg.loginText}</p>
          </aside>
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
  --o1: #ff6600;
  --o2: #ff8000;
  --g3: #ff8000;
  position: relative;
  width: min(940px, 100%);
  min-height: 640px;
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
  --o1: #ff8000;
  --o2: #ff8000;
  --g3: #2a1608;
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
  top: 16px;
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
  padding: 62px 38px 18px;
  z-index: 4;
  overflow-y: auto;
}

.ax-login {
  left: 0;
}

.ax-register {
  right: 0;
}

.ax-form h1 {
  font-size: 24px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 12px;
  color: var(--ink);
}

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

.ax-field-wrap {
  margin: 10px 0;
}

.ax-field {
  position: relative;
}

.ax-field-err {
  font-size: 11px;
  color: #dc2626;
  margin-top: 3px;
  font-weight: 500;
}

.ax-field input {
  width: 100%;
  background: none;
  border: 0;
  border-bottom: 2px solid #c3d3c9;
  color: var(--ink);
  font: 500 13.5px 'Poppins', sans-serif;
  padding: 8px 28px 5px 0;
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
  font-size: 13px;
  color: var(--mute);
  pointer-events: none;
  transition: 0.3s;
}

.ax-field input:focus + label,
.ax-field input:not(:placeholder-shown) + label {
  top: -12px;
  font-size: 11px;
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
  padding: 10px;
  border: 2px solid var(--o1);
  border-radius: 999px;
  cursor: pointer;
  font: 600 13.5px 'Poppins', sans-serif;
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
  font-size: 12px;
  margin: 12px 0 0;
  color: var(--mute);
}

.ax-alt button {
  background: none;
  border: 0;
  color: var(--o1);
  font: 600 12px 'Poppins', sans-serif;
  cursor: pointer;
  padding: 0;
}

.ax-alt button:hover {
  text-decoration: underline;
}

.ax-notice {
  margin: 8px 0 0;
  font-size: 12px;
  text-align: center;
  color: #ff6600;
  font-weight: 500;
}

:root[data-theme="dark"] .ax-notice,
.dark .ax-notice {
  color: #ff8000;
}

.ax-error {
  margin: 8px 0 0;
  font-size: 12px;
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
    min-height: 580px;
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
    position: relative;
    width: 100%;
    padding: 78px 22px 24px;
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
