import React, { useState } from 'react';
import { DesignConfig, api } from '../lib/api';
import { Palette, Sparkles, Check, Shield, Eye, Upload, Trash2, RotateCcw } from 'lucide-react';

interface DesignTabProps {
  currentDesign: DesignConfig;
  onUpdate: (design: DesignConfig) => void;
}

export const DesignTab: React.FC<DesignTabProps> = ({ currentDesign, onUpdate }) => {
  const [design, setDesign] = useState<DesignConfig>({
    ...currentDesign,
    loginTitle: currentDesign.loginTitle || 'ADMIN PANEL',
    loginSubtitle: currentDesign.loginSubtitle || 'SECURE ACCESS',
    loginLogoUrl: currentDesign.loginLogoUrl || '',
    loginLogoSymbol: currentDesign.loginLogoSymbol || '惡',
    loginIdLabel: currentDesign.loginIdLabel || 'USERNAME',
    loginIdPlaceholder: currentDesign.loginIdPlaceholder || 'Enter username',
    loginPassLabel: currentDesign.loginPassLabel || 'PASSWORD',
    loginPassPlaceholder: currentDesign.loginPassPlaceholder || 'Enter password',
    loginButtonText: currentDesign.loginButtonText || 'SIGN IN',
    loginAccentColor: currentDesign.loginAccentColor || '#ef4444'
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    try {
      const res = await api.updateDesign(design);
      onUpdate(res.design);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      alert(err.message || 'Failed to save design');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pb-28">
      {/* Top Title & Save Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-rose-500" /> App Branding &amp; Login Design
          </h2>
          <p className="text-xs text-zinc-400">Login appearance &amp; branding</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="py-2 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-blue-600/30 active:scale-95 transition-all cursor-pointer"
        >
          {saving ? (
            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : success ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Saved!</span>
            </>
          ) : (
            <span>Save Design</span>
          )}
        </button>
      </div>

      {/* Login Screen Full Customization & Branding */}
      <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-4">
        <div className="text-xs font-semibold text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-rose-500" />
            <span>Login Screen Customization</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setDesign(prev => ({
                ...prev,
                loginTitle: 'ADMIN PANEL',
                loginSubtitle: 'SECURE ACCESS',
                loginLogoUrl: '',
                loginLogoSymbol: '惡',
                loginIdLabel: 'USERNAME',
                loginIdPlaceholder: 'Enter username',
                loginPassLabel: 'PASSWORD',
                loginPassPlaceholder: 'Enter password',
                loginButtonText: 'SIGN IN',
                loginAccentColor: '#ef4444'
              }));
            }}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/60 flex items-center gap-1 cursor-pointer transition-colors"
            title="Reset login screen to dark red theme"
          >
            <RotateCcw className="w-3 h-3 text-rose-400" />
            <span>Reset to Default</span>
          </button>
        </div>
        <p className="text-[11px] text-zinc-400">
          Changes made here immediately apply to the Admin Panel login screen in real-time.
        </p>

        {/* Live Real-Time Mini Preview of Login Card */}
        <div className="p-4 rounded-2xl bg-[#060608] border border-zinc-800/90 relative overflow-hidden">
          <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <Eye className="w-3.5 h-3.5 text-rose-400" /> Live Card Preview
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-rose-400 font-mono">
              Live Sync
            </span>
          </div>

          <div 
            className="w-full max-w-[270px] mx-auto rounded-2xl p-5 bg-[#0d0d12] border transition-all relative overflow-hidden text-center"
            style={{
              borderColor: `${design.loginAccentColor || '#ef4444'}40`,
              boxShadow: `0 0 35px -8px ${design.loginAccentColor || '#ef4444'}44`
            }}
          >
            {/* Top Icon */}
            <div className="flex flex-col items-center mb-3">
              <div 
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-2 overflow-hidden shadow-md"
                style={{
                  background: `linear-gradient(135deg, ${design.loginAccentColor || '#ef4444'}, #991b1b)`,
                  boxShadow: `0 0 16px ${design.loginAccentColor || '#ef4444'}80, inset 0 1px 2px rgba(255,255,255,0.4)`
                }}
              >
                {design.loginLogoUrl ? (
                  <img src={design.loginLogoUrl} alt="Logo" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-black font-black text-xl leading-none">
                    {design.loginLogoSymbol || '惡'}
                  </span>
                )}
              </div>
              <div 
                className="text-base font-black tracking-wider uppercase font-mono"
                style={{
                  color: design.loginAccentColor || '#ef4444',
                  textShadow: `0 0 12px ${design.loginAccentColor || '#ef4444'}99`
                }}
              >
                {design.loginTitle || 'ADMIN PANEL'}
              </div>
              <div className="text-[8px] font-bold tracking-[0.25em] text-gray-400 uppercase mt-0.5">
                {design.loginSubtitle || 'SECURE ACCESS'}
              </div>
            </div>

            {/* Input 1 Preview */}
            <div className="space-y-2 text-left mb-3">
              <div>
                <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                  {design.loginIdLabel || 'ADMIN NAME'}
                </div>
                <div className="bg-[#15151c] border border-zinc-800 rounded-lg py-1.5 px-2.5 text-[11px] text-zinc-500 truncate">
                  {design.loginIdPlaceholder || 'Enter admin name'}
                </div>
              </div>
              <div>
                <div className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                  {design.loginPassLabel || 'PASSWORD'}
                </div>
                <div className="bg-[#15151c] border border-zinc-800 rounded-lg py-1.5 px-2.5 text-[11px] text-zinc-500 flex items-center justify-between">
                  <span className="truncate">{design.loginPassPlaceholder || 'Enter password'}</span>
                  <Eye className="w-3 h-3 text-zinc-600 shrink-0 ml-1" />
                </div>
              </div>
            </div>

            {/* Button Preview */}
            <div 
              className="w-full py-2 px-3 rounded-full text-black font-black uppercase tracking-wider text-[11px] text-center"
              style={{
                background: `linear-gradient(90deg, ${design.loginAccentColor || '#ef4444'}, #e11d48)`,
                boxShadow: `0 6px 18px ${design.loginAccentColor || '#ef4444'}77`
              }}
            >
              {design.loginButtonText || 'SIGN IN'}
            </div>
          </div>
        </div>

        {/* 1. Accent & Neon Glow Color Theme */}
        <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-rose-400" />
              <span>Login Screen Accent / Glow Color</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={design.loginAccentColor || '#ef4444'}
                onChange={(e) => setDesign({ ...design, loginAccentColor: e.target.value })}
                className="w-6 h-6 rounded-md border border-zinc-700 bg-transparent cursor-pointer p-0"
              />
              <span className="text-[10px] font-mono text-zinc-400">{design.loginAccentColor || '#ef4444'}</span>
            </div>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {[
              { label: 'Neon Red', hex: '#ef4444' },
              { label: 'Crimson', hex: '#dc2626' },
              { label: 'Cyber Cyan', hex: '#06b6d4' },
              { label: 'Violet', hex: '#8b5cf6' },
              { label: 'Emerald', hex: '#10b981' },
              { label: 'Gold Flame', hex: '#f59e0b' },
              { label: 'Rose Pink', hex: '#f43f5e' }
            ].map((col) => (
              <button
                key={col.hex}
                type="button"
                onClick={() => setDesign({ ...design, loginAccentColor: col.hex })}
                className={`py-1.5 px-2 rounded-lg text-[10px] font-medium border text-center transition-all cursor-pointer truncate ${
                  (design.loginAccentColor || '#ef4444').toLowerCase() === col.hex.toLowerCase()
                    ? 'border-white text-white shadow-sm ring-1 ring-white/50'
                    : 'border-zinc-800 text-zinc-400 hover:text-white'
                }`}
                style={{
                  backgroundColor: `${col.hex}22`,
                  borderColor: (design.loginAccentColor || '#ef4444').toLowerCase() === col.hex.toLowerCase() ? col.hex : undefined
                }}
              >
                {col.label}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Top Icon / Media URL */}
        <div className="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-rose-400" />
              <span>Top Icon &amp; Logo Media URL</span>
            </label>
            {design.loginLogoUrl && (
              <button
                type="button"
                onClick={() => setDesign({ ...design, loginLogoUrl: '' })}
                className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear Media</span>
              </button>
            )}
          </div>

          <div>
            <label className="block text-[10px] text-zinc-400 mb-1.5">
              Custom Photo / Media Link or Upload Image
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={design.loginLogoUrl || ''}
                onChange={(e) => setDesign({ ...design, loginLogoUrl: e.target.value })}
                placeholder="https://... (Direct Photo/Media link or Telegram File ID)"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
              />
              <label className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-rose-400 border border-zinc-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      alert('Image size must be under 2MB.');
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (loadEvent) => {
                      const result = loadEvent.target?.result as string;
                      if (result) {
                        setDesign({ ...design, loginLogoUrl: result });
                      }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1.5">
              Enter a direct image URL or upload any photo to display as the primary brand logo across the application.
            </p>
          </div>
        </div>

        {/* 3. Titles & Branding Texts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-[11px] text-zinc-300 mb-1 font-medium">Main Title</label>
            <input
              type="text"
              value={design.loginTitle || ''}
              onChange={(e) => setDesign({ ...design, loginTitle: e.target.value })}
              placeholder="ADMIN PANEL"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-[11px] text-zinc-300 mb-1 font-medium">Subtitle</label>
            <input
              type="text"
              value={design.loginSubtitle || ''}
              onChange={(e) => setDesign({ ...design, loginSubtitle: e.target.value })}
              placeholder="SECURE ACCESS"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>

        {/* 4. Input Fields Labels & Placeholders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Admin Name */}
          <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
            <div>
              <label className="block text-[10px] text-zinc-400 mb-1 font-medium">Username / Admin Name Label</label>
              <input
                type="text"
                value={design.loginIdLabel || ''}
                onChange={(e) => setDesign({ ...design, loginIdLabel: e.target.value })}
                placeholder="ADMIN NAME"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400 mb-1 font-medium">Username Placeholder</label>
              <input
                type="text"
                value={design.loginIdPlaceholder || ''}
                onChange={(e) => setDesign({ ...design, loginIdPlaceholder: e.target.value })}
                placeholder="Enter admin name"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>

          {/* Password */}
          <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
            <div>
              <label className="block text-[10px] text-zinc-400 mb-1 font-medium">Password Field Label</label>
              <input
                type="text"
                value={design.loginPassLabel || ''}
                onChange={(e) => setDesign({ ...design, loginPassLabel: e.target.value })}
                placeholder="PASSWORD"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400 mb-1 font-medium">Password Placeholder</label>
              <input
                type="text"
                value={design.loginPassPlaceholder || ''}
                onChange={(e) => setDesign({ ...design, loginPassPlaceholder: e.target.value })}
                placeholder="Enter password"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg py-1.5 px-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>
        </div>

        {/* 5. Button Text */}
        <div className="pt-1">
          <label className="block text-[11px] text-zinc-300 mb-1 font-medium">Sign In Button Text</label>
          <input
            type="text"
            value={design.loginButtonText || ''}
            onChange={(e) => setDesign({ ...design, loginButtonText: e.target.value })}
            placeholder="SIGN IN"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-rose-500"
          />
        </div>

        {/* Bottom Save Action */}
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="py-2.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md shadow-blue-600/30 active:scale-95 transition-all cursor-pointer"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : success ? (
              <>
                <Check className="w-4 h-4" />
                <span>Saved Successfully!</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Save Login Screen Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
