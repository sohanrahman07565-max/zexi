import React, { useEffect, useRef } from 'react';

interface BackgroundEffectsProps {
  styleName: 'cyber-grid' | 'light-rain' | 'particles' | 'digital-space' | 'neon-waves' | 'floating-orbs' | 'aurora' | 'cyber-lines';
  speed: number;
  opacity: number;
  density: number;
  enabled: boolean;
  primaryColor?: string;
  accentColor?: string;
}

const BackgroundEffectsComponent: React.FC<BackgroundEffectsProps> = ({
  styleName,
  speed,
  opacity,
  density,
  enabled,
  primaryColor = '#ef4444',
  accentColor = '#dc2626',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Detect device performance capability dynamically
    const isBudgetDevice = (() => {
      if (typeof navigator === 'undefined') return false;
      const cores = navigator.hardwareConcurrency || 4;
      const memory = (navigator as any).deviceMemory || 4;
      return cores <= 4 || memory <= 4;
    })();

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize, { passive: true });

    // Adaptive particle count: scale down on budget devices to prevent lag
    const densityScale = isBudgetDevice ? 0.55 : 1.0;
    const count = Math.max(10, Math.floor(((density * densityScale) / 100) * 80));

    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 1.5 * speed,
      vy: (Math.random() - 0.5) * 1.5 * speed,
      radius: Math.random() * 2.2 + 0.8,
      color: Math.random() > 0.5 ? primaryColor : accentColor,
      length: Math.random() * 18 + 8,
      phase: Math.random() * Math.PI * 2,
    }));

    let gridOffset = 0;
    let waveTime = 0;
    let lastFrameTime = performance.now();
    // Budget devices: throttle to ~36fps, high-end: unthrottled 60-120fps
    const minFrameInterval = isBudgetDevice ? 28 : 0; // ms

    const render = (now: number) => {
      animId = requestAnimationFrame(render);

      const elapsed = now - lastFrameTime;
      if (minFrameInterval > 0 && elapsed < minFrameInterval) {
        return;
      }
      lastFrameTime = now - (elapsed % (minFrameInterval || 1));

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0.05, opacity));

      switch (styleName) {
        case 'light-rain': {
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = 1;
          for (const p of particles) {
            p.y += (4 + Math.random() * 3) * speed;
            if (p.y > height) {
              p.y = -p.length;
              p.x = Math.random() * width;
            }
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - 1, p.y + p.length);
            ctx.stroke();
          }
          break;
        }

        case 'cyber-grid': {
          gridOffset = (gridOffset + 0.6 * speed) % 40;
          ctx.strokeStyle = `${primaryColor}22`;
          ctx.lineWidth = 1;

          for (let x = 0; x < width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
          }
          for (let y = gridOffset; y < height; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }
          break;
        }

        case 'particles': {
          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx * speed;
            p.y += p.vy * speed;
            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();

            // Interconnecting lines - skip on budget devices for maximum performance
            if (!isBudgetDevice) {
              for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
                if (dist < 90) {
                  ctx.strokeStyle = `${primaryColor}14`;
                  ctx.beginPath();
                  ctx.moveTo(p.x, p.y);
                  ctx.lineTo(p2.x, p2.y);
                  ctx.stroke();
                }
              }
            }
          }
          break;
        }

        case 'digital-space': {
          for (const p of particles) {
            p.y += 0.8 * speed;
            if (p.y > height) p.y = 0;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.radius * 1.5, p.radius * 1.5);
          }
          break;
        }

        case 'neon-waves': {
          waveTime += 0.02 * speed;
          ctx.lineWidth = 2;
          const waveCount = isBudgetDevice ? 2 : 3;
          for (let w = 0; w < waveCount; w++) {
            ctx.strokeStyle = w === 0 ? primaryColor : accentColor;
            ctx.beginPath();
            const step = isBudgetDevice ? 24 : 15;
            for (let x = 0; x <= width; x += step) {
              const y =
                height * 0.5 +
                Math.sin(x * 0.005 + waveTime + w) * 60 +
                Math.cos(x * 0.002 - waveTime) * 30;
              if (x === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          break;
        }

        case 'floating-orbs': {
          const orbLimit = isBudgetDevice ? 6 : 12;
          for (const p of particles.slice(0, orbLimit)) {
            p.phase += 0.015 * speed;
            const ox = p.x + Math.sin(p.phase) * 40;
            const oy = p.y + Math.cos(p.phase) * 40;
            const grad = ctx.createRadialGradient(ox, oy, 2, ox, oy, 70);
            grad.addColorStop(0, `${p.color}35`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(ox, oy, 70, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }

        case 'aurora': {
          waveTime += 0.01 * speed;
          const grad = ctx.createLinearGradient(0, 0, width, height);
          grad.addColorStop(0, `${primaryColor}22`);
          grad.addColorStop(0.5, `${accentColor}18`);
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          const step = isBudgetDevice ? 32 : 20;
          for (let x = 0; x <= width; x += step) {
            const y = height * 0.3 + Math.sin(x * 0.003 + waveTime) * 80;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(width, 0);
          ctx.closePath();
          ctx.fill();
          break;
        }

        case 'cyber-lines': {
          gridOffset = (gridOffset + 1.2 * speed) % 50;
          ctx.strokeStyle = `${accentColor}20`;
          ctx.lineWidth = 1.5;
          const step = isBudgetDevice ? 70 : 50;
          for (let x = -height; x < width + height; x += step) {
            ctx.beginPath();
            ctx.moveTo(x + gridOffset, 0);
            ctx.lineTo(x + gridOffset + height, height);
            ctx.stroke();
          }
          break;
        }
      }

      ctx.restore();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(animId);
      } else {
        lastFrameTime = performance.now();
        animId = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });

    animId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelAnimationFrame(animId);
    };
  }, [styleName, speed, opacity, density, enabled, primaryColor, accentColor]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 transform-gpu"
      style={{ opacity, transform: 'translate3d(0, 0, 0)', contain: 'strict' }}
    />
  );
};

export const BackgroundEffects = React.memo(BackgroundEffectsComponent);
