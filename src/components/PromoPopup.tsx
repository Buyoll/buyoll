import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PROMO_CONFIG, type PromoCTA, getActivePromoMessage } from '../config/promoConfig.ts';
import type { PromoMessage } from '../config/promoMessages.ts';
import type { PromoCloseMethod, PromoTriggerType } from '../hooks/usePromoTrigger.ts';
import type { User } from '../types.ts';
import { getUserActiveRole } from '../utils/rbac.ts';

interface PromoPopupProps {
  isOpen: boolean;
  messageIndex: number;
  triggerType: PromoTriggerType;
  currentUser?: User | null;
  onClose: (method: PromoCloseMethod) => void;
  onCtaClick: (cta: PromoCTA) => void;
}

export const PromoPopup: React.FC<PromoPopupProps> = ({
  isOpen,
  messageIndex,
  triggerType,
  currentUser,
  onClose,
  onCtaClick,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // Retrieve current active message from the 100 rotated items
  const promoData = useMemo(() => {
    return getActivePromoMessage(currentUser?.createdAt);
  }, [messageIndex, currentUser?.createdAt]);

  const activeMessage: PromoMessage = promoData.message;

  // Always include all 4 platform secondary CTAs as requested
  const primaryCta = useMemo(() => PROMO_CONFIG.ctas.find((c) => c.primary) || PROMO_CONFIG.ctas[0], []);
  const secondaryCtas = useMemo(() => PROMO_CONFIG.ctas.filter((c) => !c.primary), []);

  // Handle smooth closing animation before unmount
  const triggerClose = useCallback(
    (method: PromoCloseMethod) => {
      if (isClosing) return;
      setIsClosing(true);
      setTimeout(() => {
        setIsClosing(false);
        onClose(method);
      }, 300);
    },
    [isClosing, onClose]
  );

  // Accessibility: Focus trap & restoring focus
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null;
      // Focus the close button for instant keyboard accessibility
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          triggerClose('esc');
          return;
        }

        // Trap focus inside modal
        if (e.key === 'Tab' && cardRef.current) {
          const focusable = cardRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        if (previouslyFocusedElementRef.current) {
          previouslyFocusedElementRef.current.focus();
        }
      };
    }
  }, [isOpen, triggerClose]);

  // Mouse 3D tilt tracking (up to ±18° on Y and ±14° on X)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = (e.clientX - centerX) / (rect.width / 2);
    const deltaY = (e.clientY - centerY) / (rect.height / 2);

    const clampedX = Math.max(-1, Math.min(1, deltaX));
    const clampedY = Math.max(-1, Math.min(1, deltaY));

    setTilt({
      x: clampedY * -14, // Max ±14 deg
      y: clampedX * 18,  // Max ±18 deg
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ x: 0, y: 0 });
  }, []);

  // Mobile Device Orientation tilt support (where available)
  useEffect(() => {
    if (!isOpen) return;
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      // gamma is left-to-right (-90 to 90), beta is front-to-back (-180 to 180)
      const tiltY = Math.max(-12, Math.min(12, e.gamma / 2));
      const tiltX = Math.max(-10, Math.min(10, (e.beta - 45) / 3));
      setTilt({ x: tiltX, y: tiltY });
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    return () => {
      if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
    };
  }, [isOpen]);

  // Mobile swipe down to close (> 60px down)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchEndY - touchStartYRef.current;
    if (deltaY > 60) {
      triggerClose('swipe');
    }
    touchStartYRef.current = null;
  };

  // Primary button click with ripple effect
  const handlePrimaryClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rippleId = Date.now();
    setRipples((prev) => [...prev, { id: rippleId, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== rippleId));
    }, 600);

    onCtaClick(primaryCta);
  };

  // Split active message into individual words for 3D staggered flip reveal
  const messageWords = useMemo(() => {
    return activeMessage.text.split(' ');
  }, [activeMessage.text]);

  // Confetti particles generator (capped at 24 elements)
  const confettiList = useMemo(() => {
    const colors = ['#ff8a00', '#ffffff', '#7be39a', '#2fbf62', '#ffb347'];
    return Array.from({ length: 22 }, (_, i) => ({
      id: i,
      color: colors[i % colors.length],
      left: `${(i * 4.5 + 2) % 96}%`,
      delay: `${(i * 45) % 800}ms`,
      duration: `${1800 + ((i * 120) % 1200)}ms`,
      size: `${6 + (i % 6)}px`,
      isCircle: i % 2 === 0,
    }));
  }, []);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="buyoll-promo-heading"
      id="buyoll-promo-dialog"
      className={`buyoll-promo-overlay fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 ${
        isClosing ? 'is-closing' : 'is-entering'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          triggerClose('backdrop');
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <style>{`
        :root {
          --promo-green-start: ${PROMO_CONFIG.colors.greenGradient[0]};
          --promo-green-mid: ${PROMO_CONFIG.colors.greenGradient[1]};
          --promo-green-end: ${PROMO_CONFIG.colors.greenGradient[2]};
          --promo-orange: ${PROMO_CONFIG.colors.orange};
          --promo-orange-light: ${PROMO_CONFIG.colors.orangeLight};
          --promo-white: ${PROMO_CONFIG.colors.white};
          --promo-backdrop: ${PROMO_CONFIG.colors.backdrop};
        }

        .buyoll-promo-overlay {
          background-color: var(--promo-backdrop);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          perspective: 1100px;
          transition: opacity 0.3s ease;
        }

        .buyoll-promo-overlay.is-closing {
          opacity: 0;
          pointer-events: none;
        }

        .buyoll-promo-scene {
          position: relative;
          width: 100%;
          max-width: 620px;
          min-height: 480px;
          max-height: calc(100vh - 48px);
          margin-top: 40px;
          transform-style: preserve-3d;
          transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
          will-change: transform;
        }

        /* 3D Entrance & Exit animations */
        .buyoll-promo-overlay.is-entering .buyoll-promo-scene {
          animation: promoFlipIn 0.8s cubic-bezier(0.2, 1.2, 0.3, 1) forwards;
        }

        .buyoll-promo-overlay.is-closing .buyoll-promo-scene {
          animation: promoTiltShrink 0.3s ease-in forwards;
        }

        @keyframes promoFlipIn {
          0% {
            opacity: 0;
            transform: rotateX(-70deg) translateY(-80px) scale(0.6);
          }
          100% {
            opacity: 1;
            transform: rotateX(0deg) translateY(0) scale(1);
          }
        }

        @keyframes promoTiltShrink {
          0% {
            opacity: 1;
            transform: scale(1) rotateX(0deg);
          }
          100% {
            opacity: 0;
            transform: scale(0.7) rotateX(25deg) translateY(30px);
          }
        }

        /* Back card (Ribbon card) at translateZ(10px) - clearly elevated and highly visible */
        .promo-back-card {
          position: absolute;
          top: -46px;
          left: 50%;
          transform: translateX(-50%) translateZ(10px);
          width: 90%;
          height: 110px;
          background: linear-gradient(135deg, #052613 0%, #0d5c32 50%, #157e46 100%);
          border-radius: 28px 28px 16px 16px;
          border: 2px solid rgba(255, 212, 148, 0.65);
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 25px rgba(255, 138, 0, 0.25);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 11px;
          z-index: 1;
        }

        /* Floating 3D Gift Box bobbing & spinning */
        .promo-gift-box-wrap {
          position: absolute;
          top: -34px;
          left: 20px;
          transform-style: preserve-3d;
          animation: floatBob 3.6s ease-in-out infinite alternate;
          z-index: 5;
        }

        @keyframes floatBob {
          0% { transform: translateY(0px) rotateX(16deg) rotateY(0deg); }
          100% { transform: translateY(-12px) rotateX(16deg) rotateY(360deg); }
        }

        .promo-cube {
          width: 32px;
          height: 32px;
          position: relative;
          transform-style: preserve-3d;
        }

        .promo-cube-face {
          position: absolute;
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #ff8a00, #ffb347);
          border: 1px solid #ffd494;
          box-shadow: inset 0 0 4px rgba(0,0,0,0.25);
        }

        .promo-cube-face.front  { transform: rotateY(0deg) translateZ(16px); }
        .promo-cube-face.back   { transform: rotateY(180deg) translateZ(16px); }
        .promo-cube-face.right  { transform: rotateY(90deg) translateZ(16px); }
        .promo-cube-face.left   { transform: rotateY(-90deg) translateZ(16px); }
        .promo-cube-face.top    { transform: rotateX(90deg) translateZ(16px); background: #ffa133; }
        .promo-cube-face.bottom { transform: rotateX(-90deg) translateZ(16px); }

        .promo-ribbon-v {
          position: absolute;
          left: 12px;
          top: 0;
          width: 8px;
          height: 100%;
          background: #ffffff;
        }
        .promo-ribbon-h {
          position: absolute;
          top: 12px;
          left: 0;
          width: 100%;
          height: 8px;
          background: #ffffff;
        }

        /* Front Card at translateZ(40px) */
        .promo-front-card {
          position: relative;
          width: 100%;
          background: linear-gradient(145deg, var(--promo-green-start) 0%, var(--promo-green-mid) 60%, #1e8748 100%);
          border-radius: 28px;
          padding: 34px 28px 28px 28px;
          color: #ffffff;
          box-shadow:
            0 25px 60px -15px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(255, 255, 255, 0.15);
          transform: translateZ(40px);
          transform-style: preserve-3d;
          overflow: hidden;
          z-index: 2;
        }

        /* Animated gradient glow border */
        .promo-front-card::before {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 30px;
          background: linear-gradient(115deg, #ff8a00, #7be39a, #ffb347, #2fbf62, #ff8a00);
          background-size: 300% 300%;
          z-index: -1;
          animation: borderGlow 6s linear infinite;
          opacity: 0.85;
        }

        @keyframes borderGlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        /* Diagonal shine sweep across front card */
        .promo-front-card::after {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(
            60deg,
            transparent 40%,
            rgba(255, 255, 255, 0.22) 50%,
            transparent 60%
          );
          transform: translateX(-150%) skewX(-20deg);
          animation: shineSweep 3.5s ease-in-out infinite;
          pointer-events: none;
          z-index: 10;
        }

        @keyframes shineSweep {
          0%, 20% { transform: translateX(-150%) skewX(-20deg); }
          50%, 100% { transform: translateX(150%) skewX(-20deg); }
        }

        /* Spinning orange coins */
        .promo-coin {
          display: inline-block;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #ffd494, #ff8a00 70%, #d46500 100%);
          border: 1.5px solid #ffffff;
          box-shadow: 0 4px 8px rgba(0,0,0,0.3);
          transform-style: preserve-3d;
          animation: coinSpin 2.4s linear infinite;
        }

        @keyframes coinSpin {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(360deg); }
        }

        /* Word flip reveal */
        .promo-word {
          display: inline-block;
          opacity: 0;
          transform: rotateX(-90deg) translateZ(-20px);
          animation: wordFlip 0.5s cubic-bezier(0.2, 1.2, 0.3, 1) forwards;
          margin-right: 0.28em;
          will-change: transform, opacity;
        }

        @keyframes wordFlip {
          0% {
            opacity: 0;
            transform: rotateX(-90deg) translateZ(-20px);
          }
          100% {
            opacity: 1;
            transform: rotateX(0deg) translateZ(0px);
          }
        }

        /* Headline 3D extrusion text shadow & breathing pulse */
        .promo-headline-3d {
          color: #ff8a00;
          text-shadow:
            0 1px 0 #e67300,
            0 2px 0 #cc6600,
            0 3px 0 #b35900,
            0 4px 0 #994c00,
            0 5px 8px rgba(0, 0, 0, 0.45);
          transform: translateZ(30px);
          animation: headlineBreathe 3s ease-in-out infinite alternate 0.8s;
          will-change: transform;
        }

        @keyframes headlineBreathe {
          0% { transform: translateZ(30px) scale(1); }
          100% { transform: translateZ(38px) scale(1.025); }
        }

        /* Primary big 3D button */
        .promo-primary-btn {
          position: relative;
          background: linear-gradient(180deg, #ff9f1c 0%, #ff8a00 60%, #e67300 100%);
          color: #ffffff;
          border: 2px solid #ffffff;
          border-radius: 9999px;
          padding: 14px 28px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-size: clamp(1rem, 2.5vw, 1.2rem);
          cursor: pointer;
          transform: translateZ(60px);
          box-shadow:
            0 6px 0 #a34800,
            0 12px 20px rgba(0, 0, 0, 0.4),
            0 0 20px rgba(255, 138, 0, 0.45);
          transition: all 0.12s ease;
          overflow: hidden;
          outline: none;
        }

        .promo-primary-btn:hover {
          transform: translateZ(64px) translateY(-2px);
          box-shadow:
            0 8px 0 #a34800,
            0 16px 25px rgba(0, 0, 0, 0.45),
            0 0 30px rgba(255, 138, 0, 0.65);
        }

        .promo-primary-btn:active {
          transform: translateZ(56px) translateY(4px);
          box-shadow:
            0 2px 0 #a34800,
            0 4px 10px rgba(0, 0, 0, 0.35);
        }

        .promo-primary-btn:focus-visible {
          box-shadow: 0 0 0 3px #ffffff, 0 0 0 6px #ff8a00;
        }

        /* Secondary pills */
        .promo-secondary-pill {
          background: rgba(255, 255, 255, 0.92);
          color: #0b4522;
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-radius: 16px;
          padding: 10px 14px;
          text-align: left;
          cursor: pointer;
          transform: translateZ(45px);
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, background 0.2s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
          outline: none;
        }

        .promo-secondary-pill:hover {
          background: #ffffff;
          transform: translateZ(54px) translateY(-3px) scale(1.02);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.28);
        }

        .promo-secondary-pill:active {
          transform: translateZ(42px) translateY(1px);
        }

        .promo-secondary-pill:focus-visible {
          box-shadow: 0 0 0 2px #ff8a00, 0 0 0 4px #ffffff;
        }

        /* Close X button at translateZ(80px) */
        .promo-close-btn {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 44px;
          height: 44px;
          min-width: 44px;
          min-height: 44px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.35);
          border: 1.5px solid rgba(255, 255, 255, 0.5);
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transform: translateZ(80px);
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s ease, color 0.2s ease;
          z-index: 50;
          outline: none;
        }

        .promo-close-btn:hover {
          transform: translateZ(85px) rotate(90deg) scale(1.1);
          background: #ff8a00;
          color: #ffffff;
          border-color: #ffffff;
        }

        .promo-close-btn:focus-visible {
          box-shadow: 0 0 0 3px #ffffff, 0 0 0 5px #ff8a00;
        }

        /* Ripple effect */
        .promo-ripple {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.5);
          transform: scale(0);
          animation: rippleEffect 0.6s linear forwards;
          pointer-events: none;
        }

        @keyframes rippleEffect {
          to {
            transform: scale(4);
            opacity: 0;
          }
        }

        /* Confetti particle bursts */
        .promo-confetti-particle {
          position: absolute;
          top: -10px;
          pointer-events: none;
          animation: confettiDrop linear forwards;
          z-index: 30;
        }

        @keyframes confettiDrop {
          0% {
            opacity: 1;
            transform: translateY(0) rotate(0deg);
          }
          100% {
            opacity: 0;
            transform: translateY(480px) rotate(720deg);
          }
        }

        /* Sparkles */
        .promo-sparkle {
          position: absolute;
          width: 8px;
          height: 8px;
          background: #ffffff;
          clip-path: polygon(50% 0%, 65% 35%, 100% 50%, 65% 65%, 50% 100%, 35% 65%, 0% 50%, 35% 35%);
          animation: sparkleTwinkle 1.8s ease-in-out infinite alternate;
          pointer-events: none;
        }

        @keyframes sparkleTwinkle {
          0% { transform: scale(0.4) rotate(0deg); opacity: 0.3; }
          50% { transform: scale(1.2) rotate(45deg); opacity: 1; }
          100% { transform: scale(0.6) rotate(90deg); opacity: 0.4; }
        }

        /* Accessibility: Prefers reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .buyoll-promo-overlay.is-entering .buyoll-promo-scene,
          .buyoll-promo-overlay.is-closing .buyoll-promo-scene {
            animation: none !important;
            transform: none !important;
          }
          .promo-front-card::before,
          .promo-front-card::after,
          .promo-gift-box-wrap,
          .promo-coin,
          .promo-headline-3d,
          .promo-word,
          .promo-confetti-particle,
          .promo-sparkle {
            animation: none !important;
            transform: none !important;
            opacity: 1 !important;
          }
          .promo-close-btn:hover {
            transform: none !important;
          }
        }
      `}</style>

      {/* Confetti & sparkles burst */}
      {confettiList.map((item) => (
        <div
          key={item.id}
          className="promo-confetti-particle"
          style={{
            left: item.left,
            backgroundColor: item.color,
            width: item.size,
            height: item.size,
            borderRadius: item.isCircle ? '50%' : '2px',
            animationDelay: item.delay,
            animationDuration: item.duration,
          }}
        />
      ))}

      {/* 3D Scene Wrapper with Dynamic Tilt */}
      <div
        ref={cardRef}
        className="buyoll-promo-scene"
        style={{
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* BACK CARD (Ribbon card) */}
        <div className="promo-back-card">
          {/* Floating 3D Gift Box */}
          <div className="promo-gift-box-wrap" aria-hidden="true">
            <div className="promo-cube">
              <div className="promo-cube-face front">
                <div className="promo-ribbon-v" />
                <div className="promo-ribbon-h" />
              </div>
              <div className="promo-cube-face back">
                <div className="promo-ribbon-v" />
                <div className="promo-ribbon-h" />
              </div>
              <div className="promo-cube-face right">
                <div className="promo-ribbon-v" />
                <div className="promo-ribbon-h" />
              </div>
              <div className="promo-cube-face left">
                <div className="promo-ribbon-v" />
                <div className="promo-ribbon-h" />
              </div>
              <div className="promo-cube-face top">
                <div className="promo-ribbon-v" />
                <div className="promo-ribbon-h" />
              </div>
              <div className="promo-cube-face bottom" />
            </div>
          </div>

          {/* Sparkles */}
          <div className="promo-sparkle" style={{ top: '12px', right: '40px', animationDelay: '0.2s' }} />
          <div className="promo-sparkle" style={{ top: '35px', left: '100px', animationDelay: '0.7s' }} />

          {/* Back card banner text: BUNDLE in italic orange, SALE in italic white, with high-contrast LIMITED TIME badge */}
          <div className="flex items-center gap-2 sm:gap-3 tracking-wider font-black select-none text-base sm:text-lg pl-8 sm:pl-0">
            <span className="italic text-[#ff8a00] font-black tracking-widest drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              BUNDLE
            </span>
            <span className="italic text-white font-black tracking-widest drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              SALE
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs uppercase bg-gradient-to-r from-[#ff8a00] to-[#ffb347] text-slate-950 font-black px-2.5 py-0.5 rounded-full border border-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] ml-1 tracking-wider whitespace-nowrap">
              LIMITED TIME
            </span>
          </div>
        </div>

        {/* FRONT CARD (Main Message & Action Deck) */}
        <div className="promo-front-card">
          {/* Round X Close Button (44x44px target) */}
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close promotion"
            onClick={() => triggerClose('x')}
            className="promo-close-btn"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Top category label & badge */}
          <div className="flex items-center gap-2.5 mb-2 select-none">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-100 bg-black/25 px-2.5 py-0.5 rounded-full border border-white/20">
              {activeMessage.category}
            </span>
            <span className="text-xs text-emerald-200/80 font-medium hidden sm:inline">
              · 3-Day Special Deal
            </span>
          </div>

          {/* Secondary Header: "Bundle deals" with spinning coins */}
          <div className="flex items-center gap-2 mb-2 select-none">
            <h3 className="text-sm sm:text-base font-extrabold uppercase tracking-wide text-white/95">
              Bundle deals
            </h3>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="promo-coin" style={{ animationDelay: '0s' }} />
              <span className="promo-coin" style={{ animationDelay: '0.4s' }} />
              <span className="promo-coin hidden sm:inline-block" style={{ animationDelay: '0.8s' }} />
            </div>
          </div>

          {/* Large Bold Orange Rotating Message with 3D extruded shadow & Word Flip Reveal */}
          <div className="my-4 sm:my-5 min-h-[72px] sm:min-h-[88px] flex items-center">
            <h2
              id="buyoll-promo-heading"
              className="promo-headline-3d text-2xl sm:text-3xl md:text-4xl font-black leading-tight sm:leading-snug tracking-tight"
            >
              {messageWords.map((word, idx) => (
                <span
                  key={`${word}-${idx}`}
                  className="promo-word"
                  style={{ animationDelay: `${idx * 60 + 100}ms` }}
                >
                  {word}
                </span>
              ))}
            </h2>
          </div>

          {/* Primary CTA Button (3D orange pill with white border) */}
          <div className="mt-4 mb-4 text-center">
            <button
              type="button"
              onClick={handlePrimaryClick}
              className="promo-primary-btn w-full sm:w-auto min-w-[260px] inline-flex items-center justify-center gap-2"
            >
              <span>{primaryCta.label}</span>
              <svg
                className="w-5 h-5 transition-transform group-hover:translate-x-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {ripples.map((r) => (
                <span
                  key={r.id}
                  className="promo-ripple"
                  style={{
                    left: r.x,
                    top: r.y,
                    width: 40,
                    height: 40,
                  }}
                />
              ))}
            </button>
            <div className="text-[11px] text-emerald-100/90 font-medium mt-1.5">
              {primaryCta.sub}
            </div>
          </div>

          {/* Secondary CTAs (2x2 grid on desktop, compact stack on mobile) */}
          {secondaryCtas.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/15">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
                {secondaryCtas.map((cta) => (
                  <button
                    key={cta.id}
                    type="button"
                    onClick={() => {
                      onCtaClick(cta);
                    }}
                    className="promo-secondary-pill flex flex-col justify-center"
                  >
                    <span className="text-xs sm:text-sm font-black text-slate-900 tracking-tight flex items-center justify-between">
                      <span>{cta.label}</span>
                      <span className="text-[#ff8a00] text-xs font-bold">→</span>
                    </span>
                    <span className="text-[10px] sm:text-[11px] text-slate-600 font-medium truncate mt-0.5">
                      {cta.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subtle footer note */}
          <div className="mt-3 text-center">
            <span className="text-[10px] text-emerald-200/70 font-mono">
              Press Esc or click anywhere outside to close · Swipe down on mobile
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
