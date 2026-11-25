import React, { useState, useEffect, useCallback } from 'react';
import { 
  api, getUrlBotId, AdminUser, ItemRecord, MessageTemplate, DesignConfig, BotSettings 
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
import { ToastContainer } from './components/ToastContainer';
import { BotSwitcherModal } from './components/BotSwitcherModal';
import { DynamicIslandHeader } from './components/DynamicIslandHeader';
import { DesktopSidebar } from './components/DesktopSidebar';

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
    primaryColor: '#7c9cff',
    accentColor: '#c084fc',
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
  const [todayJoinedUsers, setTodayJoinedUsers] = useState<number>(0);
  const [bannedUsers, setBannedUsers] = useState<number>(0);
  const [todayDeliveries, setTodayDeliveries] = useState<number>(0);
  const [filesAddedToday, setFilesAddedToday] = useState<number>(0);
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
    try {
      const tgWebApp = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
      try {
        tgWebApp?.ready?.();
        tgWebApp?.expand?.();
      } catch {}

      const urlBotId = getUrlBotId();
      if (urlBotId) {
        api.setActiveBotId(urlBotId);
      } else if (!api.getToken()) {
        api.setActiveBotId('main');
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
        } else {
          setSessionBotId(activeSessBot);
          setCurrentUser(meData.admin);
          await refreshAllData();
          return;
        }
      }

      // 2. Seamless Telegram Mini App (TMA) authentication using signed WebApp.initData
      let justLoggedOut = false;
      try {
        justLoggedOut = window.sessionStorage?.getItem('tg_just_logged_out') === '1';
      } catch {}

      const tmaInitData = tgWebApp?.initData ? String(tgWebApp.initData).trim() : '';
      if (tmaInitData && !justLoggedOut) {
        try {
          const tmaRes = await api.tmaLogin(tmaInitData);
          if (tmaRes?.admin) {
            setSessionBotId(tmaRes.botId || tmaRes.admin.botId || 'main');
            setCurrentUser(tmaRes.admin);
            await refreshAllData();
            return;
          }
        } catch (tmaErr) {
          console.warn('[TMA Auth] Auto-login declined or failed:', tmaErr);
        }
      }

      // 3. Fallback to Login screen design
      const publicDesign = await api.getLoginDesign().catch(() => null);
      if (publicDesign) {
        setDesign((prev) => ({ ...prev, ...publicDesign }));
      }
    } catch (err) {
      console.error('Failed to initialize session:', err);
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
        setTodayJoinedUsers(loadedStats.todayJoinedUsers ?? 0);
        setBannedUsers(loadedStats.bannedUsers ?? 0);
        setTodayDeliveries(loadedStats.todayDeliveries ?? 0);
        setFilesAddedToday(loadedStats.filesAddedToday ?? 0);
      }
    } catch (err) {
      console.error('Error loading app data:', err);
    }
  }, []);

  // Sync Liquid Glass dynamic --a CSS variable from active theme config
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const raw = design?.primaryColor;
    const resolvedAccent = !raw || raw.toLowerCase() === '#ef4444' ? '#7c9cff' : raw;
    document.documentElement.style.setProperty('--a', resolvedAccent);
  }, [design?.primaryColor]);

  // Global Liquid Glass pointer ripple, haptics, and cursor/touch specular illumination
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let activeGlassEl: HTMLElement | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const interactive = target.closest('button, .tap, .lg-col, .lg-nb, [role="button"]');
      if (interactive) {
        try {
          const rp = document.createElement('span');
          rp.className = 'lg-rp';
          rp.style.left = `${e.clientX}px`;
          rp.style.top = `${e.clientY}px`;
          document.body.appendChild(rp);
          window.setTimeout(() => rp.remove(), 750);
        } catch {}
      }

      const glassEl = target.closest('.glass, .glass-panel, .glass-water-card') as HTMLElement | null;
      if (glassEl) {
        const rect = glassEl.getBoundingClientRect();
        glassEl.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        glassEl.style.setProperty('--my', `${e.clientY - rect.top}px`);
        glassEl.classList.add('lit');
        activeGlassEl = glassEl;
      }
    };

    const clearLit = () => {
      if (activeGlassEl) {
        activeGlassEl.classList.remove('lit');
        activeGlassEl = null;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', clearLit, { passive: true });
    window.addEventListener('pointercancel', clearLit, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', clearLit);
      window.removeEventListener('pointercancel', clearLit);
    };
  }, []);

  const handleNavigate = useCallback((tab: string) => {
    setCurrentTab(tab);
    if (typeof window !== 'undefined') {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {}
    }
  }, []);

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
        logoUrl={(!design.loginLogoUrl || design.loginLogoUrl.includes('4fae5ca52db64590') || design.loginLogoUrl.includes('df6c9e167caf42c6')) ? DEFAULT_LOGO_URL : design.loginLogoUrl}
        title={design.loginTitle || 'ADMIN PANEL'}
        accentColor={design.loginAccentColor || '#ef4444'}
      />
    );
  }

  // If unauthenticated -> Render Main Login Screen
  if (!currentUser) {
    return (
      <div className="relative min-h-[100dvh] w-full bg-[#07060f] text-white overflow-x-clip overflow-y-auto selection:bg-pink-500 selection:text-white">
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

  // Authenticated Liquid Glass Responsive Admin Panel
  return (
    <div className="relative min-h-[100dvh] w-full bg-[#05060d] text-white selection:bg-indigo-500 selection:text-white flex justify-center md:block overflow-x-clip">
      {/* Deep Space Aurora Background Layer */}
      <div className="aurora" aria-hidden="true">
        <div className="orb o1" />
        <div className="orb o2" />
        <div className="orb o3" />
      </div>

      {/* Fixed Desktop Sidebar Navigation (md and larger) */}
      <DesktopSidebar
        currentTab={currentTab}
        onSelectTab={handleNavigate}
        currentUser={currentUser}
        design={design}
        isBotConnected={isBotConnected}
        botDisplayName={botDisplayName}
        totalItems={items.length}
        canSwitchBots={sessionBotId === 'main'}
        onOpenBotSwitcher={() => setIsBotSwitcherOpen(true)}
        onLogout={handleLogout}
      />

      {/* Liquid Glass Responsive Container */}
      <div className="relative z-10 w-full max-w-[480px] md:max-w-none min-h-[100dvh] flex flex-col pl-[max(0.875rem,env(safe-area-inset-left))] pr-[max(0.875rem,env(safe-area-inset-right))] sm:px-5 md:pr-0 md:pl-64 xl:pl-72 pt-1 md:pt-0 pb-[calc(6.75rem+env(safe-area-inset-bottom,0px))] md:pb-10">
        <div className="w-full flex-1 flex flex-col md:max-w-[1440px] md:mx-auto md:px-6 lg:px-8 md:pt-5 min-w-0">
          {/* Interactive Header (Mobile Dynamic Island + Desktop Workspace Bar) */}
          <DynamicIslandHeader
            currentTab={currentTab}
            currentUser={currentUser}
            design={design}
            isBotConnected={isBotConnected}
            botDisplayName={botDisplayName}
            totalItems={items.length}
            totalUsers={totalUsers}
            onlineUsers={onlineUsers}
            canSwitchBots={sessionBotId === 'main'}
            onNavigateMore={() => setCurrentTab('more')}
            onRefresh={refreshAllData}
            onOpenBotSwitcher={() => setIsBotSwitcherOpen(true)}
          />

          {/* Tab Content Views with Zero-Delay Native Speed Transitions */}
          <main className="flex-1 w-full min-w-0">
          {/* Dashboard Tab */}
          <div className={currentTab === 'dashboard' ? 'block animate-tab-fade-in' : 'hidden'}>
            <DashboardTab
              items={items}
              currentUser={currentUser}
              adminsCount={adminsCount}
              trackedCount={trackedCount}
              totalUsers={totalUsers}
              onlineUsers={onlineUsers}
              offlineUsers={offlineUsers}
              todayJoinedUsers={todayJoinedUsers}
              bannedUsers={bannedUsers}
              todayDeliveries={todayDeliveries}
              filesAddedToday={filesAddedToday}
              settings={settings}
              onNavigate={handleNavigate}
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
        </div>

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
