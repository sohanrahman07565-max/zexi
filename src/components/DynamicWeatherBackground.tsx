import React, { useEffect, useRef, useState, useMemo } from 'react';

interface DynamicWeatherBackgroundProps {
  forcedMode?: 'auto' | 'day' | 'night';
}

export const DynamicWeatherBackground: React.FC<DynamicWeatherBackgroundProps> = ({
  forcedMode = 'auto'
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentHour, setCurrentHour] = useState<number>(() => new Date().getHours());

  // Periodically update the hour every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentHour(new Date().getHours());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Determine whether it is day or night
  // Daylight hours: 6:00 AM to 6:59 PM (6 - 18)
  // Night hours: 7:00 PM to 5:59 AM
  const isDaytime = useMemo(() => {
    if (forcedMode === 'day') return true;
    if (forcedMode === 'night') return false;
    return currentHour >= 6 && currentHour < 19;
  }, [forcedMode, currentHour]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize, { passive: true });

    // --- DAYTIME ASSETS: Soft drifting clouds & warm light beams ---
    const cloudCount = 6;
    const clouds = Array.from({ length: cloudCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * (height * 0.45),
      radiusX: Math.random() * 90 + 70,
      radiusY: Math.random() * 35 + 25,
      speed: Math.random() * 0.25 + 0.12,
      opacity: Math.random() * 0.08 + 0.04
    }));

    // --- NIGHTTIME ASSETS: Twinkling stars & floating fireflies ---
    const starCount = 55;
    const stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * (height * 0.75),
      radius: Math.random() * 1.5 + 0.4,
      baseAlpha: Math.random() * 0.6 + 0.25,
      twinkleSpeed: Math.random() * 0.03 + 0.015,
      phase: Math.random() * Math.PI * 2
    }));

    const fireflyCount = 24;
    const fireflies = Array.from({ length: fireflyCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: -Math.random() * 0.45 - 0.15, // gently drift upwards
      radius: Math.random() * 2.2 + 1.0,
      glowRadius: Math.random() * 14 + 8,
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.04 + 0.02,
      color: Math.random() > 0.4 ? 'rgba(250, 204, 21, ' : 'rgba(239, 68, 68, ' // warm golden or soft ruby fireflies
    }));

    let tick = 0;

    const render = () => {
      tick++;
      ctx.clearRect(0, 0, width, height);

      if (isDaytime) {
        // ==========================================
        // DAYTIME: Soft Moving Light Rays & Clouds
        // ==========================================

        // 1. Warm Sun Aura at top right
        const sunX = width * 0.82;
        const sunY = height * 0.12;
        const sunGradient = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, width * 0.55);
        sunGradient.addColorStop(0, 'rgba(251, 191, 36, 0.18)');
        sunGradient.addColorStop(0.3, 'rgba(245, 158, 11, 0.08)');
        sunGradient.addColorStop(0.7, 'rgba(239, 68, 68, 0.03)');
        sunGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = sunGradient;
        ctx.fillRect(0, 0, width, height);

        // 2. Soft Moving Light Beams
        const rayAngle = Math.PI / 4 + Math.sin(tick * 0.005) * 0.08;
        ctx.save();
        ctx.translate(sunX, sunY);
        ctx.rotate(rayAngle);
        for (let i = 0; i < 4; i++) {
          const rayWidth = 80 + i * 40;
          const rayAlpha = (0.03 + Math.sin(tick * 0.015 + i) * 0.015);
          const rayGrad = ctx.createLinearGradient(0, -rayWidth / 2, width * 0.9, rayWidth / 2);
          rayGrad.addColorStop(0, `rgba(254, 243, 199, ${rayAlpha * 1.5})`);
          rayGrad.addColorStop(0.5, `rgba(251, 191, 36, ${rayAlpha * 0.8})`);
          rayGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = rayGrad;
          ctx.fillRect(0, -rayWidth / 2 + (i * 35), width * 1.2, rayWidth);
        }
        ctx.restore();

        // 3. Drifting Translucent Clouds
        for (const cloud of clouds) {
          cloud.x += cloud.speed;
          if (cloud.x - cloud.radiusX > width) {
            cloud.x = -cloud.radiusX;
            cloud.y = Math.random() * (height * 0.45);
          }

          const cloudGrad = ctx.createRadialGradient(
            cloud.x,
            cloud.y,
            cloud.radiusY * 0.2,
            cloud.x,
            cloud.y,
            cloud.radiusX
          );
          cloudGrad.addColorStop(0, `rgba(255, 255, 255, ${cloud.opacity * 1.4})`);
          cloudGrad.addColorStop(0.5, `rgba(254, 240, 138, ${cloud.opacity * 0.8})`);
          cloudGrad.addColorStop(1, 'transparent');

          ctx.fillStyle = cloudGrad;
          ctx.beginPath();
          ctx.ellipse(cloud.x, cloud.y, cloud.radiusX, cloud.radiusY, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // ==========================================
        // NIGHTTIME: Glowing Moon, Stars & Fireflies
        // ==========================================

        // 1. Glowing Crescent Moon at top right
        const moonX = width * 0.82;
        const moonY = height * 0.12;

        // Lunar Atmosphere Halo
        const haloGrad = ctx.createRadialGradient(moonX, moonY, 15, moonX, moonY, 120);
        haloGrad.addColorStop(0, 'rgba(224, 231, 255, 0.14)');
        haloGrad.addColorStop(0.4, 'rgba(199, 210, 254, 0.05)');
        haloGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(moonX, moonY, 120, 0, Math.PI * 2);
        ctx.fill();

        // Moon Body (Silky Crescent Moon)
        ctx.save();
        ctx.shadowColor = 'rgba(224, 231, 255, 0.85)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
        ctx.beginPath();
        ctx.arc(moonX, moonY, 18, 0, Math.PI * 2);
        ctx.fill();

        // Subtract for crescent shape
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(moonX + 9, moonY - 5, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 2. Twinkling Stars
        for (const star of stars) {
          const alpha = star.baseAlpha + Math.sin(tick * star.twinkleSpeed + star.phase) * 0.25;
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0.1, Math.min(1, alpha))})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        // 3. Floating Fireflies / Light Orbs
        for (const ff of fireflies) {
          ff.x += ff.vx + Math.sin(tick * 0.02 + ff.phase) * 0.3;
          ff.y += ff.vy;

          // Wrap around screen edges smoothly
          if (ff.y < -20) {
            ff.y = height + 10;
            ff.x = Math.random() * width;
          }
          if (ff.x < -20) ff.x = width + 10;
          if (ff.x > width + 20) ff.x = -10;

          const pulse = Math.sin(tick * ff.pulseSpeed + ff.phase);
          const alpha = 0.35 + pulse * 0.3;

          // Outer glowing aura
          const ffGrad = ctx.createRadialGradient(ff.x, ff.y, 1, ff.x, ff.y, ff.glowRadius);
          ffGrad.addColorStop(0, `${ff.color}${alpha})`);
          ffGrad.addColorStop(0.4, `${ff.color}${alpha * 0.4})`);
          ffGrad.addColorStop(1, 'transparent');

          ctx.fillStyle = ffGrad;
          ctx.beginPath();
          ctx.arc(ff.x, ff.y, ff.glowRadius, 0, Math.PI * 2);
          ctx.fill();

          // Core bright spark
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 1.2})`;
          ctx.beginPath();
          ctx.arc(ff.x, ff.y, ff.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isDaytime]);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* Background Gradient Base: changes softly based on real-time clock */}
      <div
        className={`absolute inset-0 transition-colors duration-1000 ${
          isDaytime
            ? 'bg-gradient-to-b from-[#0c1626]/80 via-[#0a0f18]/90 to-[#060608]'
            : 'bg-gradient-to-b from-[#070913]/90 via-[#06070e]/95 to-[#060608]'
        }`}
      />

      {/* Real-time Dynamic Weather Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ willChange: 'transform' }}
      />
    </div>
  );
};
