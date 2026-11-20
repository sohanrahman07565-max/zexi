import React, { useEffect, useRef } from 'react';

export const DEFAULT_LOGO_URL = 'https://host.tscv.workers.dev/img/27e97803c2bf4c39';

interface SplashScreenProps {
  onComplete: () => void;
  logoSymbol?: string;
  logoUrl?: string;
  title?: string;
  accentColor?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onComplete,
}) => {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const timer = window.setTimeout(() => {
      onCompleteRef.current();
    }, 3550);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div id="zexi-splash-root" className="zexi-splash-root">
      <style>{`
        .zexi-splash-root {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: #07060f;
          color: #fff;
          font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          overflow: hidden;
          user-select: none;
          padding-top: env(safe-area-inset-top, 0px);
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }

        .zexi-splash-goo-svg {
          position: absolute;
          width: 0;
          height: 0;
          pointer-events: none;
        }

        .zexi-splash-liquid {
          position: fixed;
          inset: 0;
          filter: url(#zexi-splash-goo);
          z-index: 0;
          pointer-events: none;
        }

        .zexi-splash-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(2px);
          opacity: 0.75;
          animation: zexiSplashDrift 18s ease-in-out infinite alternate;
        }

        .zexi-splash-b1 {
          width: 46vmax;
          height: 46vmax;
          left: -14vmax;
          top: -10vmax;
          background: radial-gradient(circle, #b0204a, #4b0f2b 70%);
        }

        .zexi-splash-b2 {
          width: 40vmax;
          height: 40vmax;
          right: -12vmax;
          bottom: -8vmax;
          background: radial-gradient(circle, #5b2bd6, #1d1250 70%);
          animation-duration: 22s;
        }

        .zexi-splash-b3 {
          width: 26vmax;
          height: 26vmax;
          left: 35%;
          top: 55%;
          background: radial-gradient(circle, #0e7fd8, #0a2a5a 70%);
          animation-duration: 26s;
          opacity: 0.5;
        }

        .zexi-splash-b4 {
          width: 20vmax;
          height: 20vmax;
          right: 20%;
          top: 6%;
          background: radial-gradient(circle, #c026d3, #4a0a5a 70%);
          animation-duration: 20s;
          opacity: 0.5;
        }

        @keyframes zexiSplashDrift {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(8vmax, 6vmax) scale(1.18); }
          100% { transform: translate(-5vmax, 10vmax) scale(0.92); }
        }

        .zexi-splash-dots {
          position: fixed;
          inset: 0;
          z-index: 1;
          background-image: radial-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1.2px);
          background-size: 26px 26px;
          mask-image: radial-gradient(circle at 50% 50%, #000, transparent 80%);
          -webkit-mask-image: radial-gradient(circle at 50% 50%, #000, transparent 80%);
          pointer-events: none;
        }

        .zexi-splash-intro {
          position: fixed;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background:
            radial-gradient(ellipse at 25% 20%, rgba(176, 32, 74, 0.45), transparent 55%),
            radial-gradient(ellipse at 80% 85%, rgba(91, 43, 214, 0.45), transparent 55%),
            rgba(7, 6, 15, 0.85);
          animation: zexiSplashOut 0.65s ease 2.9s forwards;
        }

        @keyframes zexiSplashOut {
          to { opacity: 0; }
        }

        .zexi-splash-zwrap {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.04em;
          font-size: clamp(90px, 34vw, 190px);
          font-weight: 900;
          line-height: 1;
        }

        .zexi-splash-zl,
        .zexi-splash-zr {
          display: block;
          background: linear-gradient(100deg, #e879b9, #a78bfa, #60a5fa, #34d399, #e879b9);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }

        .zexi-splash-zl {
          animation:
            zexiSplashZin 1.4s cubic-bezier(0.2, 0.9, 0.25, 1) both,
            zexiSplashFlow 4s linear infinite,
            zexiSplashVanL 0.95s cubic-bezier(0.5, 0, 0.8, 0.4) 2.3s forwards;
        }

        .zexi-splash-zr {
          animation:
            zexiSplashZin 1.4s cubic-bezier(0.2, 0.9, 0.25, 1) 0.1s both,
            zexiSplashFlow 4s linear infinite,
            zexiSplashVanR 0.95s cubic-bezier(0.5, 0, 0.8, 0.4) 2.3s forwards;
        }

        @keyframes zexiSplashZin {
          from {
            opacity: 0;
            transform: scale(1.5);
            filter: blur(24px) drop-shadow(0 0 0 transparent);
          }
          to {
            opacity: 1;
            transform: scale(1);
            filter: blur(0) drop-shadow(0 0 22px rgba(168, 85, 247, 0.6));
          }
        }

        @keyframes zexiSplashFlow {
          to { background-position: -300% 0; }
        }

        @keyframes zexiSplashVanL {
          from {
            opacity: 1;
            transform: none;
            filter: blur(0) drop-shadow(0 0 22px rgba(168, 85, 247, 0.6));
          }
          to {
            opacity: 0;
            transform: translateX(-46vw) scale(0.4);
            filter: blur(16px) drop-shadow(0 0 34px rgba(168, 85, 247, 0.9));
          }
        }

        @keyframes zexiSplashVanR {
          from {
            opacity: 1;
            transform: none;
            filter: blur(0) drop-shadow(0 0 22px rgba(168, 85, 247, 0.6));
          }
          to {
            opacity: 0;
            transform: translateX(46vw) scale(0.4);
            filter: blur(16px) drop-shadow(0 0 34px rgba(168, 85, 247, 0.9));
          }
        }

        .zexi-splash-bar {
          position: absolute;
          left: 50%;
          bottom: 24%;
          width: min(150px, 46vw);
          height: 4px;
          transform: translateX(-50%);
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.1);
          overflow: hidden;
          animation: zexiSplashBarFade 0.4s ease 2.2s forwards;
        }

        .zexi-splash-bar i {
          display: block;
          height: 100%;
          width: 0;
          border-radius: 4px;
          background: linear-gradient(90deg, #e879b9, #60a5fa, #34d399);
          animation: zexiSplashFill 2.1s cubic-bezier(0.4, 0, 0.2, 1) 0.2s forwards;
        }

        @keyframes zexiSplashFill {
          to { width: 100%; }
        }

        @keyframes zexiSplashBarFade {
          to { opacity: 0; }
        }

        @media (max-height: 480px) {
          .zexi-splash-zwrap {
            font-size: clamp(64px, 24vh, 140px);
          }
          .zexi-splash-bar {
            bottom: 16%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .zexi-splash-root * {
            animation-duration: 0.01s !important;
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>

      <svg className="zexi-splash-goo-svg" width="0" height="0" aria-hidden="true">
        <defs>
          <filter id="zexi-splash-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="b" />
            <feColorMatrix
              in="b"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
            />
          </filter>
        </defs>
      </svg>

      <div className="zexi-splash-liquid" aria-hidden="true">
        <i className="zexi-splash-blob zexi-splash-b1" />
        <i className="zexi-splash-blob zexi-splash-b2" />
        <i className="zexi-splash-blob zexi-splash-b3" />
        <i className="zexi-splash-blob zexi-splash-b4" />
      </div>
      <div className="zexi-splash-dots" aria-hidden="true" />

      <div className="zexi-splash-intro" id="intro">
        <div className="zexi-splash-zwrap">
          <span className="zexi-splash-zl">Z</span>
          <span className="zexi-splash-zr">X</span>
        </div>
        <div className="zexi-splash-bar">
          <i />
        </div>
      </div>
    </div>
  );
};
