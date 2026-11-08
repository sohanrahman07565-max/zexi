import React, { useState, useEffect } from 'react';
import { api, AdminUser } from '../lib/api';
import { toast } from '../lib/toast';
import { auth } from '../lib/firebase';
import { 
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut
} from 'firebase/auth';
import { 
  ShieldCheck, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  AlertCircle, 
  Loader2 
} from 'lucide-react';

interface LoginScreenProps {
  onSuccess: (admin: AdminUser) => void;
  design?: any;
}

const DEFAULT_LOGO_URL = 'https://host.tscv.workers.dev/img/df6c9e167caf42c6';
const AUTHORIZED_ADMIN_EMAILS = [
  'sohanrahman07565@gmail.com',
  'zexiofficial8884@gmail.com'
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess, design }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSuccessExiting, setIsSuccessExiting] = useState(false);

  // Check for redirect result from Google Sign-In if returning from redirect flow
  useEffect(() => {
    let isMounted = true;
    getRedirectResult(auth)
      .then(async (result) => {
        if (!isMounted || !result || !result.user) return;
        setLoading(true);
        await processGoogleUser(result.user);
      })
      .catch((err) => {
        console.warn('[Google Auth] Redirect verification:', err?.message || err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Shared handler for authenticated Google user
  const processGoogleUser = async (user: any) => {
    const userEmail = (user.email || '').trim().toLowerCase();
    setEmailError(null);
    setPasswordError(null);

    // Verify authorized administrator email securely without exposing emails
    const isAuthorized = AUTHORIZED_ADMIN_EMAILS.includes(userEmail);
    if (!isAuthorized) {
      await signOut(auth).catch(() => {});
      setEmailError('Access Denied');
      setLoading(false);
      return;
    }

    try {
      const idToken = await user.getIdToken();
      const res = await api.firebaseLogin({
        idToken,
        email: user.email,
        displayName: user.displayName || 'Owner Admin'
      });

      setIsSuccessExiting(true);
      toast.success(`Welcome back, ${res.admin.name || 'Admin'}!`);

      setTimeout(() => {
        onSuccess(res.admin);
      }, 450);
    } catch (err: any) {
      console.error('[Google Sign-In] Backend verification error:', err);
      setEmailError('Access Denied');
      setLoading(false);
      setIsSuccessExiting(false);
    }
  };

  // Login Submission: Strictly checks credentials against ENV and authorized sub-admins
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || isSuccessExiting) return;

    const cleanId = identifier.trim();
    const cleanPassword = password.trim();

    setEmailError(null);
    setPasswordError(null);

    if (!cleanId) {
      setEmailError('Access Denied');
      return;
    }
    if (!cleanPassword) {
      setPasswordError('Incorrect password');
      return;
    }

    setLoading(true);

    try {
      // Authenticate strictly with backend (checks ENV Owner credentials & approved database sub-admins)
      const res = await api.login(cleanId, cleanPassword);

      setIsSuccessExiting(true);
      toast.success(`Welcome back, ${res.admin.name || 'Admin'}!`);

      setTimeout(() => {
        onSuccess(res.admin);
      }, 450);
    } catch (err: any) {
      console.error('[Login] Authentication error:', err);
      const msg = String(err.message || '');
      if (err.field === 'password' || /password/i.test(msg)) {
        setPasswordError('Incorrect password');
      } else {
        setEmailError('Access Denied');
      }
      setLoading(false);
      setIsSuccessExiting(false);
    }
  };

  // Interactive Google Sign-In with popup & redirect support
  const handleGoogleSignIn = async () => {
    if (loading || isSuccessExiting) return;

    setEmailError(null);
    setPasswordError(null);
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      let userCredential;
      try {
        userCredential = await signInWithPopup(auth, provider);
      } catch (popupErr: any) {
        // If popup was blocked by browser, trigger redirect flow
        if (
          popupErr.code === 'auth/popup-blocked' ||
          popupErr.code === 'auth/cancelled-popup-request'
        ) {
          console.info('[Google Auth] Popup blocked, redirecting...');
          await signInWithRedirect(auth, provider);
          return;
        }
        throw popupErr;
      }

      if (userCredential?.user) {
        await processGoogleUser(userCredential.user);
      }
    } catch (err: any) {
      console.error('[Google Sign-In] Authentication error:', err);
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setEmailError('Access Denied');
      }
      setLoading(false);
      setIsSuccessExiting(false);
    }
  };

  const title = design?.loginTitle || 'ADMIN ACCESS';
  const subtitle = design?.loginSubtitle || 'SECURE ACCESS';
  const logoUrl = design?.loginLogoUrl || DEFAULT_LOGO_URL;

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-[#06070a]">
      {/* Vibrant Red Ambient Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-gradient-to-tr from-red-600/25 via-rose-600/15 to-transparent blur-[120px] rounded-full pointer-events-none animate-pulse duration-[8000ms]" />
      <div className="absolute bottom-5 left-1/3 w-[450px] h-[300px] bg-red-900/20 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute top-10 right-10 w-[300px] h-[300px] bg-rose-700/10 blur-[100px] rounded-full pointer-events-none" />
      
      {/* Red-tinted Cyber Grid */}
      <div 
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(239, 68, 68, 0.45) 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      />

      {/* Main Login Card with Red Glow Border */}
      <div className={`w-full max-w-md relative z-10 transition-all duration-500 ease-out ${
        isSuccessExiting ? 'scale-95 opacity-0 translate-y-3' : 'scale-100 opacity-100'
      }`}>
        <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-red-500/25 shadow-[0_0_60px_rgba(239,68,68,0.18),0_25px_50px_rgba(0,0,0,0.9)] space-y-6 backdrop-blur-2xl bg-zinc-950/90 transition-all hover:border-red-500/35 duration-300">
          
          {/* Header & Logo with Glowing Red Ring */}
          <div className="text-center space-y-3">
            <div className="relative inline-block">
              <div className="w-20 h-20 rounded-2xl p-1 bg-gradient-to-tr from-red-600 via-rose-500 to-red-400 shadow-xl shadow-red-600/40 mx-auto transition-transform hover:scale-105 duration-300">
                <img
                  src={logoUrl}
                  alt="Admin Logo"
                  className="w-full h-full object-cover rounded-[14px]"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = DEFAULT_LOGO_URL;
                  }}
                />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-zinc-950 flex items-center justify-center text-white shadow-xs">
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-wider uppercase">
                {title}
              </h2>
              {/* Clean Subtitle Without Any Emojis */}
              <div className="mt-1 text-xs font-semibold text-zinc-400 tracking-widest uppercase">
                {subtitle}
              </div>
            </div>
          </div>

          {/* Dual Login Form: Telegram Admin ID or Email */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Enter Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  placeholder="Enter Email"
                  className={`w-full bg-zinc-900/90 border rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none transition-all duration-200 ${
                    emailError 
                      ? 'border-red-500 ring-1 ring-red-500/50' 
                      : 'border-zinc-800 focus:border-red-500 focus:ring-2 focus:ring-red-500/30'
                  }`}
                />
              </div>
              {/* Targeted Error Directly Below Email Input */}
              {emailError && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-rose-400 font-medium animate-in fade-in duration-150">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  <span>{emailError}</span>
                </div>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Enter Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) setPasswordError(null);
                  }}
                  placeholder="Enter Password"
                  className={`w-full bg-zinc-900/90 border rounded-xl py-3 pl-10 pr-11 text-sm text-white placeholder:text-zinc-600 focus:outline-none transition-all duration-200 ${
                    passwordError 
                      ? 'border-red-500 ring-1 ring-red-500/50' 
                      : 'border-zinc-800 focus:border-red-500 focus:ring-2 focus:ring-red-500/30'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Targeted Error Directly Below Password Input */}
              {passwordError && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-rose-400 font-medium animate-in fade-in duration-150">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  <span>{passwordError}</span>
                </div>
              )}
            </div>

            {/* Vibrant Glowing Red Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-sm shadow-xl shadow-red-600/40 hover:shadow-red-500/50 flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Minimal Interactive Google Sign-In Button */}
            <div className="pt-2 flex flex-col items-center justify-center">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading || isSuccessExiting}
                aria-label="Sign in with Google"
                title="Sign in with Google (Authorized Administrator)"
                className="group relative w-10 h-10 rounded-full bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800 hover:border-red-500/50 flex items-center justify-center shadow-lg shadow-black/50 hover:shadow-[0_0_16px_rgba(239,68,68,0.35)] transition-all duration-300 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4 transition-transform group-hover:scale-110 duration-200" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              </button>
            </div>
          </form>

          {/* Powered by Zexi Team Footer Credit with Smooth Scale/Pulse, Dynamic Gradient Color Loop & Drop Shadow */}
          <div className="mt-8 text-center select-none pt-2">
            <span className="text-xs font-black tracking-widest uppercase bg-gradient-to-r from-red-500 via-rose-400 via-amber-300 via-pink-400 to-red-500 bg-clip-text text-transparent animate-zexi-footer">
              Powered by Zexi Team
            </span>
          </div>

        </div>
      </div>
    </div>
  );
};
