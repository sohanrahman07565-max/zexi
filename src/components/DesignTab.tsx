import React, { useState, useEffect } from 'react';
import { DesignConfig, api } from '../lib/api';
import { toast } from '../lib/toast';
import { Palette, Check } from 'lucide-react';

interface DesignTabProps {
  currentDesign: DesignConfig;
  onUpdate: (design: DesignConfig) => void;
}

const LIQUID_SWATCHES = [
  { hex: '#7c9cff', label: 'Aurora Indigo' },
  { hex: '#c084fc', label: 'Prism Violet' },
  { hex: '#34d3ee', label: 'Glacier Cyan' },
  { hex: '#f472b6', label: 'Nebula Pink' },
  { hex: '#34d399', label: 'Emerald Mint' },
  { hex: '#fbbf24', label: 'Solar Amber' },
];

export const DesignTab: React.FC<DesignTabProps> = ({ currentDesign, onUpdate }) => {
  const resolveAccent = (raw?: string) =>
    !raw || raw.toLowerCase() === '#ef4444' ? '#7c9cff' : raw;

  const [design, setDesign] = useState<DesignConfig>({
    ...currentDesign,
    primaryColor: resolveAccent(currentDesign.primaryColor),
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDesign({
      ...currentDesign,
      primaryColor: resolveAccent(currentDesign.primaryColor),
    });
  }, [currentDesign]);

  const applyPrimaryAccent = (hex: string) => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--a', hex);
    }
    const nextDesign = { ...design, primaryColor: hex };
    setDesign(nextDesign);
    onUpdate(nextDesign);
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      const res = await api.updateDesign(design);
      onUpdate(res.design);
      setSuccess(true);
      toast.success('Accent theme saved!');
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save design');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-28 md:pb-8 md:max-w-3xl">
      {/* Header & Save Action */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 shrink-0" style={{ color: 'var(--a)' }} /> Accent Color
          </h2>
          <p className="text-[11px] text-white/60">Customize Aurora orbs, rings &amp; glass glow</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="tap py-2 px-3.5 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 border border-white/25 cursor-pointer shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--a), var(--a2))',
            boxShadow: '0 8px 20px -4px color-mix(in srgb, var(--a) 55%, transparent)',
          }}
        >
          {saving ? (
            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : success ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Saved!</span>
            </>
          ) : (
            <span>Save Theme</span>
          )}
        </button>
      </div>

      {/* Liquid Glass Accent Colour Swatches */}
      <div
        className="glass lg-rise rounded-[24px] p-4 space-y-3"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-extrabold text-white">Liquid Glass Accent Colour</div>
            <div className="text-[11px] text-white/60">
              Updates the live Aurora orbs, rings &amp; glass highlights instantly
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="color"
              value={design.primaryColor || '#7c9cff'}
              onChange={(e) => applyPrimaryAccent(e.target.value)}
              className="w-7 h-7 rounded-lg border border-white/25 bg-transparent cursor-pointer p-0"
              title="Custom Accent Colour"
            />
            <span className="text-[10px] font-mono text-white/75">{design.primaryColor}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 pt-1">
          {LIQUID_SWATCHES.map((sw) => {
            const isActive = (design.primaryColor || '#7c9cff').toLowerCase() === sw.hex.toLowerCase();
            return (
              <button
                key={sw.hex}
                type="button"
                title={sw.label}
                aria-label={sw.label}
                onClick={() => applyPrimaryAccent(sw.hex)}
                className={`lg-col ${isActive ? 'on' : ''}`}
                style={{
                  background: sw.hex,
                  '--c': sw.hex,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
