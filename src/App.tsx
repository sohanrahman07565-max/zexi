import React, { useState, useEffect, useCallback } from 'react';
import { 
  api, getUrlBotId, AdminUser, ItemRecord, MessageTemplate, DesignConfig, BotSettings 
} from './lib/api';
import { primaryAuth, secondaryAuth } from './lib/firebase';
import { signOut } from 'firebase/auth';
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
import { DynamicWeatherBackground } from './components/DynamicWeatherBackground';
import { ToastContainer } from './components/ToastContainer';
import { BotSwitcherModal } from './components/BotSwitcherModal';
import { Shield, Sparkles, Send, Bell, Crown, ShieldCheck } from 'lucide-react';

function resolveBotDisplayName(info: any, fallbackUsername?: string): string {
  if (!info) {
    return fallbackUsername ? `@${String(fallbackUsername).replace(/^@/, '')}` : 'Bot';
  }
  if (info.isMain === false) {
    return (
      info.botName ||
      info.botFirstName ||
      info.result?.first_name ||
      info.displayName ||
      (info.botUsername ? `@${String(info.botUsername).replace(/^@/, '')}` : '') ||
      'Cloned Bot'
    );
  }
  const username =
    (info.botUsername ? String(info.botUsername).replace(/^@/, '') : '') ||
    (info.result?.username ? String(info.result.username).replace(/^@/, '') : '') ||
    (fallbackUsername ? String(fallbackUsername).replace(/^@/, '') : '');
  if (username) return `@${username}`;
  return info.displayName || info.botName || info.result?.first_name || 'Bot';
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [sessionBotId, setSessionBotId] = useState<string>('main');
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [isBotSwitcherOpen, setIsBotSwitcherOpen] = useState(false);

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
  const [onlineUsers, setOnlineUsers] = useState<number>(0);
  const [offlineUsers, setOfflineUsers] = useState<number>(0);
  const [botDisplayName, setBotDisplayName] = useState<string>('');
  const [isBotConnected, setIsBotConnected] = useState<boolean>(false);

  // Dedicated dynamic bot status fetcher that reads directly from the API on mount
  const fetchBotStatus = useCallback(async () => {
    try {
      const info = await api.getBotInfo().catch(() => null);
      if (info && (info.isConnected || (info.ok && (info.result || info.botUsername || info.botName)) || info.botUsername || info.botName)) {
        setIsBotConnected(true);
        setBotDisplayName(resolveBotDisplayName(info));
      }
    } catch (e) {
      console.warn('Could not fetch bot status on mount:', e);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    initApp();
    fetchBotStatus();
  }, [fetchBotStatus]);

  const initApp = async () => {
    setLoading(true);
    try {
      const urlBotId = getUrlBotId();
      if (urlBotId) {
        api.setActiveBotId(urlBotId);
      }

      // Check for auth_token in URL query param (returned by Telegram OAuth callback)
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const authToken = urlParams.get('auth_token');
        if (authToken) {
          api.setToken(authToken);
          const cleanUrl = window.location.pathname + (urlBotId ? `?bot_id=${encodeURIComponent(urlBotId)}` : '');
          window.history.replaceState({}, document.title, cleanUrl);
        }
      }

      // 1. Check current session
      const meData = await api.getMe();
      if (meData?.admin) {
        const activeSessBot = meData.botId || meData.admin.botId || 'main';
        // Strict Panel Isolation:
        // - Cloned bot sessions NEVER access main panel (!urlBotId)
        // - Explicit ?bot_id= URL must match a cloned bot's session (unless already logged into main owner)
        if ((activeSessBot !== 'main' && (!urlBotId || urlBotId !== activeSessBot)) ||
            (urlBotId && urlBotId !== 'main' && activeSessBot !== urlBotId)) {
          api.clearToken();
          const publicDesign = await api.getLoginDesign().catch(() => null);
          if (publicDesign) {
            setDesign((prev) => ({ ...prev, ...publicDesign }));
          }
          return;
        }

        setSessionBotId(activeSessBot);
        setCurrentUser(meData.admin);
        await refreshAllData();
      } else {
        // Load public login design
        const publicDesign = await api.getLoginDesign().catch(() => null);
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
      const [loadedItems, loadedTemplates, loadedSettings, loadedDesign, loadedAdmins, loadedCleanup, loadedStats, loadedBotInfo] = await Promise.all([
        api.getItems().catch(() => []),
        api.getTemplates().catch(() => ({})),
        api.getSettings().catch(() => null),
        api.getDesign().catch(() => null),
        api.getAdmins().catch(() => []),
        api.getCleanupStatus().catch(() => null),
        api.getStats().catch(() => null),
        api.getBotInfo().catch(() => null)
      ]);

      setItems(loadedItems);
      setTemplates(loadedTemplates);
      if (loadedSettings) {
        setSettings(loadedSettings);
      }

      const resolvedName = resolveBotDisplayName(loadedBotInfo, loadedSettings?.botUsername);
      const isConnected = Boolean(
        loadedBotInfo?.isConnected ||
        (loadedBotInfo?.ok && (loadedBotInfo?.result || loadedBotInfo?.botUsername || loadedBotInfo?.botName)) ||
        (Boolean(loadedSettings?.botToken || loadedSettings?.hasToken) && Boolean(loadedSettings?.botUsername))
      );

      if (isConnected) {
        setIsBotConnected(true);
        setBotDisplayName(resolvedName);
      } else if (loadedBotInfo?.isConnected === false) {
        setIsBotConnected(false);
        setBotDisplayName('');
      }

      if (loadedDesign) setDesign(loadedDesign);
      setAdminsCount(loadedAdmins.length || 1);
      if (loadedCleanup) setTrackedCount(loadedCleanup.trackedMessagesCount || 0);
      if (loadedStats) {
        setTotalUsers(loadedStats.totalUsers || 0);
        setOnlineUsers(loadedStats.onlineUsers ?? 0);
        setOfflineUsers(loadedStats.offlineUsers ?? Math.max(0, (loadedStats.totalUsers || 0) - (loadedStats.onlineUsers || 0)));
      }
    } catch (err) {
      console.error('Error loading app data:', err);
    }
  }, []);

  const handleNavigate = useCallback((tab: string) => {
    setCurrentTab(tab);
  }, []);

  // Smooth horizontal touch swipe gestures across main screen area
  const touchStartPos = React.useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartPos.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartPos.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartPos.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartPos.current.y;
    touchStartPos.current = null;

    // Minimum 45px distance, with horizontal displacement clearly exceeding vertical
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      const tabOrder = ['dashboard', 'files', 'filters', 'design', 'more'];
      const currentIndex = tabOrder.indexOf(currentTab);
      if (currentIndex !== -1) {
        if (deltaX < 0 && currentIndex < tabOrder.length - 1) {
          // Swiped left -> advance to next tab
          handleNavigate(tabOrder[currentIndex + 1]);
        } else if (deltaX > 0 && currentIndex > 0) {
          // Swiped right -> return to previous tab
          handleNavigate(tabOrder[currentIndex - 1]);
        }
      }
    }
  };

  // Real-time active bot session status checker
  const checkBotSession = useCallback(async () => {
    try {
      const [loadedSettings, loadedBotInfo] = await Promise.all([
        api.getSettings().catch(() => null),
        api.getBotInfo().catch(() => null)
      ]);

      const hasBotToken = Boolean(loadedSettings?.botToken || loadedSettings?.hasToken || loadedBotInfo?.hasToken);
      if (loadedBotInfo?.ok && (loadedBotInfo?.isConnected || (hasBotToken && loadedBotInfo?.result))) {
        setIsBotConnected(true);
        setBotDisplayName(resolveBotDisplayName(loadedBotInfo, loadedSettings?.botUsername));
      } else {
        setIsBotConnected(false);
        setBotDisplayName('');
      }
    } catch {
      setIsBotConnected(false);
      setBotDisplayName('');
    }
  }, []);

  // Periodic real-time active bot session polling + window focus sync
  useEffect(() => {
    if (!currentUser) return;
    
    // Check immediately
    checkBotSession();

    // Check periodically in the background every 5 seconds for real-time accuracy
    const botInterval = setInterval(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        checkBotSession();
      }
    }, 5000);

    const handleFocus = () => {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        checkBotSession();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(botInterval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [currentUser, checkBotSession]);

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
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('tg_just_logged_out', '1');
      }
    } catch {}
    await api.logout();
    try {
      await Promise.all([
        signOut(primaryAuth).catch(() => {}),
        signOut(secondaryAuth).catch(() => {})
      ]);
    } catch {}
    setCurrentUser(null);
    setSessionBotId('main');
    setItems([]);
    setTemplates({});
    setSettings(null);
    setAdminsCount(1);
    setIsBotSwitcherOpen(false);
    setCurrentTab('dashboard');
    fetchBotStatus();
  }, [fetchBotStatus]);

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
        logoUrl={(!design.loginLogoUrl || design.loginLogoUrl.includes('4fae5ca52db64590')) ? DEFAULT_LOGO_URL : design.loginLogoUrl}
        title={design.loginTitle || 'ADMIN PANEL'}
        accentColor={design.loginAccentColor || '#ef4444'}
      />
    );
  }

  // If unauthenticated -> Render Main Login Screen
  if (!currentUser) {
    return (
      <div className="relative min-h-screen w-full bg-[#060608] text-white overflow-x-hidden overflow-y-auto selection:bg-red-500 selection:text-white">
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
            setSessionBotId(admin.botId || api.getActiveBotId() || 'main');
            setCurrentUser(admin);
            refreshAllData();
          }}
        />
        <ToastContainer />
      </div>
    );
  }

  // Authenticated Android Mobile View
  return (
    <div className="relative min-h-screen w-full bg-[#060608] text-white selection:bg-red-500 selection:text-white flex justify-center overflow-x-hidden overflow-y-auto">
      {/* Dynamic Real-Time Weather Background (Interior Admin Panel) */}
      <DynamicWeatherBackground />

      {/* Hardware-Accelerated Floating Ambient Accent Layer */}
      <div 
        className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
        style={{
          background: `radial-gradient(circle at 50% 12%, rgba(239,68,68,0.08) 0%, rgba(220,38,38,0.03) 45%, transparent 75%)`,
          contain: 'strict',
          transform: 'translate3d(0, 0, 0)'
        }}
      >
        {/* Upper Floating Glowing Orb */}
        <div 
          className="absolute -top-24 left-1/4 w-[420px] h-[420px] rounded-full blur-[100px] pointer-events-none opacity-40 animate-ambient-1"
          style={{ background: 'rgba(239, 68, 68, 0.12)', willChange: 'transform, opacity' }}
        />
        {/* Lower Floating Glowing Orb */}
        <div 
          className="absolute bottom-12 -right-24 w-[380px] h-[380px] rounded-full blur-[90px] pointer-events-none opacity-40 animate-ambient-2"
          style={{ background: 'rgba(225, 29, 72, 0.10)', willChange: 'transform, opacity' }}
        />
        {/* Central Floating Ambient Glow */}
        <div 
          className="absolute top-1/2 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] rounded-full blur-[80px] pointer-events-none opacity-30 animate-ambient-3"
          style={{ background: 'rgba(220, 38, 38, 0.08)', willChange: 'transform, opacity' }}
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
      <div className="relative z-10 w-full max-w-md min-h-screen flex flex-col px-4 pt-1 pb-28 sm:pb-32">
        {/* Top App Bar (Transparent Frosted Glassmorphism Card Shape with Both Sides Rounded) */}
        <header className="sticky top-1.5 z-30 flex items-center justify-between px-3.5 py-2.5 mb-3 rounded-2xl sm:rounded-3xl border border-white/15 bg-white/[0.04] backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] shrink-0 transition-all text-white">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold shadow-md overflow-hidden shrink-0 relative bg-white/10 border border-white/20 backdrop-blur-md"
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
                    <Send className="w-4 h-4 text-white" />
                  </div>
                </>
              ) : (
                <Send className="w-4 h-4 text-white" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold tracking-tight text-white capitalize leading-tight truncate">
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
              <div
                className="flex items-center gap-1.5 text-[10px] mt-0.5 min-w-0"
              >
                {isBotConnected ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)] shrink-0" />
                    <span className="truncate font-medium text-white/80">
                      Connected to {botDisplayName || 'Bot'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-white/40 shadow-[0_0_4px_rgba(255,255,255,0.4)] shrink-0" />
                    <span className="truncate font-medium text-white/60">
                      Bot Offline
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Top-Right Header Area: Clean Role Badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setCurrentTab('more')}
              title={`Logged in as ${currentUser.role === 'owner' ? 'Owner' : 'Administrator'} (${currentUser.name})`}
              className="px-3 py-1.5 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 text-white text-xs font-bold tracking-wide transition-all cursor-pointer active:scale-95 shadow-[0_0_12px_rgba(255,255,255,0.15)] backdrop-blur-md"
            >
              {currentUser.role === 'owner' ? 'Owner' : 'Admin'}
            </button>
          </div>
        </header>

        {/* Tab Content Views with Zero-Delay Native Speed Transitions and Touch Swipe */}
        <main
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="flex-1 w-full overflow-y-auto overscroll-y-auto"
        >
          {/* Dashboard Tab */}
          <div className={currentTab === 'dashboard' ? 'block animate-tab-fade-in' : 'hidden'}>
            <DashboardTab
              items={items}
              adminsCount={adminsCount}
              trackedCount={trackedCount}
              totalUsers={totalUsers}
              onlineUsers={onlineUsers}
              offlineUsers={offlineUsers}
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
              onOpenBotSwitcher={sessionBotId === 'main' ? () => setIsBotSwitcherOpen(true) : undefined}
            />
          </div>
        </main>

        {/* Modern Mobile Bottom Navigation */}
        <BottomNav
          currentTab={currentTab}
          onSelectTab={handleNavigate}
          accentColor={design.primaryColor}
        />

        {/* Telegram Bot Fleet Switcher & Cloner Modal */}
        <BotSwitcherModal
          isOpen={isBotSwitcherOpen}
          onClose={() => setIsBotSwitcherOpen(false)}
          onBotSwitched={() => {
            refreshAllData();
            fetchBotStatus();
          }}
          currentBotUsername={botDisplayName}
        />

        {/* Global Slide-Down Error & Success Toasts */}
        <ToastContainer />
      </div>
    </div>
  );
}
