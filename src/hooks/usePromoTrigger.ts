import { useState, useEffect, useRef, useCallback } from 'react';
import { PROMO_CONFIG, getActivePromoMessage } from '../config/promoConfig.ts';
import type { User } from '../types.ts';

export type PromoTriggerType = 'load' | 'login' | 'signin';
export type PromoCloseMethod = 'x' | 'esc' | 'backdrop' | 'swipe' | 'cta';

export function firePromoAnalytics(eventName: string, detail: Record<string, any>) {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent(eventName, { detail, bubbles: true });
  window.dispatchEvent(event);
  if (process.env.NODE_ENV !== 'production') {
    // Helpful debug logging for developer validation
    console.debug(`[Buyoll Analytics] ${eventName}:`, detail);
  }
}

export function usePromoTrigger(currentUser?: User | null) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerType, setTriggerType] = useState<PromoTriggerType>('load');
  const [messageIndex, setMessageIndex] = useState<number>(0);

  // Tracks the last trigger execution timestamp to enforce 10-second deduplication
  const lastTriggerTimeRef = useRef<number>(0);
  const currentUserRef = useRef<User | null | undefined>(currentUser);
  currentUserRef.current = currentUser;

  const isPathExcluded = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    const pathname = window.location.pathname.toLowerCase();
    return PROMO_CONFIG.excludePaths.some((excluded) => {
      const p = excluded.toLowerCase();
      return pathname === p || pathname.startsWith(`${p}/`);
    });
  }, []);

  const triggerPopup = useCallback((trigger: PromoTriggerType) => {
    const now = Date.now();
    // Strict 10-second deduplication: if two triggers fire within 10s, show only once
    if (now - lastTriggerTimeRef.current < 10000) {
      return;
    }

    // Never show on excluded paths (admin portal, checkout, payment, otp, errors)
    if (isPathExcluded()) {
      return;
    }

    lastTriggerTimeRef.current = now;

    // Determine current rotated message based on 3-day window
    const activeData = getActivePromoMessage(currentUserRef.current?.createdAt);
    setMessageIndex(activeData.index);
    setTriggerType(trigger);
    setIsOpen(true);

    firePromoAnalytics('promo_shown', {
      index: activeData.index,
      trigger,
      category: activeData.message.category,
      message: activeData.message.text,
      isOverride: activeData.isOverride,
    });
  }, [isPathExcluded]);

  const closePopup = useCallback((method: PromoCloseMethod) => {
    setIsOpen(false);
    firePromoAnalytics('promo_closed', {
      index: messageIndex,
      method,
    });
  }, [messageIndex]);

  const handleCtaClick = useCallback((ctaId: string) => {
    firePromoAnalytics('promo_cta_click', {
      index: messageIndex,
      ctaId,
    });
    closePopup('cta');
  }, [messageIndex, closePopup]);

  // Set up the 3 strict trigger listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Initial page refresh or fresh app load: non-blocking delay of 600ms
    const loadTimer = setTimeout(() => {
      triggerPopup('load');
    }, 600);

    // 2. Successful login event: user:login
    const handleLoginEvent = () => {
      triggerPopup('login');
    };

    // 3. Successful sign-in or sign-up event: user:signin
    const handleSigninEvent = () => {
      triggerPopup('signin');
    };

    window.addEventListener('user:login', handleLoginEvent);
    window.addEventListener('user:signin', handleSigninEvent);

    return () => {
      clearTimeout(loadTimer);
      window.removeEventListener('user:login', handleLoginEvent);
      window.removeEventListener('user:signin', handleSigninEvent);
    };
  }, [triggerPopup]);

  return {
    isOpen,
    triggerType,
    messageIndex,
    triggerPopup,
    closePopup,
    handleCtaClick,
  };
}
