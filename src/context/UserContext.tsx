import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User } from '../types.ts';
import { api, getStoredUser, setStoredUser } from '../api.ts';

interface UserContextValue {
  currentUser: User | null;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  onProfileUpdate: (partialOrFullUser?: Partial<User> | User | null) => void;
  refreshUser: () => Promise<User | null>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

const SYNC_CHANNEL_NAME = 'buyoll_user_sync';

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => getStoredUser());
  const currentUserRef = useRef<User | null>(currentUser);
  currentUserRef.current = currentUser;
  const bcRef = useRef<BroadcastChannel | null>(null);

  const applyUserUpdate = useCallback((nextUser: User | null, broadcast = true) => {
    setCurrentUser(nextUser);
    setStoredUser(nextUser);
    if (broadcast && bcRef.current) {
      try {
        bcRef.current.postMessage({ type: 'USER_UPDATED', user: nextUser });
      } catch {
        // ignore channel errors
      }
    }
  }, []);

  const onProfileUpdate = useCallback(
    (partialOrFullUser?: Partial<User> | User | null) => {
      if (partialOrFullUser === null) {
        applyUserUpdate(null);
        return;
      }
      if (!partialOrFullUser) {
        api
          .getMe()
          .then((res) => {
            if (res?.user) applyUserUpdate(res.user);
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
    try {
      const res = await api.getMe();
      if (res?.user) {
        applyUserUpdate(res.user);
        return res.user;
      }
    } catch {
      // ignore unauthenticated / offline errors
    }
    return currentUserRef.current;
  }, [applyUserUpdate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Cross-tab BroadcastChannel sync
    if ('BroadcastChannel' in window) {
      try {
        bcRef.current = new BroadcastChannel(SYNC_CHANNEL_NAME);
        bcRef.current.onmessage = (ev) => {
          if (ev.data?.type === 'USER_UPDATED') {
            setCurrentUser(ev.data.user ?? null);
            setStoredUser(ev.data.user ?? null);
          }
        };
      } catch {
        bcRef.current = null;
      }
    }

    // Fallback storage event sync across tabs
    const handleStorage = (ev: StorageEvent) => {
      if (ev.key === 'alibaird_current_user') {
        try {
          setCurrentUser(ev.newValue ? JSON.parse(ev.newValue) : null);
        } catch {
          setCurrentUser(null);
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    // Server-Sent Events (SSE) for real-time cross-session updates
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
            // ignore malformed event
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
      bcRef.current?.close();
      bcRef.current = null;
      es?.close();
    };
  }, []);

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, onProfileUpdate, refreshUser }}>
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
