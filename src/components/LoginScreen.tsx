import React, { useState, useEffect, useRef } from 'react';
import { api, AdminUser } from '../lib/api';
import { AlertCircle, Eye, EyeOff, ShieldCheck, Lock, CheckCircle2 } from 'lucide-react';
import { ZexiLogo } from './ZexiLogo';

interface LoginScreenProps {
  onSuccess: (admin: AdminUser) => void;
  design?: any;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess, design }) => {
  // Username / Admin Name & Password
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [isValidCredentials, setIsValidCredentials] = useState(false);

  // Successful Login Exit Animation state
  const [isSuccessExiting, setIsSuccessExiting] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Real-time validation as user types
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const cleanUser = username.trim();
    const cleanPass = password.trim();

    // If either field is empty, disable button immediately
    if (!cleanUser || !cleanPass) {
      setIsValidCredentials(false);
      setIsVerifying(false);
      return;
    }

    setIsVerifying(true);

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const result = await api.validateCredentials(cleanUser, cleanPass);
        if (result.valid) {
          setIsValidCredentials(true);
          setError(null);
        } else {
          setIsValidCredentials(false);
        }
      } catch {
        setIsValidCredentials(false);
      } finally {
        setIsVerifying(false);
      }
    }, 280);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [username, password]);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValidCredentials || loading || isSuccessExiting) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.login(username.trim(), password);

      // Trigger sleek Zoom-In / Scale-Out exit animation before redirecting to dashboard
      setIsSuccessExiting(true);

      setTimeout(() => {
        onSuccess(res.admin);
      }, 550);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
      setLoading(false);
      setIsSuccessExiting(false);
    }
  };

  const title = design?.loginTitle || 'ADMIN PANEL';
  const subtitle = design?.loginSubtitle || 'SECURE ACCESS';
  const logoSymbol = design?.loginLogoSymbol || '惡';
  const DEFAULT_LOGO_URL = 'https://host.tscv.workers.dev/img/4fae5ca52db64590';
  const logoUrl = (design?.loginLogoUrl && design.loginLogoUrl.trim() !== '') ? design.loginLogoUrl.trim() : DEFAULT_LOGO_URL;
  const idLabel = design?.loginIdLabel || 'USERNAME';
  const idPlaceholder = design?.loginIdPlaceholder || 'Enter username';
  const passLabel = design?.loginPassLabel || 'PASSWORD';
  const passPlaceholder = design?.loginPassPlaceholder || 'Enter password';
  const buttonText = design?.loginButtonText || 'SIGN IN';
  const accentColor = design?.loginAccentColor || '#ef4444';

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-[#060608] selection:bg-red-500 selection:text-white">
      {/* Background: Deep dark/black with subtle neon red gradient */}
      <div 
        className="absolute inset-0 pointer-events-none transition-opacity duration-700"
        style={{
          background: `radial-gradient(circle at 50% 36%, ${accentColor}2e 0%, ${accentColor}12 40%, rgba(6, 6, 8, 0.98) 75%)`
        }}
      />
      <div 
        className="absolute w-[500px] h-[500px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px] pointer-events-none transition-transform duration-700"
        style={{ backgroundColor: `${accentColor}1a` }}
      />

      {/* Subtle tech background grid */}
      <div 
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, ${accentColor} 1px, transparent 1px), linear-gradient(to bottom, ${accentColor} 1px, transparent 1px)`,
          backgroundSize: '36px 36px'
        }}
      />

      {/* Main Login Card with smooth Zoom-In entrance & Zoom-Out exit transitions */}
      <div 
        className={`w-full max-w-sm relative z-10 ${
          isSuccessExiting
            ? 'animate-login-scale-out pointer-events-none'
            : 'animate-login-scale-in'
        }`}
      >
        {/* Centered Container Card with rounded corners, dark fill, subtle red border outline, and soft red outer glow */}
        <div 
          className="rounded-3xl p-7 sm:p-8 bg-[#0c0c13]/95 border shadow-2xl backdrop-blur-2xl transition-all duration-300 relative overflow-hidden"
          style={{
            borderColor: isValidCredentials ? `${accentColor}80` : `${accentColor}38`,
            boxShadow: isValidCredentials 
              ? `0 0 65px -10px ${accentColor}66, 0 20px 45px -15px rgba(0,0,0,0.85)`
              : `0 0 50px -10px ${accentColor}44, 0 20px 40px -15px rgba(0,0,0,0.8)`
          }}
        >
          {/* Subtle top card border glow accent */}
          <div 
            className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-[1.5px] transition-all duration-300"
            style={{
              background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
              opacity: isValidCredentials ? 1 : 0.6
            }}
          />

          {/* Branding & Header Section */}
          <div className="flex flex-col items-center text-center mb-6">
            {/* Logo Icon: Circular user logo/avatar badge with crown & Zexi Tools */}
            <div 
              className="w-16 h-16 rounded-full flex items-center justify-center mb-3.5 transition-all duration-300 hover:scale-105 cursor-default overflow-hidden relative shadow-lg p-0.5"
              style={{
                background: `radial-gradient(circle, #2a0814 0%, #0c0408 100%)`,
                boxShadow: isValidCredentials 
                  ? `0 0 32px ${accentColor}aa, inset 0 1px 3px rgba(255,255,255,0.45)`
                  : `0 0 24px ${accentColor}88, inset 0 1px 3px rgba(255,255,255,0.45)`,
                border: `2px solid ${accentColor}`
              }}
            >
              <img 
                src={logoUrl} 
                alt={title} 
                className="w-full h-full object-cover rounded-full"
                loading="eager"
              />

              {/* Gloss sheen overlay */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/15 to-transparent pointer-events-none rounded-full" />
            </div>

            {/* Title: Bold uppercase in glowing vibrant red */}
            <h1 
              className="text-2xl font-black tracking-wider uppercase font-mono"
              style={{
                color: accentColor,
                textShadow: `0 0 18px ${accentColor}aa`
              }}
            >
              {title}
            </h1>

            {/* Subtitle: Small uppercase in muted light gray */}
            <p className="text-[10px] font-bold tracking-[0.28em] text-zinc-400 uppercase mt-1">
              {subtitle}
            </p>

            {/* Real-time verification badge */}
            <div className="h-5 mt-2 flex items-center justify-center">
              {isVerifying ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
                  <div className="w-2.5 h-2.5 border-2 border-red-500/40 border-t-red-500 rounded-full animate-spin" />
                  <span>Verifying credentials...</span>
                </span>
              ) : isValidCredentials ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 animate-in fade-in duration-200">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Credentials Verified</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-500">
                  <Lock className="w-3 h-3 text-zinc-600" />
                  <span>Enter credentials to unlock</span>
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-950/50 border border-red-800/50 flex items-start gap-2.5 text-red-200 text-xs animate-[shake_0.4s_ease-in-out]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span className="leading-tight">{error}</span>
            </div>
          )}

          {/* Login Form with Native Keyboard support */}
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Input Field 1: USERNAME */}
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                {idLabel}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={idPlaceholder}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  disabled={loading || isSuccessExiting}
                  className="w-full bg-[#13131c] border border-zinc-800/90 rounded-xl py-3 px-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/40 focus:shadow-[0_0_18px_rgba(239,68,68,0.35)] transition-all duration-200 hover:border-zinc-700"
                  style={{
                    caretColor: accentColor
                  }}
                />
              </div>
            </div>

            {/* Input Field 2: PASSWORD with Visibility Toggle */}
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                {passLabel}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={passPlaceholder}
                  autoComplete="current-password"
                  disabled={loading || isSuccessExiting}
                  className="w-full bg-[#13131c] border border-zinc-800/90 rounded-xl py-3 pl-4 pr-11 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/40 focus:shadow-[0_0_18px_rgba(239,68,68,0.35)] transition-all duration-200 hover:border-zinc-700"
                  style={{
                    caretColor: accentColor
                  }}
                />
                {/* Show/Hide Password Toggle Button */}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-red-400 p-1 rounded-md transition-colors cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4 text-red-500" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Action Button: Dynamic SIGN IN Button (Greyed out by default, enabled when verified) */}
            <button
              type="submit"
              disabled={!isValidCredentials || loading || isSuccessExiting}
              className={`w-full mt-5 py-3.5 px-6 rounded-xl font-black uppercase tracking-widest text-sm flex items-center justify-center gap-2 transition-all duration-300 ${
                isValidCredentials
                  ? 'text-white cursor-pointer active:scale-[0.98] hover:brightness-110 shadow-lg'
                  : 'bg-zinc-900/80 border border-zinc-800/80 text-zinc-500 opacity-40 cursor-not-allowed select-none'
              }`}
              style={
                isValidCredentials
                  ? {
                      background: `linear-gradient(90deg, #dc2626, ${accentColor}, #e11d48)`,
                      boxShadow: `0 8px 30px ${accentColor}66, 0 0 20px ${accentColor}44`
                    }
                  : undefined
              }
            >
              {loading || isSuccessExiting ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span className="font-mono text-xs tracking-wider">
                    {isSuccessExiting ? 'ACCESS GRANTED' : 'AUTHENTICATING...'}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {isValidCredentials && <ShieldCheck className="w-4 h-4 text-white" />}
                  <span className="font-black tracking-widest text-sm drop-shadow-sm">{buttonText}</span>
                </div>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
