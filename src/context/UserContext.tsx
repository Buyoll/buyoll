import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User } from '../types.ts';
import { api, getStoredUser, setStoredUser, SESSION_EXPIRED_EVENT } from '../api.ts';
import { isAdminPortalPath } from '../config/adminPortal.ts';

const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const IDLE_WARNING_WINDOW_MS = 60 * 1000;
const KEEPALIVE_THROTTLE_MS = 60 * 1000;

interface UserContextValue {
  currentUser: User | null;
  authLoading: boolean;
  idleWarningSecondsLeft: number | null;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  onProfileUpdate: (partialOrFullUser?: Partial<User> | User | null) => void;
  refreshUser: () => Promise<User | null>;
  keepSessionAlive: () => Promise<void>;
  logoutRole: (role?: string, reasonMessage?: string) => Promise<void>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

const SYNC_CHANNEL_NAME = 'buyoll_user_sync';

function getRoleOf(user: User | null | undefined): string {
  if (!user) return '';
  return String(user.activeRole || user.role || '').toLowerCase();
}

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => getStoredUser());
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [idleWarningSecondsLeft, setIdleWarningSecondsLeft] = useState<number | null>(null);

  const currentUserRef = useRef<User | null>(currentUser);
  currentUserRef.current = currentUser;

  const bcRef = useRef<BroadcastChannel | null>(null);
  const idleTimeoutMsRef = useRef<number>(DEFAULT_IDLE_TIMEOUT_MS);
  const idleExpiresAtRef = useRef<number>(Date.now() + DEFAULT_IDLE_TIMEOUT_MS);
  const lastKeepaliveSentAtRef = useRef<number>(0);
  const lastActivityAtRef = useRef<number>(Date.now());
  const expiringInFlightRef = useRef<boolean>(false);

  const applyUserUpdate = useCallback((nextUser: User | null, broadcast = true, explicitRole?: string) => {
    const prevRole = getRoleOf(currentUserRef.current);
    const nextRole = explicitRole || getRoleOf(nextUser) || prevRole;
    setCurrentUser(nextUser);
    setStoredUser(nextUser);
    if (nextUser) {
      idleExpiresAtRef.current = Date.now() + idleTimeoutMsRef.current;
      setIdleWarningSecondsLeft(null);
      expiringInFlightRef.current = false;
    } else {
      setIdleWarningSecondsLeft(null);
    }
    if (broadcast && bcRef.current) {
      try {
        bcRef.current.postMessage({
          type: nextUser ? 'USER_UPDATED' : 'ROLE_LOGOUT',
          role: nextRole,
          user: nextUser,
        });
      } catch {
        // ignore channel errors
      }
    }
  }, []);

  const logoutRole = useCallback(
    async (role?: string, reasonMessage?: string) => {
      const targetRole = (role || getRoleOf(currentUserRef.current) || '').toLowerCase();
      try {
        await api.logout(targetRole || undefined);
      } catch {
        // ignore logout network errors
      }
      if (!targetRole || getRoleOf(currentUserRef.current) === targetRole) {
        applyUserUpdate(null, true, targetRole);
      } else if (bcRef.current && targetRole) {
        try {
          bcRef.current.postMessage({ type: 'ROLE_LOGOUT', role: targetRole, user: null });
        } catch {
          // ignore
        }
      }
      if (reasonMessage && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('buyoll:notify', {
            detail: { type: 'info', message: reasonMessage },
          })
        );
      }
    },
    [applyUserUpdate]
  );

  const onProfileUpdate = useCallback(
    (partialOrFullUser?: Partial<User> | User | null) => {
      if (partialOrFullUser === null) {
        applyUserUpdate(null);
        return;
      }
      if (!partialOrFullUser) {
        const activeRole = getRoleOf(currentUserRef.current) || undefined;
        api
          .getMe(activeRole)
          .then((res) => {
            if (res?.user) {
              if (res.session?.idleTimeoutMs) {
                idleTimeoutMsRef.current = Number(res.session.idleTimeoutMs);
              }
              if (res.session?.idleExpiresAt) {
                idleExpiresAtRef.current = Number(res.session.idleExpiresAt);
              }
              applyUserUpdate(res.user);
            }
          })
          .catch(() => {});
        return;
      }
      const prev = currentUserRef.current;
      const merged: User = prev
        ? ({ ...prev, ...partialOrFullUser } as User)
        : (partialOrFullUser as User);
      applyUserUpdate(merged);
    },
    [applyUserUpdate]
  );

  const refreshUser = useCallback(async (): Promise<User | null> => {
    const preferredRole =
      typeof window !== 'undefined' && isAdminPortalPath(window.location.pathname)
        ? 'admin'
        : getRoleOf(currentUserRef.current) || undefined;
    try {
      const res = await api.getMe(preferredRole);
      if (res?.user) {
        if (res.session?.idleTimeoutMs) {
          idleTimeoutMsRef.current = Number(res.session.idleTimeoutMs);
        }
        if (res.session?.idleExpiresAt) {
          idleExpiresAtRef.current = Number(res.session.idleExpiresAt);
        } else {
          idleExpiresAtRef.current = Date.now() + idleTimeoutMsRef.current;
        }
        applyUserUpdate(res.user, false);
        return res.user;
      }
    } catch {
      // unauthenticated or expired
    }
    return currentUserRef.current;
  }, [applyUserUpdate]);

  const keepSessionAlive = useCallback(async () => {
    const active = currentUserRef.current;
    if (!active) return;
    const activeRole = getRoleOf(active);
    lastActivityAtRef.current = Date.now();
    lastKeepaliveSentAtRef.current = Date.now();
    idleExpiresAtRef.current = Date.now() + idleTimeoutMsRef.current;
    setIdleWarningSecondsLeft(null);
    expiringInFlightRef.current = false;
    try {
      const res = await api.keepaliveSession(activeRole);
      if (res?.idleTimeoutMs) {
        idleTimeoutMsRef.current = Number(res.idleTimeoutMs);
      }
      if (res?.idleExpiresAt) {
        idleExpiresAtRef.current = Number(res.idleExpiresAt);
      }
      if (bcRef.current) {
        try {
          bcRef.current.postMessage({
            type: 'KEEPALIVE',
            role: activeRole,
            idleExpiresAt: idleExpiresAtRef.current,
          });
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      if (err?.code === 'SESSION_IDLE_EXPIRED' || err?.status === 401) {
        await logoutRole(
          activeRole,
          err?.message || 'Your session expired after 20 minutes of inactivity. Please sign in again.'
        );
      }
    }
  }, [logoutRole]);

  // Initial session bootstrap gate (Section 4)
  useEffect(() => {
    let mounted = true;
    const preferredRole =
      typeof window !== 'undefined' && isAdminPortalPath(window.location.pathname)
        ? 'admin'
        : getRoleOf(getStoredUser()) || undefined;

    api
      .getMe(preferredRole)
      .then((res) => {
        if (!mounted) return;
        if (res?.user) {
          if (res.session?.idleTimeoutMs) {
            idleTimeoutMsRef.current = Number(res.session.idleTimeoutMs);
          }
          if (res.session?.idleExpiresAt) {
            idleExpiresAtRef.current = Number(res.session.idleExpiresAt);
          } else {
            idleExpiresAtRef.current = Date.now() + idleTimeoutMsRef.current;
          }
          applyUserUpdate(res.user, false);
        } else {
          applyUserUpdate(null, false);
        }
      })
      .catch(() => {
        if (!mounted) return;
        applyUserUpdate(null, false);
      })
      .finally(() => {
        if (mounted) {
          setAuthLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [applyUserUpdate]);

  // BroadcastChannel, StorageEvent, SessionExpiredEvent, and SSE sync
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('BroadcastChannel' in window) {
      try {
        bcRef.current = new BroadcastChannel(SYNC_CHANNEL_NAME);
        bcRef.current.onmessage = (ev) => {
          const msg = ev.data || {};
          const msgRole = String(msg.role || '').toLowerCase();
          const currentRole = getRoleOf(currentUserRef.current);
          const onAdminPath = isAdminPortalPath(window.location.pathname);

          if (msg.type === 'ROLE_LOGOUT') {
            if (!msgRole || msgRole === currentRole) {
              setCurrentUser(null);
              setStoredUser(null);
              setIdleWarningSecondsLeft(null);
            }
          } else if (msg.type === 'KEEPALIVE') {
            if (msgRole && msgRole === currentRole) {
              idleExpiresAtRef.current = Number(msg.idleExpiresAt || Date.now() + idleTimeoutMsRef.current);
              setIdleWarningSecondsLeft(null);
              expiringInFlightRef.current = false;
            }
          } else if (msg.type === 'USER_UPDATED') {
            if (!msg.user) return;
            const incomingRole = getRoleOf(msg.user);
            if (onAdminPath && incomingRole !== 'admin') return;
            if (!onAdminPath && incomingRole === 'admin' && currentRole && currentRole !== 'admin') return;
            if (!currentRole || currentRole === incomingRole) {
              setCurrentUser(msg.user);
              setStoredUser(msg.user);
              idleExpiresAtRef.current = Date.now() + idleTimeoutMsRef.current;
              setIdleWarningSecondsLeft(null);
            }
          }
        };
      } catch {
        bcRef.current = null;
      }
    }

    const handleStorage = (ev: StorageEvent) => {
      if (ev.key === 'alibaird_current_user') {
        try {
          const parsed = ev.newValue ? (JSON.parse(ev.newValue) as User) : null;
          const currentRole = getRoleOf(currentUserRef.current);
          const incomingRole = getRoleOf(parsed);
          if (parsed && currentRole && incomingRole && currentRole !== incomingRole) {
            return;
          }
          setCurrentUser(parsed);
        } catch {
          setCurrentUser(null);
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    const handleSessionExpired = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      const expiredRole = String(detail.role || '').toLowerCase();
      const activeRole = getRoleOf(currentUserRef.current);
      if (!expiredRole || !activeRole || expiredRole === activeRole) {
        applyUserUpdate(null, true, expiredRole || activeRole);
        window.dispatchEvent(
          new CustomEvent('buyoll:notify', {
            detail: {
              type: 'info',
              message: detail.message || 'Your session expired after 20 minutes of inactivity. Please sign in again.',
            },
          })
        );
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);

    let es: EventSource | null = null;
    if ('EventSource' in window) {
      try {
        es = new EventSource('/api/events', { withCredentials: true });
        es.addEventListener('user.profile.updated', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            const payload = parsed?.payload;
            const active = currentUserRef.current;
            if (payload?.user && active && payload.user.id === active.id) {
              const merged = { ...active, ...payload.user } as User;
              setCurrentUser(merged);
              setStoredUser(merged);
            }
          } catch {
            // ignore
          }
        });
        es.addEventListener('user.wallet.updated', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            const payload = parsed?.payload;
            const active = currentUserRef.current;
            if (active && payload?.userId === active.id) {
              if (typeof payload.balanceKes === 'number') {
                const updated = { ...active, credit: payload.balanceKes };
                setCurrentUser(updated);
                setStoredUser(updated);
              } else {
                refreshUser();
              }
            }
            window.dispatchEvent(new CustomEvent('buyoll:wallet-updated', { detail: payload }));
          } catch {
            // ignore
          }
        });
        es.addEventListener('subscription.activated', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            const payload = parsed?.payload;
            window.dispatchEvent(new CustomEvent('buyoll:subscription-activated', { detail: payload }));
            const active = currentUserRef.current;
            if (active && payload?.merchantId === active.id) {
              refreshUser();
            }
          } catch {
            // ignore
          }
        });
        es.addEventListener('subscription.expired', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            const payload = parsed?.payload;
            window.dispatchEvent(new CustomEvent('buyoll:subscription-expired', { detail: payload }));
            const active = currentUserRef.current;
            if (active && payload?.merchantId === active.id) {
              refreshUser();
            }
          } catch {
            // ignore
          }
        });
        es.addEventListener('announcement.updated', () => {
          window.dispatchEvent(new CustomEvent('buyoll:announcement-updated'));
        });
        es.addEventListener('group.membership.updated', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            window.dispatchEvent(new CustomEvent('buyoll:group-updated', { detail: parsed?.payload }));
          } catch {
            // ignore
          }
        });
        es.addEventListener('group.products.updated', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            window.dispatchEvent(new CustomEvent('buyoll:group-products-updated', { detail: parsed?.payload }));
          } catch {
            // ignore
          }
        });
        es.addEventListener('group.loan.updated', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            window.dispatchEvent(new CustomEvent('buyoll:group-loan-updated', { detail: parsed?.payload }));
          } catch {
            // ignore
          }
        });
        es.addEventListener('group.chat.message', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data);
            window.dispatchEvent(new CustomEvent('buyoll:group-chat-message', { detail: parsed?.payload }));
          } catch {
            // ignore
          }
        });
      } catch {
        es = null;
      }
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
      bcRef.current?.close();
      bcRef.current = null;
      es?.close();
    };
  }, [applyUserUpdate, refreshUser]);

  // 20-minute idle timeout, 60-second warning modal, activity keepalive & tab wake re-check
  const currentUserId = currentUser?.id;
  useEffect(() => {
    if (typeof window === 'undefined' || !currentUserId) {
      setIdleWarningSecondsLeft(null);
      return;
    }

    const activeRole = getRoleOf(currentUserRef.current);

    const handleActivity = () => {
      // Once warning countdown modal is visible, user must click "I'm still here" explicitly
      const remaining = idleExpiresAtRef.current - Date.now();
      if (remaining <= IDLE_WARNING_WINDOW_MS) {
        return;
      }
      const now = Date.now();
      lastActivityAtRef.current = now;
      idleExpiresAtRef.current = now + idleTimeoutMsRef.current;

      if (now - lastKeepaliveSentAtRef.current >= KEEPALIVE_THROTTLE_MS) {
        lastKeepaliveSentAtRef.current = now;
        api
          .keepaliveSession(activeRole)
          .then((res) => {
            if (res?.idleTimeoutMs) idleTimeoutMsRef.current = Number(res.idleTimeoutMs);
            if (res?.idleExpiresAt) idleExpiresAtRef.current = Number(res.idleExpiresAt);
          })
          .catch(() => {
            // 401 handler dispatches SESSION_EXPIRED_EVENT automatically
          });
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'focus',
    ];
    for (const evName of activityEvents) {
      window.addEventListener(evName, handleActivity, { passive: true });
    }

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible' || !currentUserRef.current) return;
      const role = getRoleOf(currentUserRef.current);
      try {
        const res = await api.getMe(role);
        if (res?.session?.idleTimeoutMs) {
          idleTimeoutMsRef.current = Number(res.session.idleTimeoutMs);
        }
        if (res?.session?.idleExpiresAt) {
          idleExpiresAtRef.current = Number(res.session.idleExpiresAt);
        }
      } catch {
        // 401 handler clears session if idle expired while sleeping
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const tick = window.setInterval(() => {
      if (!currentUserRef.current) return;
      const remainingMs = idleExpiresAtRef.current - Date.now();
      if (remainingMs <= 0) {
        if (!expiringInFlightRef.current) {
          expiringInFlightRef.current = true;
          logoutRole(
            getRoleOf(currentUserRef.current),
            'Your session expired after 20 minutes of inactivity. Please sign in again.'
          );
        }
      } else if (remainingMs <= IDLE_WARNING_WINDOW_MS) {
        setIdleWarningSecondsLeft(Math.ceil(remainingMs / 1000));
      } else {
        setIdleWarningSecondsLeft((prev) => (prev !== null ? null : prev));
      }
    }, 1000);

    return () => {
      for (const evName of activityEvents) {
        window.removeEventListener(evName, handleActivity);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(tick);
    };
  }, [currentUserId, logoutRole]);

  return (
    <UserContext.Provider
      value={{
        currentUser,
        authLoading,
        idleWarningSecondsLeft,
        setCurrentUser,
        onProfileUpdate,
        refreshUser,
        keepSessionAlive,
        logoutRole,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return ctx;
}
