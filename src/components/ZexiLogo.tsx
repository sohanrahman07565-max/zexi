import React from 'react';

interface ZexiLogoProps {
  className?: string;
  size?: number | string;
  style?: React.CSSProperties;
}

export const ZexiLogo: React.FC<ZexiLogoProps> = ({ className = 'w-full h-full', style }) => {
  return (
    <svg
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      <defs>
        {/* Background Radial Gradient */}
        <radialGradient id="zexiBg" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#2a0814" />
          <stop offset="60%" stopColor="#120409" />
          <stop offset="100%" stopColor="#060205" />
        </radialGradient>

        {/* Outer Neon Red Ring Gradient */}
        <linearGradient id="neonRedRing" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff3b5c" />
          <stop offset="50%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>

        {/* Imperial Gold Crown Gradient */}
        <linearGradient id="goldCrown" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="25%" stopColor="#ffd700" />
          <stop offset="60%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>

        {/* Gold Trim & Laurel Gradient */}
        <linearGradient id="goldTrim" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#d97706" />
          <stop offset="50%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#ca8a04" />
        </linearGradient>

        {/* Ruby Gem Gradient */}
        <radialGradient id="rubyGlow" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ff4d6d" />
          <stop offset="70%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#7f1d1d" />
        </radialGradient>

        {/* Soft Shadow Filter */}
        <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        {/* Red Outer Flare Filter */}
        <filter id="redGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* 1. Base Outer Glow Ring */}
      <circle cx="120" cy="120" r="114" fill="none" stroke="#ef4444" strokeWidth="2.5" opacity="0.35" filter="url(#redGlow)" />

      {/* 2. Outer Neon Red Cyber Rim with Ticks */}
      <circle cx="120" cy="120" r="110" fill="url(#zexiBg)" stroke="url(#neonRedRing)" strokeWidth="4.5" />
      
      {/* Decorative Outer Bevel Ring */}
      <circle cx="120" cy="120" r="102" fill="none" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="3 4" opacity="0.75" />

      {/* Inner Accent Ring */}
      <circle cx="120" cy="120" r="96" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

      {/* 3. Laurel Wreath / Golden Wings Garland (Flanking Left & Right) */}
      <g opacity="0.85" filter="url(#softGlow)">
        {/* Left Laurel Leaves */}
        <path d="M 44 140 C 40 110, 48 85, 70 65" fill="none" stroke="url(#goldTrim)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M 50 128 C 42 124, 38 116, 45 110" fill="url(#goldTrim)" />
        <path d="M 48 108 C 40 102, 38 94, 47 88" fill="url(#goldTrim)" />
        <path d="M 54 90 C 48 82, 48 74, 57 70" fill="url(#goldTrim)" />
        <path d="M 64 74 C 60 66, 62 58, 72 58" fill="url(#goldTrim)" />

        {/* Right Laurel Leaves */}
        <path d="M 196 140 C 200 110, 192 85, 170 65" fill="none" stroke="url(#goldTrim)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M 190 128 C 198 124, 202 116, 195 110" fill="url(#goldTrim)" />
        <path d="M 192 108 C 200 102, 202 94, 193 88" fill="url(#goldTrim)" />
        <path d="M 186 90 C 192 82, 192 74, 183 70" fill="url(#goldTrim)" />
        <path d="M 176 74 C 180 66, 178 58, 168 58" fill="url(#goldTrim)" />
      </g>

      {/* 4. Central Imperial Gold Crown (Royal Crest) */}
      <g filter="url(#softGlow)">
        {/* Crown Base Band */}
        <path
          d="M 72 108 C 90 112, 150 112, 168 108 L 165 117 C 145 121, 95 121, 75 117 Z"
          fill="url(#goldCrown)"
          stroke="#78350f"
          strokeWidth="0.8"
        />

        {/* Crown Spikes: 5 Royal Points */}
        <path
          d="M 72 108 
             L 70 82 
             L 92 97 
             L 120 62 
             L 148 97 
             L 170 82 
             L 168 108 
             C 150 112, 90 112, 72 108 Z"
          fill="url(#goldCrown)"
          stroke="#78350f"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* Crown Jewels (Pearls / Diamonds on Tips) */}
        <circle cx="70" cy="81" r="3.2" fill="#ffffff" stroke="#d97706" strokeWidth="1" />
        <circle cx="92" cy="96" r="3" fill="#ffffff" stroke="#d97706" strokeWidth="1" />
        <circle cx="120" cy="61" r="4.8" fill="#ffffff" stroke="#d97706" strokeWidth="1.2" />
        <circle cx="148" cy="96" r="3" fill="#ffffff" stroke="#d97706" strokeWidth="1" />
        <circle cx="170" cy="81" r="3.2" fill="#ffffff" stroke="#d97706" strokeWidth="1" />

        {/* Central Crown Ruby Gem */}
        <polygon points="120,78 126,87 120,96 114,87" fill="url(#rubyGlow)" stroke="#ffd700" strokeWidth="1" />
        <circle cx="94" cy="103" r="2.8" fill="url(#rubyGlow)" stroke="#ffd700" strokeWidth="0.8" />
        <circle cx="146" cy="103" r="2.8" fill="url(#rubyGlow)" stroke="#ffd700" strokeWidth="0.8" />
      </g>

      {/* 5. Central Branding Banner / Plaque */}
      {/* Curved Divider Line */}
      <path d="M 52 144 Q 120 150 188 144" stroke="url(#neonRedRing)" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />

      {/* "ZEXI" Bold Hero Typography */}
      <text
        x="120"
        y="142"
        textAnchor="middle"
        fontFamily="'Montserrat', 'Arial Black', sans-serif"
        fontWeight="900"
        fontSize="31"
        letterSpacing="4"
        fill="url(#goldCrown)"
        stroke="#451a03"
        strokeWidth="1.2"
        style={{ filter: 'drop-shadow(0px 2px 6px rgba(0,0,0,0.9)) drop-shadow(0 0 10px rgba(245,158,11,0.5))' }}
      >
        ZEXI
      </text>

      {/* "TOOLS" Sub-Banner Typography */}
      <rect x="76" y="152" width="88" height="20" rx="10" fill="#0c0408" stroke="#ef4444" strokeWidth="1.5" />
      <text
        x="120"
        y="166"
        textAnchor="middle"
        fontFamily="'Segoe UI', Roboto, sans-serif"
        fontWeight="800"
        fontSize="12.5"
        letterSpacing="4.5"
        fill="#f8fafc"
        style={{ filter: 'drop-shadow(0 0 6px #ef4444)' }}
      >
        TOOLS
      </text>

      {/* 6. Bottom Star / Emblem Accent */}
      <g transform="translate(120, 190) scale(0.9)">
        <polygon points="0,-7 2,-2 7,0 2,2 0,7 -2,2 -7,0 -2,-2" fill="url(#goldCrown)" />
        <circle cx="-18" cy="0" r="1.8" fill="#f59e0b" opacity="0.8" />
        <circle cx="18" cy="0" r="1.8" fill="#f59e0b" opacity="0.8" />
      </g>

      {/* Subtle Specular Highlights */}
      <path
        d="M 60 70 A 90 90 0 0 1 180 70"
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="40 100"
      />
    </svg>
  );
};
