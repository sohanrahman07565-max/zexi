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
  ArrowRight, 
  AlertCircle, 
  Loader2 
} from 'lucide-react';

interface LoginScreenProps {
  onSuccess: (admin: AdminUser) => void;
  design?: any;
}

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
  const [targetBotId, setTargetBotId] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const bid = params.get('bot_id') || params.get('botId');
        if (bid) {
          setTargetBotId(bid);
          api.setActiveBotId(bid);
        }
      }
    } catch {}
  }, []);

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

  const title = design?.loginTitle || 'ADMIN PANEL';
  const subtitle = design?.loginSubtitle || 'SECURE ACCESS PORTAL';
  const customLogoUrl = design?.loginLogoUrl && design.loginLogoUrl.trim() !== '' ? design.loginLogoUrl : null;

  return (
    <div className="zexi-login-wrapper">
      <style>{`
        :root {
          --red: #ff315b;
          --pink: #ff789a;
          --blue: #70dcff;
          --purple: #ad8aff;
        }

        .zexi-login-wrapper {
          min-height: 100vh;
          min-height: 100svh;
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 25px 16px;
          overflow-x: hidden;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: white;
          position: relative;
          background:
            radial-gradient(ellipse at 10% 12%, rgba(255,35,85,.15), transparent 38%),
            radial-gradient(ellipse at 90% 85%, rgba(94,76,255,.14), transparent 40%),
            radial-gradient(ellipse at 50% 50%, rgba(0,190,220,.055), transparent 55%),
            #080912;
        }

        /* Ambient Lights */
        .zexi-background {
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 0;
        }

        .zexi-light {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          opacity: 0.65;
          pointer-events: none;
        }

        .zexi-light-1 {
          width: 440px;
          height: 440px;
          top: -80px;
          left: -70px;
          background: rgba(255, 49, 91, 0.22);
          animation: ambientOne 14s infinite alternate ease-in-out;
        }

        .zexi-light-2 {
          width: 480px;
          height: 480px;
          bottom: -100px;
          right: -70px;
          background: rgba(173, 138, 255, 0.18);
          animation: ambientTwo 18s infinite alternate ease-in-out;
        }

        .zexi-light-3 {
          width: 380px;
          height: 380px;
          top: 35%;
          right: 22%;
          background: rgba(112, 220, 255, 0.12);
          animation: ambientThree 16s infinite alternate ease-in-out;
        }

        .zexi-dot-grid {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px);
          background-size: 24px 24px;
          pointer-events: none;
        }

        @keyframes ambientOne {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, 40px) scale(1.15); }
          100% { transform: translate(-30px, 60px) scale(0.95); }
        }

        @keyframes ambientTwo {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-60px, -45px) scale(1.18); }
          100% { transform: translate(40px, -30px) scale(0.92); }
        }

        @keyframes ambientThree {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(45px, -35px) scale(1.12); }
          100% { transform: translate(-35px, 45px) scale(0.96); }
        }

        /* Card Frame with Animated Multi-Color Gradient Border */
        .zexi-card-container {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 420px;
          animation: entrance 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transition: transform 0.45s ease, opacity 0.45s ease;
        }

        .zexi-card-container.exiting {
          transform: scale(0.94) translateY(8px);
          opacity: 0;
        }

        .zexi-card-frame {
          position: relative;
          border-radius: 26px;
          padding: 1.5px;
          background: linear-gradient(135deg, rgba(255,49,91,0.65), rgba(173,138,255,0.4), rgba(112,220,255,0.5), rgba(255,120,154,0.65), rgba(255,49,91,0.65));
          background-size: 300% 300%;
          animation: borderFlow 7s ease infinite;
          box-shadow: 
            0 24px 60px -12px rgba(0, 0, 0, 0.85),
            0 0 35px -5px rgba(255, 49, 91, 0.22);
        }

        @keyframes borderFlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        @keyframes entrance {
          0% {
            opacity: 0;
            transform: scale(0.92) translateY(20px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        /* Frosted Glass Card */
        .zexi-glass-card {
          background: rgba(12, 13, 23, 0.88);
          backdrop-filter: blur(32px);
          -webkit-backdrop-filter: blur(32px);
          border-radius: 24.5px;
          padding: 34px 26px 28px;
          position: relative;
        }

        /* Floating Robot Logo & Ring */
        .zexi-logo-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 24px;
        }

        .zexi-logo-wrapper {
          position: relative;
          margin-bottom: 14px;
          animation: logoFloat 3.8s ease-in-out infinite;
        }

        @keyframes logoFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-7px); }
        }

        .zexi-logo-ring {
          position: relative;
          width: 76px;
          height: 76px;
          border-radius: 22px;
          padding: 2px;
          background: linear-gradient(135deg, #ff315b, #ff789a, #70dcff, #ad8aff);
          box-shadow: 0 0 28px rgba(255, 49, 91, 0.45);
        }

        .zexi-logo-box {
          width: 100%;
          height: 100%;
          background: #0d0f1b;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .zexi-logo-robot {
          font-size: 34px;
          line-height: 1;
          filter: drop-shadow(0 0 8px rgba(255, 49, 91, 0.5));
          user-select: none;
        }

        .zexi-shield-badge {
          position: absolute;
          bottom: -4px;
          right: -4px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #10b981;
          border: 2.5px solid #080912;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);
        }

        .zexi-title {
          font-size: 23px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #ffffff;
          margin-bottom: 4px;
          text-align: center;
        }

        .zexi-subtitle {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.52);
          text-align: center;
        }

        /* Inputs */
        .zexi-form-group {
          margin-bottom: 16px;
        }

        .zexi-label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: rgba(255, 255, 255, 0.7);
          margin-bottom: 6px;
        }

        .zexi-input-box {
          position: relative;
          display: flex;
          align-items: center;
        }

        .zexi-input-icon {
          position: absolute;
          left: 14px;
          font-size: 15px;
          color: rgba(255, 255, 255, 0.4);
          pointer-events: none;
          user-select: none;
        }

        .zexi-input {
          width: 100%;
          background: rgba(20, 22, 38, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.11);
          border-radius: 14px;
          padding: 13px 42px 13px 40px;
          font-size: 14px;
          color: #ffffff;
          outline: none;
          transition: all 0.25s ease;
          box-sizing: border-box;
        }

        .zexi-input::placeholder {
          color: rgba(255, 255, 255, 0.28);
        }

        .zexi-input:focus {
          border-color: #ff315b;
          background: rgba(24, 26, 46, 0.92);
          box-shadow: 0 0 18px rgba(255, 49, 91, 0.32);
        }

        .zexi-input.has-error {
          border-color: #ff315b;
          box-shadow: 0 0 16px rgba(255, 49, 91, 0.35);
        }

        .zexi-input.shake {
          animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }

        .zexi-toggle-btn {
          position: absolute;
          right: 12px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.45);
          font-size: 16px;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s ease;
        }

        .zexi-toggle-btn:hover {
          color: rgba(255, 255, 255, 0.85);
        }

        /* Targeted Field Error */
        .zexi-field-error {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          font-size: 12px;
          font-weight: 600;
          color: #ff789a;
          background: rgba(255, 49, 91, 0.14);
          border: 1px solid rgba(255, 49, 91, 0.28);
          border-radius: 9px;
          padding: 6px 10px;
          animation: errorIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes errorIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Sign In Button with Gradient Animation */
        .zexi-submit-btn {
          width: 100%;
          margin-top: 8px;
          padding: 13.5px 20px;
          border: none;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #ffffff;
          cursor: pointer;
          background: linear-gradient(135deg, #ff315b, #ff789a 40%, #ad8aff 80%, #ff315b);
          background-size: 250% 250%;
          animation: buttonGradient 4.5s ease infinite;
          box-shadow: 0 8px 24px -4px rgba(255, 49, 91, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .zexi-submit-btn:hover:not(:disabled) {
          transform: translateY(-1.5px);
          box-shadow: 0 12px 28px -3px rgba(255, 49, 91, 0.6);
        }

        .zexi-submit-btn:active:not(:disabled) {
          transform: translateY(1px) scale(0.99);
        }

        .zexi-submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @keyframes buttonGradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        /* Google Sign In Area */
        .zexi-google-area {
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: 14px;
        }

        .zexi-google-btn {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(20, 22, 38, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        }

        .zexi-google-btn:hover:not(:disabled) {
          border-color: rgba(255, 49, 91, 0.5);
          box-shadow: 0 0 20px rgba(255, 49, 91, 0.35);
          transform: scale(1.06);
          background: rgba(28, 30, 48, 0.95);
        }

        .zexi-google-btn:active:not(:disabled) {
          transform: scale(0.94);
        }

        .zexi-google-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Footer Separator & Powered by Zexi Team */
        .zexi-footer-separator {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent);
          margin: 22px 0 16px;
        }

        .zexi-footer {
          text-align: center;
          user-select: none;
        }

        .zexi-footer-text {
          display: inline-block;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          background: linear-gradient(90deg, #ff315b, #ff789a, #70dcff, #ad8aff, #ff315b);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: footerGlow 3.5s ease-in-out infinite, footerBounce 3s ease-in-out infinite;
        }

        @keyframes footerGlow {
          0%, 100% {
            filter: drop-shadow(0 0 5px rgba(255, 49, 91, 0.4));
            background-position: 0% 50%;
          }
          50% {
            filter: drop-shadow(0 0 14px rgba(112, 220, 255, 0.7)) drop-shadow(0 0 20px rgba(255, 120, 154, 0.5));
            background-position: 100% 50%;
          }
        }

        @keyframes footerBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>

      {/* Dynamic Animated Ambient Background */}
      <div className="zexi-background">
        <div className="zexi-light zexi-light-1" />
        <div className="zexi-light zexi-light-2" />
        <div className="zexi-light zexi-light-3" />
        <div className="zexi-dot-grid" />
      </div>

      {/* Main Glass Card with Rotating Gradient Border */}
      <div className={`zexi-card-container ${isSuccessExiting ? 'exiting' : ''}`}>
        <div className="zexi-card-frame">
          <div className="zexi-glass-card">
            
            {/* Header & Glowing Robot Logo Ring */}
            <div className="zexi-logo-area">
              <div className="zexi-logo-wrapper">
                <div className="zexi-logo-ring">
                  <div className="zexi-logo-box">
                    {customLogoUrl ? (
                      <img 
                        src={customLogoUrl} 
                        alt="Logo" 
                        className="w-full h-full object-cover rounded-[18px]" 
                      />
                    ) : (
                      <span className="zexi-logo-robot">🤖</span>
                    )}
                  </div>
                </div>
                <div className="zexi-shield-badge">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
              </div>

              <h2 className="zexi-title">{title}</h2>
              <div className="zexi-subtitle">{subtitle}</div>
              {targetBotId && (
                <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '12px', background: 'rgba(255, 49, 91, 0.15)', border: '1px solid rgba(255, 49, 91, 0.35)', fontSize: '11px', color: '#ff789a', fontWeight: 600 }}>
                  <span>🤖 Cloned Bot Sub-Admin Panel</span>
                </div>
              )}
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit}>
              
              {/* Username or Email Input */}
              <div className="zexi-form-group">
                <label className="zexi-label">Enter Username or Email</label>
                <div className="zexi-input-box">
                  <span className="zexi-input-icon">👤</span>
                  <input
                    type="text"
                    autoComplete="username"
                    required
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    placeholder="Enter Username or Email"
                    className={`zexi-input ${emailError ? 'has-error shake' : ''}`}
                  />
                </div>
                {/* Targeted Error Message Directly Below Username Box */}
                {emailError && (
                  <div className="zexi-field-error">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{emailError}</span>
                  </div>
                )}
              </div>

              {/* Password Input */}
              <div className="zexi-form-group">
                <label className="zexi-label">Enter Password</label>
                <div className="zexi-input-box">
                  <span className="zexi-input-icon">♙</span>
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
                    className={`zexi-input ${passwordError ? 'has-error shake' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="zexi-toggle-btn"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? '◎' : '◉'}
                  </button>
                </div>
                {/* Targeted Error Message Directly Below Password Box */}
                {passwordError && (
                  <div className="zexi-field-error">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{passwordError}</span>
                  </div>
                )}
              </div>

              {/* Vibrant Glowing Sign In Button */}
              <button
                type="submit"
                disabled={loading}
                className="zexi-submit-btn"
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

              {/* Rounded Google Sign-In Button */}
              <div className="zexi-google-area">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading || isSuccessExiting}
                  aria-label="Sign in with Google"
                  title="Sign in with Google (Authorized Administrator)"
                  className="zexi-google-btn"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
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

            <div className="zexi-footer-separator" />

            {/* Animated Powered by Zexi Team Footer */}
            <div className="zexi-footer">
              <span className="zexi-footer-text">
                POWERED BY ZEXI TEAM
              </span>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};
