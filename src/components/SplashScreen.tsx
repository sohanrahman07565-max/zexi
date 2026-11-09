import React, { useState, useEffect, useRef } from 'react';

export const DEFAULT_LOGO_URL = 'https://host.tscv.workers.dev/img/df6c9e167caf42c6';

interface SplashScreenProps {
  onComplete: () => void;
  logoSymbol?: string;
  logoUrl?: string;
  title?: string;
  accentColor?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onComplete,
  title = 'Zexi Official',
}) => {
  const [progress, setProgress] = useState(0);
  const [isHiding, setIsHiding] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const startedRef = useRef(false);

  // Dynamic branding text (defaults to Zexi Official)
  const displayBrand = !title || title === 'ADMIN PANEL' ? 'Zexi Official' : title;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const duration = 3200; // 3.2 seconds smooth progress animation
    const startTime = performance.now();
    let animationFrameId: number;
    let isFinished = false;

    const animate = (now: number) => {
      if (isFinished) return;

      const elapsed = now - startTime;
      // Progress moves smoothly up to 95%
      let currentProgress = Math.min(95, (elapsed / duration) * 95);

      // Finish to 100% when elapsed exceeds duration
      if (elapsed >= duration) {
        currentProgress = 100;
      }

      const value = Math.floor(currentProgress);
      setProgress(value);

      if (value >= 100) {
        isFinished = true;
        // Small final hold matching user script (350ms)
        setTimeout(() => {
          setIsHiding(true);
          // Complete transition and unmount after 1.1s
          setTimeout(() => {
            onCompleteRef.current();
          }, 1100);
        }, 350);
        return;
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div id="zexi-splash-root">
      <style>{`
        #loader {
          position: fixed;
          inset: 0;
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(ellipse at 50% 45%, #252044 0%, #101020 42%, #080811 85%);
          transition:
            opacity 1.1s cubic-bezier(.7,0,.2,1),
            transform 1.3s cubic-bezier(.7,0,.2,1),
            visibility 1.1s;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          overflow: hidden;
          user-select: none;
        }

        #loader.hide {
          opacity: 0;
          visibility: hidden;
          transform: scale(1.07);
          pointer-events: none;
        }

        /* BACKGROUND LIGHT */
        .splash-light {
          position: absolute;
          width: 280px;
          height: 280px;
          border-radius: 50%;
          filter: blur(110px);
          opacity: .22;
          animation: lightMove 8s ease-in-out infinite alternate;
          pointer-events: none;
        }

        .splash-light.one {
          background: #7654ff;
          top: 5%;
          left: -120px;
        }

        .splash-light.two {
          background: #e44b9d;
          right: -130px;
          bottom: 5%;
          animation-delay: -4s;
        }

        @keyframes lightMove {
          to {
            transform: translate(70px, -40px) scale(1.3);
          }
        }

        /* SUBTLE BACKGROUND GRID */
        .splash-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(#ffffff08 1px, transparent 1px),
            linear-gradient(90deg, #ffffff08 1px, transparent 1px);
          background-size: 65px 65px;
          mask-image: radial-gradient(ellipse, black, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse, black, transparent 80%);
          pointer-events: none;
        }

        /* CENTER CONTENT */
        .splash-content {
          position: relative;
          z-index: 2;
          width: 88%;
          max-width: 500px;
          text-align: center;
        }

        /* TOP SMALL LIGHT */
        .splash-top-light {
          width: 35px;
          height: 2px;
          margin: 0 auto 35px;
          background: linear-gradient(90deg, transparent, #a58cff, transparent);
          box-shadow: 0 0 18px #a58cff;
          animation: lightPulse 2s infinite;
        }

        @keyframes lightPulse {
          50% {
            opacity: .3;
            width: 65px;
          }
        }

        /* WELCOME TEXT */
        .splash-welcome {
          color: #ffffff;
          font-size: clamp(27px, 7vw, 43px);
          font-weight: 700;
          letter-spacing: 1.5px;
          line-height: 1.35;
          opacity: 0;
          transform: translateY(22px);
          animation: textReveal 1.3s .3s forwards;
        }

        .splash-welcome span {
          display: block;
          background: linear-gradient(
            100deg,
            #ffffff 0%,
            #c6b5ff 25%,
            #ffffff 45%,
            #a68aff 65%,
            #ffffff 85%
          );
          background-size: 250% auto;
          background-clip: text;
          -webkit-background-clip: text;
          color: transparent;
          animation: shine 4s 1.5s linear infinite;
        }

        @keyframes shine {
          to {
            background-position: 250% center;
          }
        }

        @keyframes textReveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* UNDERLINE */
        .splash-underline {
          width: 0;
          height: 1px;
          margin: 24px auto 0;
          background: linear-gradient(
            90deg, transparent, #a78bff, #f1baff, transparent
          );
          box-shadow: 0 0 12px #a78bff;
          animation: lineGrow 1.2s 1s forwards;
        }

        @keyframes lineGrow {
          to {
            width: 75%;
          }
        }

        /* LOADING AREA */
        .splash-loading-area {
          margin-top: 70px;
          opacity: 0;
          transform: translateY(12px);
          animation: loadReveal 1s 1.1s forwards;
        }

        @keyframes loadReveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .splash-loading-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 13px;
        }

        .splash-loading-label {
          font-size: 9px;
          letter-spacing: 3px;
          color: #a5a1bb;
          font-weight: 600;
        }

        .splash-percent {
          font-size: 12px;
          font-weight: 600;
          color: #d5caff;
          font-variant-numeric: tabular-nums;
        }

        /* PROGRESS BAR TRACK & BAR */
        .splash-track {
          width: 100%;
          height: 3px;
          background: rgba(255, 255, 255, 0.09);
          border-radius: 20px;
          overflow: hidden;
        }

        .splash-bar {
          height: 100%;
          border-radius: 20px;
          background: linear-gradient(
            90deg, #7555ff, #b38bff, #f0c8ff
          );
          box-shadow: 0 0 15px #a78bff;
          transition: width .12s linear;
        }

        /* BOTTOM DECORATION */
        .splash-bottom-light {
          position: absolute;
          width: 100px;
          height: 1px;
          background: linear-gradient(
            90deg, transparent, #a78bff, transparent
          );
          bottom: 55px;
          left: 50%;
          transform: translateX(-50%);
          opacity: .5;
        }

        /* RESPONSIVE */
        @media(max-width: 480px) {
          .splash-loading-area {
            margin-top: 58px;
          }

          .splash-welcome {
            letter-spacing: .5px;
          }
        }
      `}</style>

      {/* LOADING SCREEN CONTAINER */}
      <div id="loader" className={isHiding ? 'hide' : ''}>
        <div className="splash-grid" />

        <div className="splash-light one" />
        <div className="splash-light two" />

        <div className="splash-content">
          <div className="splash-top-light" />

          <h1 className="splash-welcome">
            Welcome to
            <span>{displayBrand}</span>
          </h1>

          <div className="splash-underline" />

          <div className="splash-loading-area">
            <div className="splash-loading-info">
              <span className="splash-loading-label">LOADING</span>
              <span className="splash-percent">{progress}%</span>
            </div>

            <div className="splash-track">
              <div
                className="splash-bar"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="splash-bottom-light" />
      </div>
    </div>
  );
};
