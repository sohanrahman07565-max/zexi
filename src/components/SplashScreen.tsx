import React, { useState, useEffect, useRef } from 'react';

export const DEFAULT_LOGO_URL = 'https://host.tscv.workers.dev/img/4fae5ca52db64590';

// Eagerly pre-cache custom logo in browser memory immediately
if (typeof window !== 'undefined') {
  try {
    const preImg = new Image();
    preImg.src = DEFAULT_LOGO_URL;
  } catch {}
}

interface SplashScreenProps {
  onComplete: () => void;
  logoSymbol?: string;
  logoUrl?: string;
  title?: string;
  accentColor?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onComplete,
  logoSymbol = '惡',
  logoUrl = DEFAULT_LOGO_URL,
  title = 'ADMIN PANEL',
  accentColor = '#ef4444'
}) => {
  const [progress, setProgress] = useState(1);
  const [statusText, setStatusText] = useState('INITIALIZING SECURE PROTOCOL...');
  const [isExiting, setIsExiting] = useState(false);

  // Guarantee single execution of the 1 to 100 loading sequence without double-loading
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const startedRef = useRef(false);

  const finalLogoUrl = (logoUrl && logoUrl.trim() !== '') ? logoUrl.trim() : DEFAULT_LOGO_URL;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Single smooth progress animation counting from 1% to 100% exactly once
    const duration = 2100; // 2.1 seconds total duration
    const intervalTime = 25; // updates every 25ms
    const totalSteps = duration / intervalTime;
    let currentStep = 0;

    const timer = setInterval(() => {
      currentStep++;
      const t = currentStep / totalSteps;
      // Smooth easing progression from 1 to 100
      const easedProgress = Math.max(1, Math.min(100, Math.round((1 - Math.pow(1 - t, 2.2)) * 100)));

      setProgress(easedProgress);

      if (easedProgress < 30) {
        setStatusText('INITIALIZING SECURE PROTOCOL...');
      } else if (easedProgress < 65) {
        setStatusText('LOADING ENCRYPTED MODULES...');
      } else if (easedProgress < 95) {
        setStatusText('ESTABLISHING ACCESS GATEWAY...');
      } else {
        setStatusText('SYSTEM READY');
      }

      if (currentStep >= totalSteps) {
        clearInterval(timer);
        setProgress(100);
        setStatusText('SYSTEM READY');

        // Smooth fade-out transition after reaching 100%
        setTimeout(() => {
          setIsExiting(true);
          setTimeout(() => {
            onCompleteRef.current();
          }, 500);
        }, 200);
      }
    }, intervalTime);

    return () => clearInterval(timer);
  }, []);

  // Dynamic color transformation that smoothly shifts as progress fills up
  const getDynamicProgressStyle = (p: number) => {
    if (p < 25) {
      return {
        gradient: 'linear-gradient(90deg, #06b6d4, #0ea5e9, #38bdf8)',
        color: '#38bdf8',
        glow: '0 0 18px rgba(14, 165, 233, 0.7)'
      };
    } else if (p < 50) {
      return {
        gradient: 'linear-gradient(90deg, #0ea5e9, #6366f1, #8b5cf6)',
        color: '#a855f7',
        glow: '0 0 18px rgba(99, 102, 241, 0.7)'
      };
    } else if (p < 75) {
      return {
        gradient: 'linear-gradient(90deg, #8b5cf6, #d946ef, #f43f5e)',
        color: '#f43f5e',
        glow: '0 0 18px rgba(244, 63, 94, 0.75)'
      };
    } else {
      return {
        gradient: 'linear-gradient(90deg, #f43f5e, #10b981, #06b6d4)',
        color: '#10b981',
        glow: '0 0 20px rgba(16, 185, 129, 0.8)'
      };
    }
  };

  const dynamicColorStyle = getDynamicProgressStyle(progress);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050508] text-white overflow-hidden select-none transition-all duration-700 cubic-bezier(0.4,0,0.2,1) ${
        isExiting ? 'opacity-0 scale-125 blur-md pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Background: Deep dark/black with a subtle neon red gradient & ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 45%, ${accentColor}26 0%, ${accentColor}0a 45%, rgba(5, 5, 8, 0.98) 75%)`
        }}
      />
      <div
        className="absolute w-[500px] h-[500px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px] pointer-events-none animate-pulse"
        style={{
          backgroundColor: `${accentColor}18`,
          animationDuration: '3s'
        }}
      />

      {/* Subtle background tech grid */}
      <div 
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, ${accentColor} 1px, transparent 1px), linear-gradient(to bottom, ${accentColor} 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      />

      {/* Central Interactive Animation Box */}
      <div className="relative z-10 flex flex-col items-center px-6">
        {/* Rotating Ring + Central Logo Container */}
        <div className="relative w-44 h-44 sm:w-48 sm:h-48 flex items-center justify-center mb-8">
          {/* Subtle Outer Glowing Track */}
          <div 
            className="absolute inset-0 rounded-full border border-red-500/15"
            style={{
              boxShadow: `0 0 30px -5px ${accentColor}20`
            }}
          />

          {/* SVG Rotating Glowing Ring Spinner */}
          <svg
            className="absolute inset-0 w-full h-full animate-[spin_2.4s_linear_infinite]"
            viewBox="0 0 100 100"
          >
            <defs>
              <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={accentColor} stopOpacity="1" />
                <stop offset="50%" stopColor="#f43f5e" stopOpacity="0.8" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0.05" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Orbiting Ring Arc */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="url(#ringGradient)"
              strokeWidth="2.8"
              strokeDasharray="95 180"
              strokeLinecap="round"
              filter="url(#glow)"
            />

            {/* Glowing Orbiting Leading Dot */}
            <circle
              cx="50"
              cy="6"
              r="2.5"
              fill="#ffffff"
              filter="url(#glow)"
              style={{
                boxShadow: `0 0 10px #ffffff, 0 0 20px ${accentColor}`
              }}
            />
          </svg>

          {/* Secondary Counter-Rotating Subtle Arc for Depth */}
          <svg
            className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] animate-[spin_4s_linear_infinite_reverse] opacity-40"
            viewBox="0 0 100 100"
          >
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={accentColor}
              strokeWidth="1.2"
              strokeDasharray="40 120"
              strokeLinecap="round"
            />
          </svg>

          {/* Central Element: Circular user logo/avatar badge with crown & Zexi Tools */}
          <div
            className="relative z-10 w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center overflow-hidden transition-transform duration-500 shadow-2xl p-0.5"
            style={{
              background: `radial-gradient(circle, #2a0814 0%, #0c0408 100%)`,
              boxShadow: `0 0 38px ${accentColor}aa, inset 0 1px 3px rgba(255, 255, 255, 0.45)`,
              border: `2px solid ${accentColor}`
            }}
          >
            {/* Instant custom logo rendering from frame 0 with zero flickering */}
            <img
              src={finalLogoUrl}
              alt={title}
              className="w-full h-full object-cover rounded-full"
              loading="eager"
              decoding="sync"
            />

            {/* Subtle gloss highlight on logo */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none rounded-full" />
          </div>
        </div>

        {/* Branding Title */}
        <div className="text-center mb-6">
          <h2
            className="text-lg sm:text-xl font-black uppercase tracking-[0.25em] font-mono"
            style={{
              color: accentColor,
              textShadow: `0 0 18px ${accentColor}aa`
            }}
          >
            {title}
          </h2>
          <p className="text-[10px] font-bold tracking-[0.3em] text-zinc-500 uppercase mt-1">
            SECURE ACCESS SYSTEM
          </p>
        </div>

        {/* Thick Linear Progress Bar with Smooth Dynamic Color Sequence (No Light Streak) */}
        <div className="w-64 sm:w-72 flex flex-col gap-2.5">
          {/* Progress bar track & fill: Slightly thicker, rounded-full with high-end glass container */}
          <div className="w-full h-3 sm:h-3.5 bg-zinc-950/90 rounded-full border border-zinc-700/60 overflow-hidden p-[2px] relative shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]">
            <div
              className="h-full rounded-full relative"
              style={{
                width: `${progress}%`,
                background: dynamicColorStyle.gradient,
                boxShadow: dynamicColorStyle.glow,
                transition: 'width 75ms linear, background 350ms ease, box-shadow 350ms ease'
              }}
            />
          </div>

          {/* Percentage and Status Indicator with Dynamic Color Matching */}
          <div className="flex items-center justify-between text-[11px] font-mono tracking-wider">
            <span className="text-zinc-400 text-[10px] truncate max-w-[200px]">
              {statusText}
            </span>
            <span
              className="font-bold shrink-0 ml-2"
              style={{
                color: dynamicColorStyle.color,
                textShadow: `0 0 10px ${dynamicColorStyle.color}80`,
                transition: 'color 350ms ease, text-shadow 350ms ease'
              }}
            >
              {progress}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
