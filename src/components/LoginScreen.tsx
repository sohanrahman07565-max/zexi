import React, { useState, useEffect, useRef } from 'react';
import { api, AdminUser } from '../lib/api';
import { toast } from '../lib/toast';

import { DEFAULT_LOGO_URL } from './SplashScreen';

interface LoginScreenProps {
  onSuccess: (admin: AdminUser) => void;
  design?: any;
}

const EMBEDDED_ZEXI_LOGO =
  'data:image/jpeg;base64,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';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess, design }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [popToggle, setPopToggle] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [emailShakeKey, setEmailShakeKey] = useState(0);
  const [passwordShakeKey, setPasswordShakeKey] = useState(0);
  const [isSuccessExiting, setIsSuccessExiting] = useState(false);
  const [targetBotId, setTargetBotId] = useState<string | null>(null);
  const resolveLogo = (rawUrl?: string) => {
    const clean = rawUrl ? String(rawUrl).trim() : '';
    if (
      !clean ||
      clean === DEFAULT_LOGO_URL ||
      clean.includes('df6c9e167caf42c6') ||
      clean.includes('4fae5ca52db64590') ||
      clean.includes('f61e20b6c71945c4')
    ) {
      return DEFAULT_LOGO_URL;
    }
    return clean;
  };

  const [logoSrc, setLogoSrc] = useState<string>(() => resolveLogo(design?.loginLogoUrl));

  const cardRef = useRef<HTMLDivElement | null>(null);
  const signinBtnRef = useRef<HTMLButtonElement | null>(null);
  const userInputRef = useRef<HTMLInputElement | null>(null);
  const passInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLogoSrc(resolveLogo(design?.loginLogoUrl));
  }, [design?.loginLogoUrl]);

  const [tmaAvailable, setTmaAvailable] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const bid = (params.get('bot_id') || params.get('botId') || '').trim();
        if (bid) {
          setTargetBotId(bid);
          api.setActiveBotId(bid);
        } else {
          api.setActiveBotId('main');
        }
        const tgWebApp = (window as any).Telegram?.WebApp;
        if (tgWebApp?.initData) {
          setTmaAvailable(true);
        }
      }
    } catch {}
  }, []);

  // Desktop subtle 3D perspective tilt matching reference design
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !window.matchMedia('(hover:hover)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!cardRef.current || isSuccessExiting) return;
      const x = (e.clientX / window.innerWidth - 0.5) * 8;
      const y = (e.clientY / window.innerHeight - 0.5) * -8;
      cardRef.current.style.transform = `perspective(900px) rotateY(${x}deg) rotateX(${y}deg)`;
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isSuccessExiting]);

  const triggerEmailError = (msg: string) => {
    setEmailError(msg);
    setEmailShakeKey((k) => k + 1);
    userInputRef.current?.focus();
  };

  const triggerPasswordError = (msg: string) => {
    setPasswordError(msg);
    setPasswordShakeKey((k) => k + 1);
    passInputRef.current?.focus();
  };

  const spawnRipple = (e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = signinBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const d = Math.max(rect.width, rect.height);
    const ripple = document.createElement('i');
    ripple.className = 'zexi-login-ripple';
    ripple.style.width = `${d}px`;
    ripple.style.height = `${d}px`;
    ripple.style.left = `${e.clientX - rect.left - d / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - d / 2}px`;
    btn.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 700);
  };

  // Login Submission: Strictly checks credentials against ENV and authorized sub-admins
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || isSuccessExiting) return;

    const cleanId = identifier.trim();
    const cleanPassword = password.trim();

    setEmailError(null);
    setPasswordError(null);

    if (!cleanId && !cleanPassword) {
      triggerEmailError(targetBotId && targetBotId !== 'main' ? 'Please enter your Admin ID and password' : 'Please enter your username or email and password');
      return;
    }
    if (!cleanId) {
      triggerEmailError(targetBotId && targetBotId !== 'main' ? 'Please enter your Admin ID' : 'Please enter your username or email');
      return;
    }
    if (!cleanPassword) {
      triggerPasswordError('Please enter your password');
      return;
    }

    setLoading(true);
    try { window.sessionStorage?.removeItem('tg_just_logged_out'); } catch {}

    try {
      const res = await api.login(cleanId, cleanPassword);

      if (typeof window !== 'undefined' && res.botId && res.botId !== 'main') {
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.get('bot_id') !== res.botId) {
            url.searchParams.set('bot_id', res.botId);
            window.history.replaceState({}, '', url.toString());
          }
        } catch {}
      }

      setIsSuccessExiting(true);
      toast.success(`Welcome back, ${res.admin.name || 'Admin'}!`);

      setTimeout(() => {
        onSuccess(res.admin);
      }, 450);
    } catch (err: any) {
      console.error('[Login] Authentication error:', err);
      const msg = String(err.message || '');
      if (err.field === 'password' || /password/i.test(msg)) {
        triggerPasswordError('Incorrect password');
      } else {
        triggerEmailError('Access Denied');
      }
      setLoading(false);
      setIsSuccessExiting(false);
    }
  };

  // One-tap Telegram Mini App authentication using Telegram.WebApp.initData
  const handleTmaSignIn = async () => {
    if (loading || isSuccessExiting) return;
    const tmaInitData = typeof window !== 'undefined' ? String((window as any).Telegram?.WebApp?.initData || '').trim() : '';
    if (!tmaInitData) {
      triggerEmailError('Telegram Mini App session unavailable');
      return;
    }

    setEmailError(null);
    setPasswordError(null);
    setLoading(true);
    try { window.sessionStorage?.removeItem('tg_just_logged_out'); } catch {}

    try {
      const res = await api.tmaLogin(tmaInitData);
      setIsSuccessExiting(true);
      toast.success(`Welcome back, ${res.admin.name || 'Admin'}!`);
      setTimeout(() => {
        onSuccess(res.admin);
      }, 450);
    } catch (err: any) {
      console.error('[TMA Sign-In] Error:', err);
      triggerEmailError(err?.message || 'Access Denied');
      setLoading(false);
      setIsSuccessExiting(false);
    }
  };

  const title = design?.loginTitle || 'ADMIN PANEL';
  const subtitle = design?.loginSubtitle || 'SECURE ACCESS';

  return (
    <div className="zexi-login-root">
      <style>{`
        @property --zexi-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }

        .zexi-login-root {
          --zexi-bg: #07060f;
          --zexi-card: rgba(24, 24, 40, 0.62);
          --zexi-text: #fff;
          --zexi-muted: #8d8ca6;
          --zexi-pink: #e879b9;
          --zexi-violet: #a78bfa;
          --zexi-blue: #60a5fa;
          --zexi-green: #34d399;
          min-height: 100vh;
          min-height: 100dvh;
          width: 100%;
          box-sizing: border-box;
          background: var(--zexi-bg);
          color: var(--zexi-text);
          font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow-x: hidden;
          overflow-y: auto;
          position: relative;
          padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));
        }

        .zexi-login-goo-svg {
          position: absolute;
          width: 0;
          height: 0;
          pointer-events: none;
        }

        .zexi-login-liquid {
          position: fixed;
          inset: 0;
          filter: url(#zexi-login-goo);
          z-index: 0;
          pointer-events: none;
        }

        .zexi-login-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(2px);
          opacity: 0.75;
          animation: zexiLoginDrift 18s ease-in-out infinite alternate;
        }

        .zexi-login-b1 {
          width: 46vmax;
          height: 46vmax;
          left: -14vmax;
          top: -10vmax;
          background: radial-gradient(circle, #b0204a, #4b0f2b 70%);
        }

        .zexi-login-b2 {
          width: 40vmax;
          height: 40vmax;
          right: -12vmax;
          bottom: -8vmax;
          background: radial-gradient(circle, #5b2bd6, #1d1250 70%);
          animation-duration: 22s;
        }

        .zexi-login-b3 {
          width: 26vmax;
          height: 26vmax;
          left: 35%;
          top: 55%;
          background: radial-gradient(circle, #0e7fd8, #0a2a5a 70%);
          animation-duration: 26s;
          opacity: 0.5;
        }

        .zexi-login-b4 {
          width: 20vmax;
          height: 20vmax;
          right: 20%;
          top: 6%;
          background: radial-gradient(circle, #c026d3, #4a0a5a 70%);
          animation-duration: 20s;
          opacity: 0.5;
        }

        @keyframes zexiLoginDrift {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(8vmax, 6vmax) scale(1.18); }
          100% { transform: translate(-5vmax, 10vmax) scale(0.92); }
        }

        .zexi-login-dots {
          position: fixed;
          inset: 0;
          z-index: 1;
          background-image: radial-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1.2px);
          background-size: 26px 26px;
          mask-image: radial-gradient(circle at 50% 50%, #000, transparent 80%);
          -webkit-mask-image: radial-gradient(circle at 50% 50%, #000, transparent 80%);
          pointer-events: none;
        }

        .zexi-login-card {
          position: relative;
          z-index: 2;
          width: min(100%, 400px);
          margin: auto;
          box-sizing: border-box;
          padding: 34px 26px 26px;
          border-radius: 34px;
          background: var(--zexi-card);
          backdrop-filter: blur(26px) saturate(150%);
          -webkit-backdrop-filter: blur(26px) saturate(150%);
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
          animation: zexiLoginRise 0.9s cubic-bezier(0.2, 0.9, 0.25, 1) both;
          transform-style: preserve-3d;
          transition: transform 0.15s ease-out, opacity 0.42s ease;
        }

        .zexi-login-card.exiting {
          opacity: 0;
          transform: scale(0.95) translateY(10px) !important;
        }

        .zexi-login-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1.5px;
          background: conic-gradient(from var(--zexi-angle, 0deg), #e879b9, #a78bfa, #60a5fa, #34d399, #e879b9);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          animation: zexiLoginSpin 6s linear infinite;
          pointer-events: none;
        }

        @keyframes zexiLoginSpin {
          to { --zexi-angle: 360deg; }
        }

        @keyframes zexiLoginRise {
          from { opacity: 0; transform: translateY(40px) scale(0.94); }
          to { opacity: 1; transform: none; }
        }

        .zexi-login-logo {
          position: relative;
          width: 78px;
          height: 78px;
          margin: 0 auto 18px;
          animation: zexiLoginFloat 4.5s ease-in-out infinite;
        }

        .zexi-login-logo img {
          width: 100%;
          height: 100%;
          border-radius: 22px;
          display: block;
          object-fit: cover;
          position: relative;
          z-index: 1;
        }

        @keyframes zexiLoginFloat {
          50% { transform: translateY(-7px); }
        }

        .zexi-login-title {
          margin: 0;
          text-align: center;
          font-size: 27px;
          letter-spacing: 0.09em;
          font-weight: 800;
          background: linear-gradient(90deg, #fff, #d8c8ff, #fff);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: zexiLoginShine 5s linear infinite;
          text-transform: uppercase;
        }

        @keyframes zexiLoginShine {
          to { background-position: -200% 0; }
        }

        .zexi-login-sub {
          text-align: center;
          margin: 10px 0 28px;
          font-size: 12.5px;
          letter-spacing: 0.3em;
          color: var(--zexi-muted);
          font-weight: 600;
          text-transform: uppercase;
        }

        .zexi-login-cloned-pill {
          margin: -14px auto 22px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 99px;
          background: rgba(167, 139, 250, 0.14);
          border: 1px solid rgba(232, 121, 185, 0.35);
          font-size: 11px;
          font-weight: 700;
          color: #f0abfc;
        }

        .zexi-login-label {
          display: block;
          font-size: 12.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: #c9c8de;
          margin: 0 0 9px 2px;
        }

        .zexi-login-field {
          position: relative;
          margin-bottom: 20px;
          opacity: 0;
          animation: zexiLoginRise 0.7s 0.35s cubic-bezier(0.2, 0.9, 0.25, 1) forwards;
        }

        .zexi-login-field-2 {
          animation-delay: 0.5s;
        }

        .zexi-login-box {
          position: relative;
          display: flex;
          align-items: center;
          height: 56px;
          border-radius: 18px;
          background: rgba(8, 8, 20, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s;
          overflow: hidden;
        }

        .zexi-login-box:focus-within {
          border-color: rgba(167, 139, 250, 0.8);
          box-shadow: 0 0 0 4px rgba(167, 139, 250, 0.15), 0 0 28px rgba(168, 85, 247, 0.35);
          transform: translateY(-1px);
        }

        .zexi-login-box::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: 0;
          height: 2px;
          width: 0;
          background: linear-gradient(90deg, var(--zexi-pink), var(--zexi-blue), var(--zexi-green));
          transition: width 0.5s;
        }

        .zexi-login-box:focus-within::after {
          width: 100%;
        }

        .zexi-login-spg {
          flex: none;
          width: 30px;
          height: 30px;
          margin: 0 12px 0 14px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          font-size: 9.5px;
          font-weight: 900;
          letter-spacing: 0.02em;
          color: #fff;
          background: linear-gradient(135deg, #a855f7, #ec4899);
          box-shadow: 0 4px 14px rgba(168, 85, 247, 0.5);
          transition: transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
        }

        .zexi-login-box:focus-within .zexi-login-spg {
          transform: rotate(-8deg) scale(1.12);
        }

        .zexi-login-input {
          flex: 1;
          min-width: 0;
          height: 100%;
          background: transparent;
          border: 0;
          outline: 0;
          color: #fff;
          font: inherit;
          font-size: 16px;
          padding-right: 14px;
        }

        .zexi-login-input::placeholder {
          color: #6f6e88;
        }

        .zexi-login-toggle {
          flex: none;
          border: 0;
          background: none;
          color: var(--zexi-violet);
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.06em;
          padding: 0 16px;
          height: 100%;
          cursor: pointer;
          min-width: 62px;
          transition: color 0.2s, text-shadow 0.2s;
        }

        .zexi-login-toggle:hover {
          color: #fff;
          text-shadow: 0 0 12px var(--zexi-violet);
        }

        .zexi-login-toggle.pop {
          animation: zexiLoginPop 0.3s;
        }

        @keyframes zexiLoginPop {
          50% { transform: scale(1.2); }
        }

        .zexi-login-signin {
          position: relative;
          width: 100%;
          height: 56px;
          border: 0;
          border-radius: 18px;
          color: #fff;
          font: inherit;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: 0.12em;
          cursor: pointer;
          overflow: hidden;
          background: linear-gradient(110deg, #e879b9, #a78bfa, #ec4899, #e879b9);
          background-size: 250% 100%;
          animation: zexiLoginFlow 6s linear infinite, zexiLoginRise 0.7s 0.65s both;
          box-shadow: 0 10px 30px rgba(236, 72, 153, 0.35);
          transition: transform 0.2s, box-shadow 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        @keyframes zexiLoginFlow {
          to { background-position: -250% 0; }
        }

        .zexi-login-signin:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 14px 38px rgba(236, 72, 153, 0.5);
        }

        .zexi-login-signin:active:not(:disabled) {
          transform: scale(0.98);
        }

        .zexi-login-signin::before {
          content: "";
          position: absolute;
          top: 0;
          left: -60%;
          width: 40%;
          height: 100%;
          background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.45), transparent);
          transform: skewX(-20deg);
          animation: zexiLoginSweep 3.4s ease-in-out infinite;
        }

        @keyframes zexiLoginSweep {
          60%, 100% { left: 130%; }
        }

        .zexi-login-ripple {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.5);
          transform: scale(0);
          animation: zexiLoginRp 0.7s ease-out forwards;
          pointer-events: none;
        }

        @keyframes zexiLoginRp {
          to { transform: scale(4); opacity: 0; }
        }

        .zexi-login-signin.load span {
          opacity: 0;
        }

        .zexi-login-signin.load::after {
          content: "";
          width: 22px;
          height: 22px;
          border: 3px solid rgba(255, 255, 255, 0.4);
          border-top-color: #fff;
          border-radius: 50%;
          position: absolute;
          animation: zexiLoginRot 0.7s linear infinite;
        }

        @keyframes zexiLoginRot {
          to { transform: rotate(360deg); }
        }

        .zexi-login-err {
          max-height: 0;
          overflow: hidden;
          opacity: 0;
          color: #ff6b81;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.03em;
          margin: 0 0 0 4px;
          transition: max-height 0.35s, opacity 0.35s, margin 0.35s;
        }

        .zexi-login-err.show {
          max-height: 36px;
          opacity: 1;
          margin-top: 9px;
        }

        .zexi-login-box.bad {
          border-color: rgba(255, 107, 129, 0.9);
          box-shadow: 0 0 0 4px rgba(255, 107, 129, 0.14), 0 0 26px rgba(255, 80, 110, 0.35);
        }

        .zexi-login-box.shake {
          animation: zexiLoginShake 0.55s cubic-bezier(0.36, 0.07, 0.19, 0.97);
        }

        @keyframes zexiLoginShake {
          10%, 90% { transform: translateX(-2px); }
          20%, 80% { transform: translateX(5px); }
          30%, 50%, 70% { transform: translateX(-9px); }
          40%, 60% { transform: translateX(9px); }
        }

        .zexi-login-google {
          display: block;
          margin: 20px auto 0;
          width: 48px;
          height: 48px;
          border: 0;
          background: none;
          padding: 0;
          cursor: pointer;
          transition: transform 0.3s cubic-bezier(0.3, 1.6, 0.5, 1), filter 0.3s;
          animation: zexiLoginRise 0.7s 0.8s both;
        }

        .zexi-login-google svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        .zexi-login-google:hover:not(:disabled) {
          transform: scale(1.2) rotate(-6deg);
          filter: drop-shadow(0 0 14px rgba(96, 165, 250, 0.7));
        }

        .zexi-login-google:active:not(:disabled) {
          transform: scale(0.92);
        }

        .zexi-login-google:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .zexi-login-foot-wrap {
          margin-top: 22px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 18px;
        }

        .zexi-login-foot {
          margin: 0;
          padding: 0;
          border: 0;
          text-align: center;
          font-size: 12.5px;
          font-weight: 700;
          letter-spacing: 0.28em;
          background: linear-gradient(90deg, var(--zexi-pink), var(--zexi-blue), var(--zexi-green), var(--zexi-pink));
          background-size: 250% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: zexiLoginFlow 7s linear infinite;
        }

        @media (max-width: 360px) {
          .zexi-login-card {
            padding: 26px 18px 22px;
            border-radius: 26px;
          }
          .zexi-login-logo {
            width: 66px;
            height: 66px;
            margin-bottom: 14px;
          }
          .zexi-login-title {
            font-size: clamp(20px, 6.8vw, 27px);
            letter-spacing: 0.06em;
          }
          .zexi-login-sub {
            letter-spacing: 0.2em;
            margin: 8px 0 22px;
          }
          .zexi-login-box,
          .zexi-login-signin {
            height: 50px;
          }
          .zexi-login-spg {
            margin: 0 10px;
          }
          .zexi-login-foot {
            letter-spacing: 0.18em;
            font-size: 11px;
          }
        }

        @media (max-height: 620px) {
          .zexi-login-card {
            padding: 24px 22px 20px;
          }
          .zexi-login-logo {
            width: 64px;
            height: 64px;
            margin-bottom: 12px;
          }
          .zexi-login-sub {
            margin: 6px 0 18px;
          }
          .zexi-login-field {
            margin-bottom: 14px;
          }
          .zexi-login-google {
            margin-top: 14px;
            width: 44px;
            height: 44px;
          }
          .zexi-login-foot-wrap {
            margin-top: 16px;
            padding-top: 14px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .zexi-login-root * {
            animation-duration: 0.01s !important;
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>

      <svg className="zexi-login-goo-svg" width="0" height="0" aria-hidden="true">
        <defs>
          <filter id="zexi-login-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="b" />
            <feColorMatrix
              in="b"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
            />
          </filter>
        </defs>
      </svg>

      <div className="zexi-login-liquid" aria-hidden="true">
        <i className="zexi-login-blob zexi-login-b1" />
        <i className="zexi-login-blob zexi-login-b2" />
        <i className="zexi-login-blob zexi-login-b3" />
        <i className="zexi-login-blob zexi-login-b4" />
      </div>
      <div className="zexi-login-dots" aria-hidden="true" />

      <main className={`zexi-login-card ${isSuccessExiting ? 'exiting' : ''}`} id="card" ref={cardRef}>
        <div className="zexi-login-logo">
          <img
            alt="Dark"
            src={logoSrc}
            onError={() => {
              if (logoSrc !== EMBEDDED_ZEXI_LOGO) {
                setLogoSrc(EMBEDDED_ZEXI_LOGO);
              }
            }}
          />
        </div>
        <h1 className="zexi-login-title">{title}</h1>
        <div className="zexi-login-sub">{subtitle}</div>

        {targetBotId && targetBotId !== 'main' && (
          <div style={{ textAlign: 'center' }}>
            <div className="zexi-login-cloned-pill">Cloned Bot Sub-Admin Panel</div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="zexi-login-field">
            <label className="zexi-login-label" htmlFor="u">
              {targetBotId && targetBotId !== 'main' ? 'ENTER ADMIN ID' : 'ENTER USERNAME OR EMAIL'}
            </label>
            <div className={`zexi-login-box ${emailError ? 'bad shake' : ''}`} key={`u-box-${emailShakeKey}`}>
              <span className="zexi-login-spg">
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
                </svg>
              </span>
              <input
                ref={userInputRef}
                id="u"
                type="text"
                placeholder={targetBotId && targetBotId !== 'main' ? 'Enter Admin ID' : 'Enter Username or Email'}
                autoComplete="username"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                className="zexi-login-input"
              />
            </div>
            <div className={`zexi-login-err ${emailError ? 'show' : ''}`} id="ue" role="alert">
              {emailError || ''}
            </div>
          </div>

          <div className="zexi-login-field zexi-login-field-2">
            <label className="zexi-login-label" htmlFor="p">
              ENTER PASSWORD
            </label>
            <div className={`zexi-login-box ${passwordError ? 'bad shake' : ''}`} key={`p-box-${passwordShakeKey}`}>
              <span className="zexi-login-spg">
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                  <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
                  <circle cx="12" cy="15.5" r="1.2" fill="#fff" />
                </svg>
              </span>
              <input
                ref={passInputRef}
                id="p"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                className="zexi-login-input"
              />
              <button
                className={`zexi-login-toggle ${popToggle ? 'pop' : ''}`}
                id="t"
                type="button"
                aria-label="Show or hide password"
                onClick={() => {
                  setShowPassword((prev) => !prev);
                  setPopToggle(false);
                  window.requestAnimationFrame(() => setPopToggle(true));
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className={`zexi-login-err ${passwordError ? 'show' : ''}`} id="pe" role="alert">
              {passwordError || ''}
            </div>
          </div>

          <button
            ref={signinBtnRef}
            className={`zexi-login-signin ${loading ? 'load' : ''}`}
            id="s"
            type="submit"
            disabled={loading || isSuccessExiting}
            onClick={spawnRipple}
          >
            <span>SIGN IN</span>
          </button>

          {tmaAvailable && (
            <button
              type="button"
              onClick={handleTmaSignIn}
              disabled={loading || isSuccessExiting}
              style={{
                width: '100%',
                marginTop: '14px',
                height: '46px',
                borderRadius: '16px',
                border: '1px solid rgba(96, 165, 250, 0.35)',
                background: 'rgba(59, 130, 246, 0.14)',
                color: '#bfdbfe',
                fontSize: '12.5px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <span>Continue with Telegram Account</span>
            </button>
          )}

        </form>

        <div className="zexi-login-foot-wrap">
          <div className="zexi-login-foot">POWERED BY DARK TEAM</div>
        </div>
      </main>
    </div>
  );
};
