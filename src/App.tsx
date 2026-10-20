import React, { useState, useEffect, useCallback } from 'react';
import { 
  api, AdminUser, ItemRecord, MessageTemplate, DesignConfig, BotSettings 
} from './lib/api';
import { SplashScreen, DEFAULT_LOGO_URL } from './components/SplashScreen';
import { LoginScreen } from './components/LoginScreen';
import { OfflineScreen } from './components/OfflineScreen';
import { DashboardTab } from './components/DashboardTab';
import { FilesTab } from './components/FilesTab';
import { FiltersTab } from './components/FiltersTab';
import { DesignTab } from './components/DesignTab';
import { MoreTab } from './components/MoreTab';
import { BottomNav } from './components/BottomNav';
import { BackgroundEffects } from './components/BackgroundEffects';
import { Shield, Sparkles, Send, Bell } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [currentTab, setCurrentTab] = useState('dashboard');

  // Network Monitoring State (Wi-Fi / Mobile Data)
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  // App Data
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [templates, setTemplates] = useState<Record<string, MessageTemplate>>({});
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [design, setDesign] = useState<DesignConfig>({
    primaryColor: '#ef4444',
    accentColor: '#dc2626',
    backgroundStyle: 'cyber-grid',
    animationSpeed: 1.0,
    animationOpacity: 0.6,
    animationDensity: 50,
    animationEnabled: true,
    cardStyle: 'glass',
    borderRadius: 'rounded',
    loginTitle: 'ADMIN PANEL',
    loginSubtitle: 'SECURE ACCESS',
    loginLogoUrl: DEFAULT_LOGO_URL,
    loginLogoSymbol: '惡',
    loginIdLabel: 'USERNAME',
    loginIdPlaceholder: 'Enter username',
    loginPassLabel: 'PASSWORD',
    loginPassPlaceholder: 'Enter password',
    loginButtonText: 'SIGN IN',
    loginAccentColor: '#ef4444'
  });
  const [adminsCount, setAdminsCount] = useState(1);
  const [trackedCount, setTrackedCount] = useState(0);
  const [totalUsers, setTotalUsers] = useState<number>(0);

  // Initial Load
  useEffect(() => {
    initApp();
  }, []);

  const initApp = async () => {
    setLoading(true);
    try {
      // 1. Check current session
      const meData = await api.getMe();
      if (meData?.admin) {
        setCurrentUser(meData.admin);
        await refreshAllData();
      } else {
        // Load public login design
        const publicDesign = await api.getLoginDesign();
        if (publicDesign) {
          setDesign((prev) => ({ ...prev, ...publicDesign }));
        }
      }
    } catch (err) {
      console.error('Failed to initialize session:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshAllData = useCallback(async () => {
    try {
      const [loadedItems, loadedTemplates, loadedSettings, loadedDesign, loadedAdmins, loadedCleanup, loadedStats] = await Promise.all([
        api.getItems().catch(() => []),
        api.getTemplates().catch(() => ({})),
        api.getSettings().catch(() => null),
        api.getDesign().catch(() => null),
        api.getAdmins().catch(() => []),
        api.getCleanupStatus().catch(() => null),
        api.getStats().catch(() => null)
      ]);

      setItems(loadedItems);
      setTemplates(loadedTemplates);
      if (loadedSettings) setSettings(loadedSettings);
      if (loadedDesign) setDesign(loadedDesign);
      setAdminsCount(loadedAdmins.length || 1);
      if (loadedCleanup) setTrackedCount(loadedCleanup.trackedMessagesCount || 0);
      if (loadedStats) setTotalUsers(loadedStats.totalUsers || 0);
    } catch (err) {
      console.error('Error loading app data:', err);
    }
  }, []);

  const handleNavigate = useCallback((tab: string) => {
    setCurrentTab(tab);
  }, []);

  // Continuous Automatic Network Monitoring
  const checkNetworkConnection = async (): Promise<boolean> => {
    // 1. Initial check using browser navigator
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      return false;
    }
    // 2. Real connectivity check via lightweight ping
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch('/api/health?t=' + Date.now(), {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const online = res.ok;
      setIsOnline(online);
      return online;
    } catch {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : false;
      setIsOnline(online);
      return online;
    }
  };

  useEffect(() => {
    const handleOnlineEvent = () => {
      checkNetworkConnection();
    };

    const handleOfflineEvent = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnlineEvent);
    window.addEventListener('offline', handleOfflineEvent);

    // Heartbeat check: periodically verify network status
    const heartbeat = setInterval(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOnline(false);
      } else if (!isOnline) {
        checkNetworkConnection();
      }
    }, 10000);

    return () => {
      window.removeEventListener('online', handleOnlineEvent);
      window.removeEventListener('offline', handleOfflineEvent);
      clearInterval(heartbeat);
    };
  }, [isOnline]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setCurrentUser(null);
    setCurrentTab('dashboard');
  }, []);

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  // Dedicated Offline / No-Internet Connection Screen
  // STRICT RULE: Automatically triggered globally when there is no internet connection. When network is restored, it automatically returns to the normal app flow!
  if (!isOnline) {
    return (
      <OfflineScreen
        onRetry={checkNetworkConnection}
        accentColor={design.loginAccentColor || design.primaryColor || '#ef4444'}
      />
    );
  }

  // Dynamic Splash / Loading Screen on app launch
  if (showSplash) {
    return (
      <SplashScreen
        onComplete={handleSplashComplete}
        logoSymbol={design.loginLogoSymbol || '惡'}
        logoUrl={design.loginLogoUrl || DEFAULT_LOGO_URL}
        title={design.loginTitle || 'ADMIN PANEL'}
        accentColor={design.loginAccentColor || '#ef4444'}
      />
    );
  }

  // If unauthenticated -> Render Main Login Screen
  if (!currentUser) {
    return (
      <div className="relative min-h-screen bg-[#060608] text-white overflow-hidden selection:bg-red-500 selection:text-white">
        <BackgroundEffects
          styleName={design.backgroundStyle}
          speed={design.animationSpeed}
          opacity={design.animationOpacity}
          density={design.animationDensity}
          enabled={design.animationEnabled}
          primaryColor={design.primaryColor}
          accentColor={design.accentColor}
        />
        <LoginScreen
          design={design}
          onSuccess={(admin) => {
            setCurrentUser(admin);
            refreshAllData();
          }}
        />
      </div>
    );
  }

  // Authenticated Android Mobile View
  return (
    <div className="relative min-h-screen bg-[#060608] text-white selection:bg-red-500 selection:text-white flex justify-center">
      {/* Hardware-Accelerated Floating Ambient Red Glow Layer (Matching Login Aesthetic) */}
      <div 
        className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
        style={{
          background: `radial-gradient(circle at 50% 12%, rgba(239,68,68,0.14) 0%, rgba(220,38,38,0.06) 45%, rgba(6,6,8,0.98) 85%)`,
          contain: 'strict',
          transform: 'translate3d(0, 0, 0)'
        }}
      >
        {/* Upper Floating Glowing Orb */}
        <div 
          className="absolute -top-24 left-1/4 w-[420px] h-[420px] rounded-full blur-[100px] pointer-events-none animate-ambient-1"
          style={{ background: 'rgba(239, 68, 68, 0.16)', willChange: 'transform, opacity' }}
        />
        {/* Lower Floating Glowing Orb */}
        <div 
          className="absolute bottom-12 -right-24 w-[380px] h-[380px] rounded-full blur-[90px] pointer-events-none animate-ambient-2"
          style={{ background: 'rgba(225, 29, 72, 0.14)', willChange: 'transform, opacity' }}
        />
        {/* Central Floating Ambient Glow */}
        <div 
          className="absolute top-1/2 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] rounded-full blur-[80px] pointer-events-none animate-ambient-3"
          style={{ background: 'rgba(220, 38, 38, 0.12)', willChange: 'transform, opacity' }}
        />
        {/* Subtle tech background grid with red accent matching Login */}
        <div 
          className="absolute inset-0 opacity-[0.035] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(239,68,68,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(239,68,68,0.6) 1px, transparent 1px)`,
            backgroundSize: '36px 36px'
          }}
        />
      </div>

      {/* Background canvas effects */}
      <BackgroundEffects
        styleName={design.backgroundStyle}
        speed={design.animationSpeed}
        opacity={design.animationOpacity}
        density={design.animationDensity}
        enabled={design.animationEnabled}
        primaryColor={design.primaryColor || '#ef4444'}
        accentColor={design.accentColor || '#dc2626'}
      />

      {/* Mobile Screen Container */}
      <div className="relative z-10 w-full max-w-md min-h-screen flex flex-col px-4 pt-4">
        {/* Top App Bar (Android Material 3 Clean Header) */}
        <header className="flex items-center justify-between pb-4 mb-2 border-b border-zinc-800/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold shadow-md overflow-hidden shrink-0 relative"
              style={{
                background: `linear-gradient(135deg, #ef4444, #dc2626)`,
                boxShadow: '0 0 16px rgba(239, 68, 68, 0.35)'
              }}
            >
              {design.loginLogoUrl ? (
                <>
                  <img
                    src={design.loginLogoUrl}
                    alt="Logo"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                      const fallback = e.currentTarget.parentElement?.querySelector('.appbar-fallback') as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="appbar-fallback hidden w-full h-full items-center justify-center text-white">
                    <Send className="w-4 h-4" />
                  </div>
                </>
              ) : (
                <Send className="w-4 h-4" />
              )}
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white capitalize">
                {currentTab === 'dashboard'
                  ? 'Dashboard'
                  : currentTab === 'files'
                  ? 'Files & Links'
                  : currentTab === 'filters'
                  ? 'Bot Filters'
                  : currentTab === 'simulator'
                  ? 'Group Simulator'
                  : currentTab === 'design'
                  ? 'App Design'
                  : 'More Options'}
              </h1>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                <span>Exact Match Active</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentTab('more')}
              className="w-8 h-8 rounded-xl bg-[#13131c] border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:border-red-500/40 transition-colors cursor-pointer touch-press"
            >
              <span className="text-xs font-semibold">{currentUser.name.charAt(0)}</span>
            </button>
          </div>
        </header>

        {/* Tab Content Views with Zero-Delay Native Speed Transitions */}
        <main className="flex-1 overflow-y-auto overscroll-contain">
          {/* Dashboard Tab */}
          <div className={currentTab === 'dashboard' ? 'block animate-tab-fade-in' : 'hidden'}>
            <DashboardTab
              items={items}
              adminsCount={adminsCount}
              trackedCount={trackedCount}
              totalUsers={totalUsers}
              settings={settings}
              onNavigate={handleNavigate}
              onOpenAddModal={() => setCurrentTab('files')}
              onRefresh={refreshAllData}
            />
          </div>

          {/* Files Tab */}
          <div className={currentTab === 'files' ? 'block animate-tab-fade-in' : 'hidden'}>
            <FilesTab
              items={items}
              currentUser={currentUser}
              botUsername={settings?.botUsername}
              design={design}
              onRefresh={refreshAllData}
            />
          </div>

          {/* Filters Tab */}
          <div className={currentTab === 'filters' ? 'block animate-tab-fade-in' : 'hidden'}>
            <FiltersTab
              items={items}
              currentUser={currentUser}
              botUsername={settings?.botUsername}
              design={design}
              onRefresh={refreshAllData}
            />
          </div>

          {/* Design Tab */}
          <div className={currentTab === 'design' ? 'block animate-tab-fade-in' : 'hidden'}>
            <DesignTab
              currentDesign={design}
              onUpdate={(newDesign) => setDesign(newDesign)}
            />
          </div>

          {/* More Tab */}
          <div className={currentTab === 'more' ? 'block animate-tab-fade-in' : 'hidden'}>
            <MoreTab
              currentUser={currentUser}
              templates={templates}
              settings={settings}
              onRefreshTemplates={refreshAllData}
              onRefreshSettings={refreshAllData}
              onLogout={handleLogout}
            />
          </div>
        </main>

        {/* Modern Mobile Bottom Navigation */}
        <BottomNav
          currentTab={currentTab}
          onSelectTab={handleNavigate}
          accentColor={design.primaryColor}
        />
      </div>
    </div>
  );
}
