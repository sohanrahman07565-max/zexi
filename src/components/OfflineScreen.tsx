import React, { useState, useEffect, useCallback } from 'react';
import { WifiOff, RotateCcw, AlertTriangle, Radio, CheckCircle, RefreshCw } from 'lucide-react';

interface OfflineScreenProps {
  onRetry?: () => Promise<boolean> | boolean;
  accentColor?: string;
}

export const OfflineScreen: React.FC<OfflineScreenProps> = ({
  onRetry,
  accentColor = '#ef4444'
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [shake, setShake] = useState(false);

  // Auto-dismiss notification after 3.5s
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => {
      setNotification(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleTryAgain = useCallback(async () => {
    if (isChecking) return;
    setIsChecking(true);
    setNotification(null);

    // 1. First test navigator.onLine
    let online = typeof navigator !== 'undefined' ? navigator.onLine : false;

    // 2. Perform live fetch attempt to verify actual internet connectivity
    if (online) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('/api/health?t=' + Date.now(), {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        online = res.ok;
      } catch {
        online = false;
      }
    }

    if (onRetry) {
      try {
        const customRes = await onRetry();
        if (customRes) online = true;
      } catch {
        // Ignore
      }
    }

    // Pleasant realistic check delay
    await new Promise((resolve) => setTimeout(resolve, 600));

    setIsChecking(false);

    if (online) {
      setNotification({
        message: 'Connection restored! Reconnecting...',
        type: 'success'
      });
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 550);
      setNotification({
        message: 'Still offline • No internet connection detected. Please check Wi-Fi or mobile data.',
        type: 'error'
      });
    }
  }, [isChecking, onRetry]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#060608] text-white selection:bg-red-500 selection:text-white overflow-x-hidden overflow-y-auto select-none">
      {/* Background radial glow matching the admin panel aesthetics */}
      <div
        className="absolute w-[620px] h-[620px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[140px] pointer-events-none transition-all duration-700"
        style={{
          background: `radial-gradient(circle, ${accentColor}28 0%, ${accentColor}0a 50%, transparent 80%)`
        }}
      />

      {/* Cyberpunk grid overlay with soft red accent */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, ${accentColor} 1px, transparent 1px), linear-gradient(to bottom, ${accentColor} 1px, transparent 1px)`,
          backgroundSize: '36px 36px'
        }}
      />

      {/* Subtle scanline effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-red-500/[0.015] to-transparent pointer-events-none" />

      {/* Central Container Card with red glow and border */}
      <div
        className={`w-full max-w-sm relative z-10 rounded-3xl p-6 sm:p-8 bg-[#0c0c13]/95 border shadow-2xl backdrop-blur-2xl transition-all duration-300 overflow-hidden flex flex-col items-center text-center ${
          shake ? 'animate-offline-shake' : 'animate-login-scale-in'
        }`}
        style={{
          borderColor: `${accentColor}40`,
          boxShadow: `0 0 55px -10px ${accentColor}44, 0 25px 45px -15px rgba(0,0,0,0.85)`
        }}
      >
        {/* Subtle top edge neon glow accent */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-[1.5px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`
          }}
        />

        {/* Floating "No Signal" / Network Icon at top showing failed connection */}
        <div className="animate-float-no-signal mb-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-950/80 border border-red-500/50 text-red-300 text-xs font-bold tracking-wider uppercase shadow-[0_0_20px_rgba(239,68,68,0.35)] backdrop-blur-md">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <WifiOff className="w-4 h-4 text-red-400" />
            <span>NO SIGNAL</span>
          </div>
        </div>

        {/* Central Animated Illustration: Cool Character/Bot actively moving phone up & down searching for a signal */}
        <div className="relative w-52 h-52 my-1 flex items-center justify-center">
          {/* Glowing aura behind bot */}
          <div
            className="absolute w-40 h-40 rounded-full blur-2xl opacity-40 animate-pulse pointer-events-none"
            style={{ backgroundColor: accentColor }}
          />

          {/* SVG Character/Bot */}
          <svg
            className="w-full h-full drop-shadow-[0_10px_25px_rgba(239,68,68,0.4)]"
            viewBox="0 0 240 240"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="botMetalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2e3547" />
                <stop offset="50%" stopColor="#1a1d28" />
                <stop offset="100%" stopColor="#0e1017" />
              </linearGradient>

              <linearGradient id="neonRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ff4d6d" />
                <stop offset="50%" stopColor="#ef4444" />
                <stop offset="100%" stopColor="#b91c1c" />
              </linearGradient>

              <linearGradient id="phoneScreenGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#3b0d14" />
                <stop offset="100%" stopColor="#150407" />
              </linearGradient>

              <filter id="neonGlowRed" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Base Body & Head Group with subtle breathing float */}
            <g className="animate-bot-float">
              {/* Shadow beneath bot */}
              <ellipse cx="110" cy="216" rx="55" ry="9" fill="#000000" opacity="0.65" />

              {/* Left Foot & Leg */}
              <rect x="85" y="185" width="18" height="25" rx="7" fill="url(#botMetalGrad)" stroke="#ef4444" strokeWidth="1.2" />
              <path d="M 80 206 L 105 206 L 105 212 Q 105 216 100 216 L 78 216 Q 74 216 76 211 Z" fill="#1e2230" stroke="#ef4444" strokeWidth="1" />

              {/* Right Foot & Leg */}
              <rect x="117" y="185" width="18" height="25" rx="7" fill="url(#botMetalGrad)" stroke="#ef4444" strokeWidth="1.2" />
              <path d="M 115 206 L 140 206 L 142 211 Q 144 216 140 216 L 118 216 Q 113 216 113 212 Z" fill="#1e2230" stroke="#ef4444" strokeWidth="1" />

              {/* Torso / Body Armor */}
              <rect x="76" y="125" width="68" height="64" rx="20" fill="url(#botMetalGrad)" stroke="#ef4444" strokeWidth="1.8" />
              
              {/* Chest Core Reactor with red neon pulse */}
              <circle cx="110" cy="155" r="14" fill="#120407" stroke="#ef4444" strokeWidth="2" />
              <circle cx="110" cy="155" r="8" fill="url(#neonRedGrad)" filter="url(#neonGlowRed)" className="animate-pulse" />
              <circle cx="110" cy="155" r="3" fill="#ffffff" />

              {/* Chest tech details / seams */}
              <line x1="88" y1="137" x2="132" y2="137" stroke="#ef4444" strokeWidth="1" strokeOpacity="0.4" />
              <line x1="88" y1="175" x2="132" y2="175" stroke="#ef4444" strokeWidth="1" strokeOpacity="0.4" />
              <circle cx="85" cy="155" r="2" fill="#ef4444" opacity="0.7" />
              <circle cx="135" cy="155" r="2" fill="#ef4444" opacity="0.7" />

              {/* Left Arm (Resting on side) */}
              <path
                d="M 76 135 C 55 145 52 165 58 185"
                stroke="#2e3547"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <path
                d="M 76 135 C 55 145 52 165 58 185"
                stroke="#ef4444"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <circle cx="58" cy="186" r="7" fill="#1e2230" stroke="#ef4444" strokeWidth="1.5" />

              {/* Neck */}
              <rect x="100" y="114" width="20" height="13" rx="4" fill="#1a1d28" stroke="#ef4444" strokeWidth="1.2" />

              {/* Head Dome & Antennas */}
              <rect x="58" y="78" width="6" height="18" rx="3" fill="#ef4444" />
              <circle cx="61" cy="74" r="3.5" fill="#ff4d6d" filter="url(#neonGlowRed)" />

              <rect x="156" y="78" width="6" height="18" rx="3" fill="#ef4444" />
              <circle cx="159" cy="74" r="3.5" fill="#ff4d6d" filter="url(#neonGlowRed)" />

              <rect x="62" y="60" width="96" height="60" rx="26" fill="url(#botMetalGrad)" stroke="#ef4444" strokeWidth="2" />
              <rect x="72" y="72" width="76" height="34" rx="14" fill="#08080f" stroke="#ef4444" strokeWidth="1.2" />

              {/* Visor Searching Eyes */}
              <ellipse cx="94" cy="89" rx="7" ry="8" fill="url(#neonRedGrad)" filter="url(#neonGlowRed)" />
              <ellipse cx="93" cy="88" rx="3" ry="3.5" fill="#ffffff" />
              <ellipse cx="126" cy="89" rx="7" ry="8" fill="url(#neonRedGrad)" filter="url(#neonGlowRed)" />
              <ellipse cx="125" cy="88" rx="3" ry="3.5" fill="#ffffff" />
              
              <line x1="87" y1="78" x2="101" y2="80" stroke="#ff4d6d" strokeWidth="2" strokeLinecap="round" />
              <line x1="133" y1="78" x2="119" y2="80" stroke="#ff4d6d" strokeWidth="2" strokeLinecap="round" />
            </g>

            {/* --- RIGHT ARM & SMARTPHONE ACTIVELY MOVING UP & DOWN SEARCHING FOR SIGNAL --- */}
            <g className="animate-phone-searching">
              {/* Upper Arm raised up towards upper right */}
              <path
                d="M 142 135 C 160 120 168 95 174 72"
                stroke="#2e3547"
                strokeWidth="12"
                strokeLinecap="round"
              />
              <path
                d="M 142 135 C 160 120 168 95 174 72"
                stroke="#ef4444"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />

              {/* Hand gripping the smartphone */}
              <circle cx="174" cy="72" r="8" fill="#1a1d28" stroke="#ef4444" strokeWidth="1.8" />
              <rect x="170" y="65" width="9" height="5" rx="2.5" fill="#ef4444" />
              <rect x="170" y="73" width="9" height="5" rx="2.5" fill="#ef4444" />

              {/* Smartphone Held Up High */}
              <g transform="rotate(16 175 60)">
                <rect
                  x="161"
                  y="35"
                  width="28"
                  height="48"
                  rx="6"
                  fill="#161822"
                  stroke="#ff4d6d"
                  strokeWidth="1.8"
                  filter="url(#neonGlowRed)"
                />
                <rect x="164" y="38" width="22" height="42" rx="4" fill="url(#phoneScreenGrad)" />
                <rect x="172" y="39.5" width="6" height="1.5" rx="0.75" fill="#ef4444" opacity="0.6" />

                {/* Strikethrough No-Signal Bar on Phone Screen */}
                <g transform="translate(175, 59)">
                  <rect x="-8" y="2" width="2" height="4" rx="0.5" fill="#ef4444" />
                  <rect x="-4" y="-1" width="2" height="7" rx="0.5" fill="#ef4444" opacity="0.5" />
                  <rect x="0" y="-4" width="2" height="10" rx="0.5" fill="#ef4444" opacity="0.25" />
                  <rect x="4" y="-7" width="2" height="13" rx="0.5" fill="#ef4444" opacity="0.15" />
                  <line x1="-9" y1="-8" x2="7" y2="8" stroke="#ff4d6d" strokeWidth="2" strokeLinecap="round" />
                </g>
                <rect x="170" y="76.5" width="10" height="1.5" rx="0.75" fill="#ef4444" opacity="0.7" />
              </g>

              {/* Radiating Search Waves from Phone Antenna */}
              <g filter="url(#neonGlowRed)">
                <path
                  d="M 160 42 A 22 22 0 0 1 190 42"
                  stroke="#ff4d6d"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="animate-signal-wave-1"
                />
                <path
                  d="M 152 33 A 33 33 0 0 1 198 33"
                  stroke="#ef4444"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="animate-signal-wave-2"
                />
                <path
                  d="M 144 24 A 45 45 0 0 1 206 24"
                  stroke="#dc2626"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="4 3"
                  className="animate-signal-wave-3"
                />
                <circle
                  cx="175"
                  cy="50"
                  r="3"
                  fill="#ffffff"
                  className="animate-ping opacity-90 origin-[175px_50px]"
                />
                <circle cx="175" cy="50" r="2.5" fill="#ff4d6d" />
              </g>
            </g>
          </svg>
        </div>

        {/* Heading Text: Exactly "No Internet Connection" */}
        <div className="space-y-2 mt-2 mb-6">
          <h2 className="text-xl sm:text-2xl font-black tracking-wider text-white uppercase drop-shadow-md">
            No Internet Connection
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-[280px] mx-auto leading-relaxed">
            Your device is currently offline. Please check your Wi-Fi or mobile data connection and try again.
          </p>

          <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800">
              <Radio className="w-3 h-3 text-red-400" />
              <span>Wi-Fi / Mobile Data</span>
            </span>
            <span className="text-zinc-600">•</span>
            <span className="text-red-400 font-medium">Disconnected</span>
          </div>
        </div>

        {/* Dynamic Toast / Status Alert Banner */}
        {notification && (
          <div
            className={`w-full mb-4 px-3.5 py-2.5 rounded-xl border text-xs font-medium flex items-center gap-2.5 text-left transition-all duration-300 ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                : 'bg-red-950/80 border-red-500/50 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.3)]'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            )}
            <span className="leading-tight flex-1">{notification.message}</span>
          </div>
        )}

        {/* Interactive Glowing "TRY AGAIN" Capsule Button */}
        <div className="w-full pt-1">
          <button
            type="button"
            onClick={handleTryAgain}
            disabled={isChecking}
            className={`w-full relative group overflow-hidden rounded-full py-3.5 px-6 font-bold text-sm tracking-wider uppercase text-white shadow-xl transition-all duration-300 cursor-pointer flex items-center justify-center gap-2.5 active:scale-95 ${
              isChecking
                ? 'opacity-85 pointer-events-none'
                : 'hover:brightness-110 hover:shadow-[0_0_40px_rgba(239,68,68,0.8)]'
            }`}
            style={{
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #991b1b 100%)',
              boxShadow: '0 0 32px -2px rgba(239, 68, 68, 0.7), 0 10px 24px -8px rgba(0,0,0,0.8)',
              border: '1px solid rgba(255, 255, 255, 0.3)'
            }}
          >
            {/* Button Inner Cyber Sheen */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />

            {isChecking ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                <span>CHECKING CONNECTION...</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-4 h-4 transition-transform group-hover:-rotate-90 duration-300 text-white" />
                <span>TRY AGAIN</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-4 text-[10px] text-zinc-500 tracking-wide">
          App automatically returns to normal when network is back
        </div>
      </div>
    </div>
  );
};
