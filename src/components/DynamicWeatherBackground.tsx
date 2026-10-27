import React, { useEffect, useRef, useState, useMemo } from 'react';

interface DynamicWeatherBackgroundProps {
  forcedMode?: 'auto' | 'day' | 'night';
  showControls?: boolean;
}

export const DynamicWeatherBackground: React.FC<DynamicWeatherBackgroundProps> = ({
  forcedMode: initialForcedMode = 'auto',
  showControls: _showControls = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentHour, setCurrentHour] = useState<number>(() => new Date().getHours());
  const [modeOverride, setModeOverride] = useState<'auto' | 'day' | 'night'>(initialForcedMode);

  // Periodically update the real-time clock every 20 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentHour(now.getHours());
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  // Sync prop changes
  useEffect(() => {
    if (initialForcedMode) {
      setModeOverride(initialForcedMode);
    }
  }, [initialForcedMode]);

  // Determine whether it is day or night
  // Daylight hours: 6:00 AM to 6:59 PM (6 - 18)
  // Night hours: 7:00 PM to 5:59 AM
  const isDaytime = useMemo(() => {
    if (modeOverride === 'day') return true;
    if (modeOverride === 'night') return false;
    return currentHour >= 6 && currentHour < 19;
  }, [modeOverride, currentHour]);

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

    // ========================================================
    // ASSET DEFINITIONS
    // ========================================================

    // 1. Daytime Clouds (layered volumetric drifting clouds)
    const cloudCount = 7;
    const clouds = Array.from({ length: cloudCount }, (_, i) => ({
      x: (Math.random() * width),
      y: (Math.random() * (height * 0.38)) + 15,
      radiusX: Math.random() * 85 + 65,
      radiusY: Math.random() * 32 + 22,
      speed: (Math.random() * 0.22 + 0.10) * (i % 2 === 0 ? 1 : 1.25),
      opacity: Math.random() * 0.12 + 0.08,
      puffs: [
        { ox: -30, oy: 6, r: 28 },
        { ox: 0, oy: -10, r: 38 },
        { ox: 32, oy: 5, r: 30 },
        { ox: 50, oy: 10, r: 20 }
      ]
    }));

    // 2. Daytime Wind-Blown Drifting Leaves / Petals
    const leafCount = 16;
    const leaves = Array.from({ length: leafCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.random() * 0.8 + 0.4,
      vy: Math.random() * 0.35 + 0.15,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.04,
      size: Math.random() * 4 + 3,
      phase: Math.random() * Math.PI * 2,
      color: Math.random() > 0.4 ? 'rgba(74, 222, 128, ' : 'rgba(250, 204, 21, ' // green and golden leaves
    }));

    // 3. Daytime Gentle Rain Drops & Splashes (Passing Showers)
    const dropCount = 70;
    const raindrops = Array.from({ length: dropCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      len: Math.random() * 14 + 10,
      speed: Math.random() * 7 + 8,
      wind: Math.random() * 1.5 + 1.2,
      alpha: Math.random() * 0.25 + 0.15
    }));

    interface Ripple {
      x: number;
      y: number;
      radius: number;
      maxRadius: number;
      alpha: number;
    }
    const ripples: Ripple[] = [];

    // 4. Nighttime Stars
    const starCount = 85;
    const stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * (height * 0.78),
      radius: Math.random() * 1.5 + 0.4,
      baseAlpha: Math.random() * 0.65 + 0.25,
      twinkleSpeed: Math.random() * 0.035 + 0.015,
      phase: Math.random() * Math.PI * 2
    }));

    // Nighttime Shooting Star
    let shootingStar: {
      active: boolean;
      x: number;
      y: number;
      length: number;
      speed: number;
      angle: number;
      alpha: number;
      cooldown: number;
    } = {
      active: false,
      x: 0,
      y: 0,
      length: 80,
      speed: 14,
      angle: Math.PI / 4 + 0.2,
      alpha: 0,
      cooldown: 180
    };

    // 5. Nighttime Fireflies (Bioluminescent Orbs)
    const fireflyCount = 26;
    const fireflies = Array.from({ length: fireflyCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -Math.random() * 0.45 - 0.15, // gentle upward buoyancy
      radius: Math.random() * 2.0 + 1.0,
      glowRadius: Math.random() * 16 + 8,
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.04 + 0.02,
      color: Math.random() > 0.35 ? 'rgba(250, 204, 21, ' : 'rgba(52, 211, 153, ' // warm golden or soft emerald
    }));

    // Distant Thunder / Lightning Flash state
    let thunderFlashAlpha = 0;
    let nextThunderTick = 400 + Math.random() * 600;

    let tick = 0;

    // ========================================================
    // RENDER LOOP
    // ========================================================
    const render = () => {
      tick++;
      ctx.clearRect(0, 0, width, height);

      // --- Wind & Breeze Physics ---
      const breeze = Math.sin(tick * 0.018) * 0.6 + Math.cos(tick * 0.035) * 0.3;

      if (isDaytime) {
        // ====================================================
        // DAYTIME WEATHER: Realistic Daylight, Sunbeams,
        // Swaying Foliage, Passing Showers & Distant Thunder
        // ====================================================

        // Periodic Passing Shower Cycle:
        // ~1800 frames cycle (~30 seconds). Shower is active during frames 600-1200.
        const showerCyclePos = tick % 1800;
        let showerIntensity = 0;
        if (showerCyclePos > 500 && showerCyclePos < 1300) {
          if (showerCyclePos < 700) {
            showerIntensity = (showerCyclePos - 500) / 200; // ramp in
          } else if (showerCyclePos > 1100) {
            showerIntensity = (1300 - showerCyclePos) / 200; // ramp out
          } else {
            showerIntensity = 1.0;
          }
        }

        // Trigger occasional distant thunder/sheet lightning flash during shower
        if (showerIntensity > 0.4 && tick > nextThunderTick) {
          thunderFlashAlpha = 0.24; // soft flash
          nextThunderTick = tick + 450 + Math.random() * 650;
        }

        // Decay thunder flash
        if (thunderFlashAlpha > 0.01) {
          thunderFlashAlpha *= 0.88;
        } else {
          thunderFlashAlpha = 0;
        }

        // 1. Realistic Daylight Ambient Sky Illumination
        const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
        skyGrad.addColorStop(0, 'rgba(16, 36, 62, 0.90)'); // crisp daylight atmospheric blue
        skyGrad.addColorStop(0.35, 'rgba(14, 28, 48, 0.85)');
        skyGrad.addColorStop(0.70, 'rgba(9, 17, 28, 0.92)');
        skyGrad.addColorStop(1, 'rgba(6, 8, 14, 0.98)');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, width, height);

        // Distant Sheet Lightning / Thunder illumination over the sky
        if (thunderFlashAlpha > 0) {
          ctx.fillStyle = `rgba(224, 242, 254, ${thunderFlashAlpha})`;
          ctx.fillRect(0, 0, width, height * 0.65);
        }

        // 2. Radiant Sun & Coronal Glow at Top Right
        const sunX = width * 0.84;
        const sunY = height * 0.12;

        // Wide Atmosphere Solar Aura
        const sunAura = ctx.createRadialGradient(sunX, sunY, 15, sunX, sunY, width * 0.60);
        sunAura.addColorStop(0, 'rgba(254, 240, 138, 0.30)');
        sunAura.addColorStop(0.25, 'rgba(251, 191, 36, 0.14)');
        sunAura.addColorStop(0.60, 'rgba(56, 189, 248, 0.06)');
        sunAura.addColorStop(1, 'transparent');
        ctx.fillStyle = sunAura;
        ctx.fillRect(0, 0, width, height);

        // Sun Core Disk with soft corona
        const sunCore = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 45);
        sunCore.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        sunCore.addColorStop(0.3, 'rgba(254, 243, 199, 0.75)');
        sunCore.addColorStop(0.7, 'rgba(251, 191, 36, 0.35)');
        sunCore.addColorStop(1, 'transparent');
        ctx.fillStyle = sunCore;
        ctx.beginPath();
        ctx.arc(sunX, sunY, 45, 0, Math.PI * 2);
        ctx.fill();

        // 3. Subtle Moving Light Rays / Sunbeams (God Rays)
        const baseRayAngle = Math.PI / 4.2 + Math.sin(tick * 0.0035) * 0.08;
        ctx.save();
        ctx.translate(sunX, sunY);
        ctx.rotate(baseRayAngle);

        for (let i = 0; i < 5; i++) {
          const rayWidth = 65 + i * 35;
          const rayPulse = Math.sin(tick * 0.012 + i * 1.2);
          const rayAlpha = Math.max(0.015, (0.045 + rayPulse * 0.025) * (1 - showerIntensity * 0.4));
          const rayGrad = ctx.createLinearGradient(0, -rayWidth / 2, width * 0.95, rayWidth / 2);
          rayGrad.addColorStop(0, `rgba(254, 243, 199, ${rayAlpha * 1.6})`);
          rayGrad.addColorStop(0.35, `rgba(251, 191, 36, ${rayAlpha})`);
          rayGrad.addColorStop(0.75, `rgba(186, 230, 253, ${rayAlpha * 0.5})`);
          rayGrad.addColorStop(1, 'transparent');

          ctx.fillStyle = rayGrad;
          ctx.fillRect(0, -rayWidth / 2 + (i * 32), width * 1.3, rayWidth);
        }
        ctx.restore();

        // 4. Soft Volumetric Drifting Clouds
        for (const cloud of clouds) {
          cloud.x += cloud.speed;
          if (cloud.x - cloud.radiusX > width + 40) {
            cloud.x = -cloud.radiusX - 40;
            cloud.y = Math.random() * (height * 0.38) + 15;
          }

          const cloudAlpha = cloud.opacity * (1 + showerIntensity * 0.4);
          ctx.save();
          ctx.fillStyle = `rgba(255, 255, 255, ${cloudAlpha})`;
          ctx.beginPath();
          ctx.ellipse(cloud.x, cloud.y, cloud.radiusX, cloud.radiusY, 0, 0, Math.PI * 2);
          ctx.fill();

          // Cloud puffs for natural cumulus billows
          for (const puff of cloud.puffs) {
            ctx.beginPath();
            ctx.arc(cloud.x + puff.ox, cloud.y + puff.oy, puff.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // 5. Passing Rain Showers & Ground Ripples
        if (showerIntensity > 0.02) {
          ctx.save();
          ctx.strokeStyle = `rgba(186, 230, 253, ${0.45 * showerIntensity})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();

          for (const drop of raindrops) {
            drop.x += drop.wind;
            drop.y += drop.speed;

            if (drop.y > height) {
              // Add splash ripple at base
              if (Math.random() > 0.6 && ripples.length < 25) {
                ripples.push({
                  x: drop.x,
                  y: height - Math.random() * 20 - 5,
                  radius: 1,
                  maxRadius: Math.random() * 10 + 6,
                  alpha: 0.4 * showerIntensity
                });
              }
              drop.y = -10;
              drop.x = Math.random() * width;
            }

            ctx.moveTo(drop.x, drop.y);
            ctx.lineTo(drop.x - drop.wind * 2.2, drop.y + drop.len);
          }
          ctx.stroke();
          ctx.restore();

          // Render ripples
          for (let r = ripples.length - 1; r >= 0; r--) {
            const rip = ripples[r];
            rip.radius += 0.5;
            rip.alpha *= 0.93;

            ctx.save();
            ctx.strokeStyle = `rgba(186, 230, 253, ${rip.alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(rip.x, rip.y, rip.radius, rip.radius * 0.35, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            if (rip.alpha < 0.03 || rip.radius > rip.maxRadius) {
              ripples.splice(r, 1);
            }
          }
        }

        // 6. Swaying Natural Foliage / Trees (Soft Breeze Wind Effect)
        // Draw natural tree branches and foliage silhouettes along the lower borders
        drawNaturalFoliage(ctx, width, height, breeze, 'day');

        // 7. Drifting Wind-Blown Leaves / Petals
        for (const leaf of leaves) {
          leaf.x += leaf.vx + breeze * 0.4;
          leaf.y += leaf.vy + Math.sin(tick * 0.03 + leaf.phase) * 0.5;
          leaf.rot += leaf.rotSpeed;

          if (leaf.x > width + 20) {
            leaf.x = -20;
            leaf.y = Math.random() * height;
          }
          if (leaf.y > height + 20) {
            leaf.y = -10;
            leaf.x = Math.random() * width;
          }

          ctx.save();
          ctx.translate(leaf.x, leaf.y);
          ctx.rotate(leaf.rot);
          ctx.fillStyle = `${leaf.color}0.55)`;
          ctx.beginPath();
          ctx.ellipse(0, 0, leaf.size, leaf.size * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

      } else {
        // ====================================================
        // NIGHTTIME WEATHER: Glowing Moon, Sparkling Stars,
        // Floating Fireflies & Nocturnal Breeze Foliage
        // ====================================================

        // 1. Deep Midnight Cosmic Sky
        const nightSky = ctx.createLinearGradient(0, 0, 0, height);
        nightSky.addColorStop(0, 'rgba(7, 10, 24, 0.94)'); // deep midnight sapphire
        nightSky.addColorStop(0.45, 'rgba(6, 8, 18, 0.96)');
        nightSky.addColorStop(1, 'rgba(5, 6, 12, 0.99)');
        ctx.fillStyle = nightSky;
        ctx.fillRect(0, 0, width, height);

        // 2. Glowing Crescent Moon at Top Right
        const moonX = width * 0.84;
        const moonY = height * 0.12;

        // Lunar Atmospheric Radiance Halo
        const haloGrad = ctx.createRadialGradient(moonX, moonY, 15, moonX, moonY, 130);
        haloGrad.addColorStop(0, 'rgba(224, 231, 255, 0.22)');
        haloGrad.addColorStop(0.35, 'rgba(165, 180, 252, 0.08)');
        haloGrad.addColorStop(0.75, 'rgba(99, 102, 241, 0.03)');
        haloGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(moonX, moonY, 130, 0, Math.PI * 2);
        ctx.fill();

        // Moon Body (Silky Radiant Crescent Moon)
        ctx.save();
        ctx.shadowColor = 'rgba(224, 231, 255, 0.9)';
        ctx.shadowBlur = 22;
        ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
        ctx.beginPath();
        ctx.arc(moonX, moonY, 20, 0, Math.PI * 2);
        ctx.fill();

        // Destination-out to sculpt a delicate crescent
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(moonX + 10, moonY - 6, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 3. Soft Sparkling Stars
        for (const star of stars) {
          const alpha = star.baseAlpha + Math.sin(tick * star.twinkleSpeed + star.phase) * 0.3;
          const cleanAlpha = Math.max(0.12, Math.min(1, alpha));

          ctx.fillStyle = `rgba(255, 255, 255, ${cleanAlpha})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
          ctx.fill();

          // Subtle diamond sparkle on larger stars
          if (star.radius > 1.3 && cleanAlpha > 0.7) {
            ctx.strokeStyle = `rgba(224, 231, 255, ${cleanAlpha * 0.4})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(star.x - 3.5, star.y);
            ctx.lineTo(star.x + 3.5, star.y);
            ctx.moveTo(star.x, star.y - 3.5);
            ctx.lineTo(star.x, star.y + 3.5);
            ctx.stroke();
          }
        }

        // Occasional Shooting Star
        if (!shootingStar.active) {
          shootingStar.cooldown--;
          if (shootingStar.cooldown <= 0) {
            shootingStar.active = true;
            shootingStar.x = Math.random() * (width * 0.7);
            shootingStar.y = Math.random() * (height * 0.35);
            shootingStar.alpha = 1.0;
            shootingStar.cooldown = 240 + Math.random() * 300;
          }
        } else {
          shootingStar.x += Math.cos(shootingStar.angle) * shootingStar.speed;
          shootingStar.y += Math.sin(shootingStar.angle) * shootingStar.speed;
          shootingStar.alpha -= 0.025;

          ctx.save();
          const starGrad = ctx.createLinearGradient(
            shootingStar.x,
            shootingStar.y,
            shootingStar.x - Math.cos(shootingStar.angle) * shootingStar.length,
            shootingStar.y - Math.sin(shootingStar.angle) * shootingStar.length
          );
          starGrad.addColorStop(0, `rgba(255, 255, 255, ${shootingStar.alpha})`);
          starGrad.addColorStop(0.4, `rgba(186, 230, 253, ${shootingStar.alpha * 0.6})`);
          starGrad.addColorStop(1, 'transparent');

          ctx.strokeStyle = starGrad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(shootingStar.x, shootingStar.y);
          ctx.lineTo(
            shootingStar.x - Math.cos(shootingStar.angle) * shootingStar.length,
            shootingStar.y - Math.sin(shootingStar.angle) * shootingStar.length
          );
          ctx.stroke();
          ctx.restore();

          if (shootingStar.alpha <= 0) {
            shootingStar.active = false;
          }
        }

        // 4. Swaying Nocturnal Foliage Silhouettes
        drawNaturalFoliage(ctx, width, height, breeze, 'night');

        // 5. Gently Floating Fireflies / Light Orbs
        for (const ff of fireflies) {
          ff.x += ff.vx + Math.sin(tick * 0.02 + ff.phase) * 0.35;
          ff.y += ff.vy;

          // Wrap edges smoothly
          if (ff.y < -25) {
            ff.y = height + 10;
            ff.x = Math.random() * width;
          }
          if (ff.x < -25) ff.x = width + 15;
          if (ff.x > width + 25) ff.x = -15;

          const pulse = Math.sin(tick * ff.pulseSpeed + ff.phase);
          const alpha = 0.40 + pulse * 0.32;

          // Outer glowing bioluminescent aura
          const ffGrad = ctx.createRadialGradient(ff.x, ff.y, 1, ff.x, ff.y, ff.glowRadius);
          ffGrad.addColorStop(0, `${ff.color}${alpha})`);
          ffGrad.addColorStop(0.35, `${ff.color}${alpha * 0.45})`);
          ffGrad.addColorStop(1, 'transparent');

          ctx.fillStyle = ffGrad;
          ctx.beginPath();
          ctx.arc(ff.x, ff.y, ff.glowRadius, 0, Math.PI * 2);
          ctx.fill();

          // Bright sparkling core
          ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.3)})`;
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

  // Helper function to render organic swaying foliage & trees at the bottom corners
  const drawNaturalFoliage = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    breeze: number,
    theme: 'day' | 'night'
  ) => {
    ctx.save();

    // Color tones for foliage
    const branchColor = theme === 'day' ? 'rgba(15, 23, 42, 0.75)' : 'rgba(10, 14, 26, 0.85)';
    const leafColor1 = theme === 'day' ? 'rgba(22, 101, 52, 0.35)' : 'rgba(15, 23, 42, 0.45)';
    const leafColor2 = theme === 'day' ? 'rgba(34, 197, 94, 0.22)' : 'rgba(30, 41, 59, 0.35)';

    // --- Left Lower Foliage & Swaying Branch ---
    const leftBranchSway = breeze * 12;
    ctx.save();
    ctx.translate(0, height);
    ctx.rotate((leftBranchSway * Math.PI) / 180);

    // Main curved trunk/branch
    ctx.strokeStyle = branchColor;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.quadraticCurveTo(45, -70, 75, -140);
    ctx.quadraticCurveTo(90, -180, 130, -210);
    ctx.stroke();

    // Offshoot branches
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(60, -100);
    ctx.quadraticCurveTo(110, -115, 145, -105);
    ctx.moveTo(85, -160);
    ctx.quadraticCurveTo(130, -165, 160, -150);
    ctx.stroke();

    // Leaf cluster masses
    const clustersLeft = [
      { x: 130, y: -210, r: 35 },
      { x: 145, y: -105, r: 28 },
      { x: 160, y: -150, r: 32 },
      { x: 105, y: -175, r: 30 }
    ];

    for (const c of clustersLeft) {
      ctx.fillStyle = leafColor1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = leafColor2;
      ctx.beginPath();
      ctx.arc(c.x + 6, c.y - 4, c.r * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // --- Right Lower Foliage Canopy ---
    const rightBranchSway = -breeze * 10;
    ctx.save();
    ctx.translate(width, height);
    ctx.rotate((rightBranchSway * Math.PI) / 180);

    ctx.strokeStyle = branchColor;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.quadraticCurveTo(-50, -60, -80, -125);
    ctx.quadraticCurveTo(-100, -160, -140, -185);
    ctx.stroke();

    const clustersRight = [
      { x: -140, y: -185, r: 36 },
      { x: -80, y: -125, r: 30 },
      { x: -110, y: -145, r: 26 }
    ];

    for (const c of clustersRight) {
      ctx.fillStyle = leafColor1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = leafColor2;
      ctx.beginPath();
      ctx.arc(c.x - 5, c.y - 3, c.r * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* Background Gradient Base */}
      <div
        className={`absolute inset-0 transition-colors duration-1000 ${
          isDaytime
            ? 'bg-gradient-to-b from-[#10243c]/85 via-[#0c1828]/92 to-[#06080e]'
            : 'bg-gradient-to-b from-[#070b1a]/95 via-[#060712]/98 to-[#05060a]'
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
