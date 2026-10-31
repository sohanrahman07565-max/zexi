import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  AdminUser, MessageTemplate, BotSettings, UserReportRecord, FraudKeywordRule, JoinRequestRecord, api 
} from '../lib/api';
import { toast } from '../lib/toast';
import { 
  MessageSquare, Users, Trash2, Settings, Smartphone, LogOut, 
  ChevronRight, Edit2, Check, RefreshCw, Plus, Shield, Send, Sparkles, X, CheckCircle2, AlertCircle, Clock, Smile, Wifi, WifiOff,
  Megaphone, Image as ImageIcon, Video as VideoIcon, Music, Mic, Pin, Paperclip, Loader2, Radio,
  Flag, AlertTriangle, Ban, CheckCircle, ShieldAlert, Eye, ExternalLink,
  Server, Database, Copy, Download, Upload, Activity, HardDrive
} from 'lucide-react';
import { EmojiStore } from './EmojiStore';

interface MoreTabProps {
  currentUser: AdminUser;
  templates: Record<string, MessageTemplate>;
  settings: BotSettings | null;
  onRefreshTemplates: () => void;
  onRefreshSettings: () => void;
  onLogout: () => void;
}

export const MoreTab: React.FC<MoreTabProps> = ({
  currentUser,
  templates,
  settings,
  onRefreshTemplates,
  onRefreshSettings,
  onLogout
}) => {
  const [subView, setSubView] = useState<'menu' | 'templates' | 'admins' | 'cleanup' | 'settings' | 'webhook' | 'broadcast' | 'apk' | 'emoji' | 'reports' | 'fraud' | 'backup'>('menu');

  // Webhook standalone state
  const [webhookAppUrl, setWebhookAppUrl] = useState<string>(
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const [webhookLoading, setWebhookLoading] = useState<boolean>(false);
  const [webhookStatusMsg, setWebhookStatusMsg] = useState<{ type: 'success' | 'error'; text: string; details?: any } | null>(null);

  // Broadcast state
  const [broadcastUsersCount, setBroadcastUsersCount] = useState<number>(0);
  const [broadcastMediaType, setBroadcastMediaType] = useState<'text' | 'photo' | 'video' | 'audio' | 'voice'>('text');
  const [broadcastMessage, setBroadcastMessage] = useState<string>('');
  const [broadcastMediaSource, setBroadcastMediaSource] = useState<'upload' | 'url'>('upload');
  const [broadcastMediaUrl, setBroadcastMediaUrl] = useState<string>('');
  const [broadcastFile, setBroadcastFile] = useState<File | null>(null);
  const [broadcastPin, setBroadcastPin] = useState<boolean>(false);
  const [broadcastSending, setBroadcastSending] = useState<boolean>(false);
  const [broadcastTesting, setBroadcastTesting] = useState<boolean>(false);
  const [broadcastResult, setBroadcastResult] = useState<{
    type: 'success' | 'error';
    text: string;
    details?: { total: number; sent: number; failed: number };
  } | null>(null);

  // Reports state
  const [reportsList, setReportsList] = useState<UserReportRecord[]>([]);
  const [reportsLoading, setReportsLoading] = useState<boolean>(false);
  const [reportFilter, setReportFilter] = useState<'all' | 'pending' | 'resolved' | 'dismissed'>('all');
  const [reportActionLoading, setReportActionLoading] = useState<string | null>(null);

  const [fraudRulesList, setFraudRulesList] = useState<FraudKeywordRule[]>([]);
  const [fraudRulesLoading, setFraudRulesLoading] = useState<boolean>(false);
  const [showAddFraudRule, setShowAddFraudRule] = useState<boolean>(false);
  const [newFraudKeyword, setNewFraudKeyword] = useState<string>('');
  const [newFraudMatchType, setNewFraudMatchType] = useState<'contains' | 'exact' | 'regex'>('contains');
  const [newFraudAction, setNewFraudAction] = useState<'delete_and_warn' | 'delete' | 'warn' | 'mute' | 'ban'>('delete_and_warn');
  const [newFraudDuration, setNewFraudDuration] = useState<'permanent' | '1h' | '6h' | '24h' | '7d' | '30d'>('permanent');
  const [newFraudMaxWarnings, setNewFraudMaxWarnings] = useState<number>(3);
  const [newFraudWarningText, setNewFraudWarningText] = useState<string>('');
  const [newFraudMediaUrl, setNewFraudMediaUrl] = useState<string>('');
  const [newFraudMediaType, setNewFraudMediaType] = useState<'text' | 'photo' | 'video' | 'audio' | 'voice'>('text');
  const [savingFraudRule, setSavingFraudRule] = useState<boolean>(false);

  // Backup Server state
  const [backupConfig, setBackupConfig] = useState<any>(null);
  const [backupLocalStats, setBackupLocalStats] = useState<any>(null);
  const [backupLoading, setBackupLoading] = useState<boolean>(false);
  const [backupSaving, setBackupSaving] = useState<boolean>(false);
  const [backupSyncing, setBackupSyncing] = useState<boolean>(false);
  const [backupTesting, setBackupTesting] = useState<boolean>(false);
  const [backupSwitchingRole, setBackupSwitchingRole] = useState<boolean>(false);
  const [backupRestoring, setBackupRestoring] = useState<boolean>(false);

  // Form states
  const [backupEnabled, setBackupEnabled] = useState<boolean>(false);
  const [backupServerUrl, setBackupServerUrl] = useState<string>('');
  const [backupSecretKey, setBackupSecretKey] = useState<string>('');
  const [backupAutoSync, setBackupAutoSync] = useState<boolean>(true);
  const [backupInterval, setBackupInterval] = useState<number>(5);
  const [backupTestResult, setBackupTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
    role?: string;
  } | null>(null);

  const loadBackupStatus = async () => {
    setBackupLoading(true);
    try {
      const data = await api.getBackupServerStatus();
      setBackupConfig(data.config);
      setBackupLocalStats(data.localStats);
      setBackupEnabled(data.config.enabled);
      setBackupServerUrl(data.config.serverUrl || '');
      setBackupSecretKey(data.config.secretKey || '');
      setBackupAutoSync(data.config.autoSyncOnSave !== false);
      setBackupInterval(data.config.syncIntervalMinutes || 5);
    } catch (err: any) {
      console.warn('Failed to load backup status:', err);
    } finally {
      setBackupLoading(false);
    }
  };

  useEffect(() => {
    loadBackupStatus();
  }, []);

  useEffect(() => {
    if (subView === 'backup') {
      loadBackupStatus();
    }
  }, [subView]);

  const handleSaveBackupConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setBackupSaving(true);
    try {
      const res = await api.updateBackupServerConfig({
        enabled: backupEnabled,
        serverUrl: backupServerUrl.trim(),
        secretKey: backupSecretKey.trim(),
        autoSyncOnSave: backupAutoSync,
        syncIntervalMinutes: backupInterval
      });
      setBackupConfig(res.config);
      toast.success('Backup server configuration saved successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save backup configuration');
    } finally {
      setBackupSaving(false);
    }
  };

  const handleSyncNow = async () => {
    if (!backupServerUrl.trim()) {
      toast.error('Please configure a designated backup server URL first');
      return;
    }
    setBackupSyncing(true);
    try {
      const res = await api.syncNowBackupServer();
      toast.success(res.message || 'Live database and files mirrored successfully!');
      await loadBackupStatus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to sync to backup server');
    } finally {
      setBackupSyncing(false);
    }
  };

  const handleTestConnection = async () => {
    if (!backupServerUrl.trim()) {
      toast.error('Please enter a target backup server URL');
      return;
    }
    setBackupTesting(true);
    setBackupTestResult(null);
    try {
      const res = await api.testBackupServerConnection(backupServerUrl.trim(), backupSecretKey.trim());
      setBackupTestResult({
        success: true,
        message: res.message,
        latencyMs: res.latencyMs,
        role: res.backupServerRole
      });
      toast.success(`Handshake verified! Latency: ${res.latencyMs || 0}ms`);
    } catch (err: any) {
      setBackupTestResult({
        success: false,
        message: err.message || 'Connection failed'
      });
      toast.error(err.message || 'Connection test failed');
    } finally {
      setBackupTesting(false);
    }
  };

  const handleSwitchRole = async () => {
    const isCurrentlyBackup = backupConfig?.role === 'backup';
    const targetRole = isCurrentlyBackup ? 'primary' : 'backup';
    const confirmMsg = isCurrentlyBackup
      ? 'ACTIVATE FAILOVER: Promote this backup server to Active Primary? Bot operations will resume immediately on this server.'
      : 'STANDBY SWITCH: Switch this server to Silent Backup mirror? Bot polling will become dormant.';

    if (!window.confirm(confirmMsg)) return;

    setBackupSwitchingRole(true);
    try {
      const res = await api.switchBackupServerRole(targetRole);
      setBackupConfig(res.config);
      toast.success(res.message);
      await loadBackupStatus();
      onRefreshSettings();
    } catch (err: any) {
      toast.error(err.message || 'Failed to switch role');
    } finally {
      setBackupSwitchingRole(false);
    }
  };

  const handleGenerateNewSecretKey = () => {
    const newKey = 'bsk_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    setBackupSecretKey(newKey);
    toast.info('New replication token generated. Click "Save Configuration" to apply.');
  };

  const handleCopySecretKey = () => {
    if (!backupSecretKey) return;
    navigator.clipboard.writeText(backupSecretKey);
    toast.success('Replication token copied to clipboard!');
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm(`Restore all database tables and files from "${file.name}"? This will update current data.`)) {
      e.target.value = '';
      return;
    }

    setBackupRestoring(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api.restoreBackupSnapshot(parsed);
      toast.success(res.message || 'Snapshot successfully restored!');
      await loadBackupStatus();
      onRefreshSettings();
      onRefreshTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Failed to restore snapshot from file');
    } finally {
      setBackupRestoring(false);
      e.target.value = '';
    }
  };

  const handleDownloadSnapshot = () => {
    window.open('/api/backup-server/export-snapshot', '_blank');
  };

  // Secret 7-tap quick action gesture on Header Card to automatically set up Webhook
  const tapCountRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const [gestureFeedback, setGestureFeedback] = useState(false);

  const handleHeaderSecretTap = async () => {
    const now = Date.now();
    // Reset if more than 2 seconds between taps
    if (now - lastTapTimeRef.current > 2000) {
      tapCountRef.current = 1;
    } else {
      tapCountRef.current += 1;
    }
    lastTapTimeRef.current = now;

    if (tapCountRef.current === 7) {
      tapCountRef.current = 0;
      setGestureFeedback(true);
      setTimeout(() => setGestureFeedback(false), 1200);

      const targetUrl = typeof window !== 'undefined' ? window.location.origin : '';
      if (!targetUrl) {
        toast.error('Unable to detect web application URL for webhook setup.', 'Webhook Error');
        return;
      }

      toast.info('Secret 7-tap gesture detected: Configuring Webhook...', 'Quick Action');

      try {
        const res = await api.setWebhook(targetUrl.trim());
        if (res && res.ok) {
          toast.success(
            `Telegram Webhook connected successfully! (${targetUrl})`,
            'Webhook Activated'
          );
        } else {
          toast.error(
            res?.description || res?.message || 'Webhook registration error from Telegram',
            'Webhook Failed'
          );
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to setup webhook', 'Webhook Error');
      }
    }
  };

  // Templates state
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [templateContent, setTemplateContent] = useState('');
  const [templateMediaType, setTemplateMediaType] = useState<'none' | 'photo' | 'video'>('none');
  const [templateMediaUrl, setTemplateMediaUrl] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);

  // Auto-focus and scroll to top refs for seamless editing
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modalScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editingTemplate) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const timer = setTimeout(() => {
        if (modalScrollRef.current) {
          modalScrollRef.current.scrollTop = 0;
        }
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [editingTemplate]);

  // Admins state
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [newAdminData, setNewAdminData] = useState({
    telegramId: '',
    name: '',
    password: '',
    permissions: {
      files_view: true,
      files_add: true,
      files_edit: true,
      files_delete: false,
      links_view: true,
      links_add: true,
      links_edit: true,
      links_delete: false,
      messages_view: true,
      messages_edit: false,
      admins_manage: false,
      design_edit: false,
      settings_edit: false,
      cleanup_manage: false
    }
  });

  // Cleanup state
  const [cleanupStatus, setCleanupStatus] = useState<any>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  // Settings state
  const [botSettings, setBotSettings] = useState<any>({
    botToken: '',
    botUsername: settings?.botUsername || '',
    rootAdminId: settings?.rootAdminId || '',
    maxBotMessagesPerChat: settings?.maxBotMessagesPerChat || 10,
    dailyCleanupEnabled: settings?.dailyCleanupEnabled ?? true,
    cleanupAgeHours: settings?.cleanupAgeHours || 24,
    autoDeleteDeliveryEnabled: settings?.autoDeleteDeliveryEnabled ?? true,
    deliveryTimeoutMinutes: settings?.deliveryTimeoutMinutes || 10,
    autoDeleteNoticeEnabled: settings?.autoDeleteNoticeEnabled ?? false,
    maintenanceMode: settings?.maintenanceMode ?? false,
    maintenanceNotice: settings?.maintenanceNotice || '',
    forceSubEnabled: settings?.forceSubEnabled ?? false,
    antiForwardEnabled: settings?.antiForwardEnabled ?? false,
    requiredChannels: settings?.requiredChannels || [],
    adminNewPassword: ''
  });
  const [botStatusMsg, setBotStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [settingSaving, setSettingSaving] = useState(false);

  // Force Sub Add Channel form state
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelChatId, setNewChannelChatId] = useState('');
  const [channelSyncing, setChannelSyncing] = useState(false);
  const [showManualAddChannel, setShowManualAddChannel] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequestRecord[]>([]);
  const [loadingJoinRequests, setLoadingJoinRequests] = useState(false);
  const [showJoinRequests, setShowJoinRequests] = useState(false);

  useEffect(() => {
    if (settings) {
      setBotSettings((prev: any) => ({
        ...prev,
        botUsername: settings.botUsername || '',
        rootAdminId: settings.rootAdminId || '',
        maxBotMessagesPerChat: settings.maxBotMessagesPerChat || 10,
        dailyCleanupEnabled: settings.dailyCleanupEnabled ?? true,
        cleanupAgeHours: settings.cleanupAgeHours || 24,
        autoDeleteDeliveryEnabled: settings.autoDeleteDeliveryEnabled ?? true,
        deliveryTimeoutMinutes: settings.deliveryTimeoutMinutes || 10,
        autoDeleteNoticeEnabled: settings.autoDeleteNoticeEnabled ?? false,
        maintenanceMode: settings.maintenanceMode ?? false,
        maintenanceNotice: settings.maintenanceNotice || '',
        forceSubEnabled: settings.forceSubEnabled ?? false,
        antiForwardEnabled: settings.antiForwardEnabled ?? false,
        autoApproveJoinRequests: settings.autoApproveJoinRequests ?? true,
        requiredChannels: Array.isArray(settings.requiredChannels) ? settings.requiredChannels : []
      }));
    }
  }, [settings]);

  // Load admins when viewing admins tab
  useEffect(() => {
    if (subView === 'admins') {
      loadAdmins();
    } else if (subView === 'cleanup') {
      loadCleanupStatus();
    } else if (subView === 'settings') {
      loadJoinRequests();
    }
    // Refresh user count for broadcast
    api.getUsers().then(users => {
      setBroadcastUsersCount(users.length);
    }).catch(() => {});
  }, [subView]);

  const loadJoinRequests = async () => {
    setLoadingJoinRequests(true);
    try {
      const res = await api.getJoinRequests();
      setJoinRequests(res.requests || []);
    } catch (err: any) {
      console.warn('Failed to load join requests:', err);
    } finally {
      setLoadingJoinRequests(false);
    }
  };

  const handleApproveJoinRequest = async (chatId: string, userId: string) => {
    try {
      await api.approveJoinRequest(chatId, userId);
      toast.success('Join request approved successfully!');
      loadJoinRequests();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve join request');
    }
  };

  const loadAdmins = async () => {
    setAdminsLoading(true);
    try {
      const data = await api.getAdmins();
      setAdminsList(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setAdminsLoading(false);
    }
  };

  const loadCleanupStatus = async () => {
    try {
      const data = await api.getCleanupStatus();
      setCleanupStatus(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Initial load for reports and fraud rules
  useEffect(() => {
    loadReports();
    loadFraudRules();
  }, []);

  useEffect(() => {
    if (subView === 'reports') {
      loadReports();
    } else if (subView === 'fraud') {
      loadFraudRules();
    }
  }, [subView]);

  const loadReports = async () => {
    setReportsLoading(true);
    try {
      const data = await api.getReports();
      setReportsList(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed to load reports:', err);
    } finally {
      setReportsLoading(false);
    }
  };

  const loadFraudRules = async () => {
    setFraudRulesLoading(true);
    try {
      const data = await api.getFraudRules();
      setFraudRulesList(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed to load fraud rules:', err);
    } finally {
      setFraudRulesLoading(false);
    }
  };

  const handleResolveReport = async (reportId: string, banUser: boolean) => {
    setReportActionLoading(reportId);
    try {
      await api.updateReport(reportId, { status: 'resolved', banUser });
      toast.success(banUser ? 'User banned and report marked as resolved!' : 'Report resolved!');
      await loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update report');
    } finally {
      setReportActionLoading(null);
    }
  };

  const handleDismissReport = async (reportId: string) => {
    setReportActionLoading(reportId);
    try {
      await api.updateReport(reportId, { status: 'dismissed' });
      toast.info('Report dismissed.');
      await loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to dismiss report');
    } finally {
      setReportActionLoading(null);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!window.confirm('Delete this report record?')) return;
    try {
      await api.deleteReport(reportId);
      toast.success('Report deleted.');
      await loadReports();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete report');
    }
  };

  const handleCreateFraudRule = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newFraudKeyword.trim()) {
      toast.error('Please enter a keyword');
      return;
    }
    setSavingFraudRule(true);
    try {
      await api.createFraudRule({
        keyword: newFraudKeyword.trim(),
        matchType: newFraudMatchType,
        action: newFraudAction,
        duration: (newFraudAction === 'mute' || newFraudAction === 'ban') ? newFraudDuration : undefined,
        maxWarnings: newFraudMaxWarnings,
        warningText: newFraudWarningText.trim() || undefined,
        mediaUrl: newFraudMediaUrl.trim() || undefined,
        mediaType: newFraudMediaType !== 'text' ? (newFraudMediaType as any) : undefined,
        enabled: true
      });
      toast.success(`Rule for "${newFraudKeyword.trim()}" created!`);
      setNewFraudKeyword('');
      setNewFraudWarningText('');
      setNewFraudMediaUrl('');
      setNewFraudMaxWarnings(3);
      setNewFraudDuration('permanent');
      setShowAddFraudRule(false);
      await loadFraudRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create rule');
    } finally {
      setSavingFraudRule(false);
    }
  };

  const handleToggleFraudRule = async (rule: FraudKeywordRule) => {
    try {
      await api.updateFraudRule(rule.id, { enabled: !rule.enabled });
      toast.info(`Rule ${!rule.enabled ? 'activated' : 'paused'}`);
      await loadFraudRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle rule');
    }
  };

  const handleDeleteFraudRule = async (ruleId: string) => {
    if (!window.confirm('Delete this restricted keyword rule?')) return;
    try {
      await api.deleteFraudRule(ruleId);
      toast.success('Rule deleted.');
      await loadFraudRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete rule');
    }
  };

  // Save template edit
  const handleSaveTemplate = async () => {
    if (!editingTemplate) return;
    setTemplateSaving(true);
    try {
      await api.updateTemplate(editingTemplate.key, templateContent, {
        mediaType: templateMediaType,
        mediaUrl: templateMediaUrl.trim()
      });
      toast.success('Message template saved successfully!');
      onRefreshTemplates();
      setEditingTemplate(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save template');
    } finally {
      setTemplateSaving(false);
    }
  };

  const renderTemplateEditModal = () => {
    if (!editingTemplate) return null;

    return createPortal(
      <div
        ref={modalScrollRef}
        onClick={() => setEditingTemplate(null)}
        className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-5 pt-3 sm:pt-6 pb-28 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain animate-in fade-in duration-200"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="glass-panel w-full max-w-lg rounded-3xl p-5 border border-red-500/35 shadow-[0_0_50px_-10px_rgba(239,68,68,0.35),0_25px_50px_-12px_rgba(0,0,0,0.95)] space-y-4 my-2 relative animate-in zoom-in-95 duration-200"
        >
          {/* Subtle top border glow */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-[1.5px] pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, #ef4444, transparent)' }}
          />

          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                <Edit2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">{editingTemplate.name}</h4>
                <p className="text-[11px] text-zinc-400">{editingTemplate.description || 'Edit bot message template'}</p>
              </div>
            </div>
            <button
              onClick={() => setEditingTemplate(null)}
              className="w-8 h-8 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-zinc-300">Message Text (HTML format)</label>
              <span className="text-[10px] text-zinc-500">Supports &lt;b&gt;, &lt;i&gt;, &lt;code&gt;</span>
            </div>
            <textarea
              ref={textareaRef}
              rows={5}
              value={templateContent}
              onChange={(e) => setTemplateContent(e.target.value)}
              className="w-full bg-[#101018] border border-zinc-700/80 rounded-2xl p-3.5 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
              placeholder="Type your bot message..."
            />
          </div>

          {/* Rich Media Attachment for /start Welcome Message */}
          {editingTemplate.key === 'START_MESSAGE' && (
            <div className="p-3.5 rounded-2xl bg-[#0f0f18] border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white">Attached Media Header</label>
                <span className="text-[10px] text-zinc-400">Optional Photo or Video</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {(['none', 'photo', 'video'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setTemplateMediaType(m)}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold capitalize border transition-all cursor-pointer ${
                      templateMediaType === m
                        ? 'bg-blue-600/20 text-sky-300 border-blue-500/60 shadow-sm'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    {m === 'none' ? 'None' : m === 'photo' ? '📸 Photo' : '🎥 Video'}
                  </button>
                ))}
              </div>

              {templateMediaType !== 'none' && (
                <div className="space-y-2 pt-1">
                  <input
                    type="text"
                    value={templateMediaUrl}
                    onChange={(e) => setTemplateMediaUrl(e.target.value)}
                    placeholder={
                      templateMediaType === 'photo'
                        ? 'https://example.com/banner.jpg, Telegram file_id, or upload'
                        : 'https://example.com/video.mp4, Telegram file_id, or upload'
                    }
                    className="w-full bg-zinc-950 border border-zinc-700/80 rounded-xl py-2 px-3 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />

                  <div className="flex items-center gap-2">
                    <label className="flex-1 py-2 px-3 rounded-xl border border-dashed border-red-500/40 hover:border-red-400 bg-red-500/10 hover:bg-red-500/15 flex items-center justify-center gap-1.5 cursor-pointer text-xs text-red-300 font-semibold transition-all">
                      <span>📁 Choose {templateMediaType === 'photo' ? 'Photo' : 'Video'} from Device</span>
                      <input
                        type="file"
                        accept={templateMediaType === 'photo' ? 'image/*' : 'video/*'}
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const formData = new FormData();
                            formData.append('file', file);
                            formData.append('fileType', templateMediaType);
                            formData.append('fileName', file.name);
                            const data = await api.uploadFile(formData);
                            if (data.success && (data.fileId || data.uploadedFileId)) {
                              setTemplateMediaUrl(data.uploadedFileId || data.fileId);
                            } else {
                              alert('Upload failed');
                            }
                          } catch (err: any) {
                            alert(err.message || 'Upload error');
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Available Placeholders / Variables */}
          <div className="text-[11px] text-zinc-400">
            <span className="font-medium text-zinc-300">Quick Variables (Tap to insert):</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {editingTemplate.key === 'START_MESSAGE' && (
                <button
                  type="button"
                  onClick={() => setTemplateContent((prev) => `${prev} @username`)}
                  className="bg-indigo-950/70 border border-indigo-500/50 px-2 py-1 rounded-lg text-indigo-300 text-[10px] font-mono hover:bg-indigo-900/60 cursor-pointer font-bold transition-all active:scale-95"
                >
                  +@username
                </button>
              )}
              {(editingTemplate.variables || ['user_name', 'user_id', 'bot_name']).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTemplateContent((prev) => `${prev} {${v}}`)}
                  className="bg-zinc-800/90 border border-zinc-700/80 px-2 py-1 rounded-lg text-red-400 text-[10px] font-mono hover:bg-zinc-700 cursor-pointer transition-all active:scale-95"
                >
                  +{`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setEditingTemplate(null)}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-red-600/30 transition-all active:scale-95"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={templateSaving}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-blue-600/30 disabled:opacity-50 transition-all active:scale-95"
            >
              {templateSaving ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  // Add sub-admin
  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createAdmin(newAdminData);
      setShowAddAdmin(false);
      loadAdmins();
      setNewAdminData({
        telegramId: '',
        name: '',
        password: '',
        permissions: { ...newAdminData.permissions }
      });
      toast.success('Sub-admin created successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add admin');
    }
  };

  const handleDeleteAdmin = async (id: string) => {
    if (!confirm('Are you sure you want to remove this admin?')) return;
    try {
      await api.deleteAdmin(id);
      loadAdmins();
      toast.success('Sub-admin removed successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete admin');
    }
  };

  // Run cleanup
  const handleRunCleanup = async () => {
    setCleanupRunning(true);
    setCleanupMsg(null);
    try {
      const res = await api.runCleanup(botSettings.cleanupAgeHours);
      setCleanupMsg(res.message);
      toast.success(res.message || 'Message cleanup completed!');
      loadCleanupStatus();
    } catch (err: any) {
      const errText = err.message || 'Cleanup failed';
      setCleanupMsg(errText);
      toast.error(errText);
    } finally {
      setCleanupRunning(false);
    }
  };

  // Force Sub Channel Management Handlers
  const handleAddForceSubChannel = () => {
    if (!newChannelChatId.trim()) {
      toast.error('Please enter the Channel / Group ID or Username');
      return;
    }
    const cleanChatId = newChannelChatId.trim();
    const fallbackName = newChannelName.trim() || cleanChatId;
    const inviteLink = cleanChatId.startsWith('@') 
      ? `https://t.me/${cleanChatId.replace(/^@/, '')}` 
      : (cleanChatId.startsWith('https://t.me/') ? cleanChatId : '');
    
    const newChan = {
      id: `ch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: fallbackName,
      chatId: cleanChatId.startsWith('https://t.me/') 
        ? (cleanChatId.includes('/+') ? cleanChatId : `@${cleanChatId.replace('https://t.me/', '').replace(/\/.*$/, '')}`) 
        : cleanChatId,
      inviteLink: inviteLink,
      enabled: true,
      isAutoDetected: false,
      type: cleanChatId.startsWith('-100') ? 'supergroup' : 'channel'
    };
    setBotSettings((prev: any) => {
      const existing = Array.isArray(prev.requiredChannels) ? prev.requiredChannels : [];
      return {
        ...prev,
        forceSubEnabled: true,
        requiredChannels: [...existing, newChan]
      };
    });
    setNewChannelName('');
    setNewChannelChatId('');
    setShowManualAddChannel(false);
    toast.success(`Channel "${newChan.name}" added! Click Save Configuration to apply.`);
  };

  const handleToggleChannel = async (channelId: string, currentEnabled: boolean) => {
    const nextEnabled = !currentEnabled;
    setBotSettings((prev: any) => {
      const existing = Array.isArray(prev.requiredChannels) ? prev.requiredChannels : [];
      const updated = existing.map((c: any) => 
        c.id === channelId ? { ...c, enabled: nextEnabled } : c
      );
      return { ...prev, requiredChannels: updated };
    });

    try {
      await api.toggleChannel(channelId, nextEnabled);
      onRefreshSettings();
      toast.success(nextEnabled ? 'Channel enabled for Force Sub' : 'Channel disabled & excluded from Force Sub');
    } catch (err: any) {
      setBotSettings((prev: any) => {
        const existing = Array.isArray(prev.requiredChannels) ? prev.requiredChannels : [];
        const reverted = existing.map((c: any) => 
          c.id === channelId ? { ...c, enabled: currentEnabled } : c
        );
        return { ...prev, requiredChannels: reverted };
      });
      toast.error(err.message || 'Failed to toggle channel status');
    }
  };

  const handleSyncChannels = async () => {
    setChannelSyncing(true);
    try {
      const res = await api.syncChannels();
      setBotSettings((prev: any) => ({
        ...prev,
        requiredChannels: res.channels
      }));
      onRefreshSettings();
      toast.success(res.message || 'Channels and groups synced successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to auto-detect channels');
    } finally {
      setChannelSyncing(false);
    }
  };

  const handleOpenForceSubTemplate = () => {
    const forceSubTpl = templates['FORCESUB_PROMPT'];
    if (forceSubTpl) {
      setEditingTemplate(forceSubTpl);
      setTemplateContent(forceSubTpl.content);
      setTemplateMediaType(forceSubTpl.mediaType || 'none');
      setTemplateMediaUrl(forceSubTpl.mediaUrl || '');
    } else {
      setSubView('templates');
    }
  };

  const handleRemoveForceSubChannel = (channelId: string) => {
    setBotSettings((prev: any) => {
      const existing = Array.isArray(prev.requiredChannels) ? prev.requiredChannels : [];
      return {
        ...prev,
        requiredChannels: existing.filter((c: any) => c.id !== channelId)
      };
    });
    toast.info('Channel removed. Click Save Configuration to apply changes.');
  };

  // Save settings & Webhook
  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSettingSaving(true);
    setBotStatusMsg(null);
    try {
      const payload = {
        ...botSettings,
        forceSubEnabled: Boolean(botSettings.forceSubEnabled),
        antiForwardEnabled: Boolean(botSettings.antiForwardEnabled),
        autoApproveJoinRequests: botSettings.autoApproveJoinRequests !== false,
        requiredChannels: Array.isArray(botSettings.requiredChannels) ? botSettings.requiredChannels : []
      };
      const res = await api.updateSettings(payload);
      if (res && res.settings) {
        setBotSettings((prev: any) => ({
          ...prev,
          ...res.settings,
          forceSubEnabled: res.settings.forceSubEnabled ?? false,
          antiForwardEnabled: res.settings.antiForwardEnabled ?? false,
          autoApproveJoinRequests: res.settings.autoApproveJoinRequests ?? true,
          requiredChannels: Array.isArray(res.settings.requiredChannels) ? res.settings.requiredChannels : []
        }));
      }
      onRefreshSettings();
      setBotStatusMsg({ type: 'success', text: 'Bot settings updated successfully!' });
      toast.success('Bot settings updated successfully!');
    } catch (err: any) {
      const errText = err.message || 'Failed to update settings';
      setBotStatusMsg({ type: 'error', text: errText });
      toast.error(errText);
    } finally {
      setSettingSaving(false);
    }
  };

  const handleRegisterWebhook = async () => {
    if (!webhookAppUrl.trim()) {
      setWebhookStatusMsg({ type: 'error', text: 'Please enter a valid Application URL' });
      toast.error('Please enter a valid Application URL');
      return;
    }
    setWebhookLoading(true);
    setWebhookStatusMsg(null);
    try {
      const res = await api.setWebhook(webhookAppUrl.trim());
      if (res.ok) {
        setWebhookStatusMsg({ type: 'success', text: 'Telegram webhook registered successfully!' });
        toast.success('Telegram webhook registered successfully!');
      } else {
        const errText = res.description || 'Webhook registration error';
        setWebhookStatusMsg({ type: 'error', text: errText });
        toast.error(errText);
      }
    } catch (err: any) {
      const errText = err.message || 'Webhook failed';
      setWebhookStatusMsg({ type: 'error', text: errText });
      toast.error(errText);
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleCheckBotInfo = async () => {
    setWebhookLoading(true);
    setWebhookStatusMsg(null);
    try {
      const res = await api.getBotInfo();
      if (res.ok && res.result) {
        setWebhookStatusMsg({
          type: 'success',
          text: `Connected: @${res.result.username} (${res.result.first_name || 'Bot'})`,
          details: res.result
        });
      } else {
        setWebhookStatusMsg({ type: 'error', text: res.description || 'Bot token invalid or unreachable' });
      }
    } catch (err: any) {
      setWebhookStatusMsg({ type: 'error', text: err.message || 'Connection test failed' });
    } finally {
      setWebhookLoading(false);
    }
  };

  // Broadcast Handlers
  const handleSendBroadcast = async () => {
    if (broadcastMediaType === 'text' && !broadcastMessage.trim()) {
      alert('Please enter a notification message to broadcast.');
      return;
    }
    if (broadcastMediaType !== 'text' && broadcastMediaSource === 'upload' && !broadcastFile) {
      alert('Please select a media file to upload from your device.');
      return;
    }
    if (broadcastMediaType !== 'text' && broadcastMediaSource === 'url' && !broadcastMediaUrl.trim()) {
      alert('Please enter a media URL or Telegram file_id.');
      return;
    }

    if (!confirm(`Are you sure you want to send this broadcast to all ${broadcastUsersCount || 'registered'} users now?`)) {
      return;
    }

    setBroadcastSending(true);
    setBroadcastResult(null);

    try {
      let res;
      if (broadcastMediaType !== 'text' && broadcastMediaSource === 'upload' && broadcastFile) {
        const formData = new FormData();
        formData.append('media', broadcastFile);
        formData.append('mediaType', broadcastMediaType);
        if (broadcastMessage.trim()) formData.append('message', broadcastMessage.trim());
        if (broadcastPin) formData.append('pinMessage', 'true');
        res = await api.sendBroadcast(formData);
      } else {
        res = await api.sendBroadcast({
          mediaType: broadcastMediaType,
          message: broadcastMessage.trim() || undefined,
          mediaUrl: (broadcastMediaType !== 'text' && broadcastMediaSource === 'url') ? broadcastMediaUrl.trim() : undefined,
          pinMessage: broadcastPin
        });
      }

      setBroadcastResult({
        type: 'success',
        text: res.message,
        details: { total: res.total, sent: res.sent, failed: res.failed }
      });
    } catch (err: any) {
      setBroadcastResult({
        type: 'error',
        text: err.message || 'Failed to send broadcast'
      });
    } finally {
      setBroadcastSending(false);
    }
  };

  const handleTestBroadcast = async () => {
    if (broadcastMediaType === 'text' && !broadcastMessage.trim()) {
      alert('Please enter a notification message to test.');
      return;
    }
    if (broadcastMediaType !== 'text' && broadcastMediaSource === 'upload' && !broadcastFile) {
      alert('Please select a media file to upload.');
      return;
    }
    if (broadcastMediaType !== 'text' && broadcastMediaSource === 'url' && !broadcastMediaUrl.trim()) {
      alert('Please enter a media URL or Telegram file_id.');
      return;
    }

    setBroadcastTesting(true);
    setBroadcastResult(null);

    try {
      let res;
      if (broadcastMediaType !== 'text' && broadcastMediaSource === 'upload' && broadcastFile) {
        const formData = new FormData();
        formData.append('media', broadcastFile);
        formData.append('mediaType', broadcastMediaType);
        if (broadcastMessage.trim()) formData.append('message', broadcastMessage.trim());
        if (broadcastPin) formData.append('pinMessage', 'true');
        res = await api.sendTestBroadcast(formData);
      } else {
        res = await api.sendTestBroadcast({
          mediaType: broadcastMediaType,
          message: broadcastMessage.trim() || undefined,
          mediaUrl: (broadcastMediaType !== 'text' && broadcastMediaSource === 'url') ? broadcastMediaUrl.trim() : undefined,
          pinMessage: broadcastPin
        });
      }

      setBroadcastResult({
        type: 'success',
        text: res.message
      });
    } catch (err: any) {
      setBroadcastResult({
        type: 'error',
        text: err.message || 'Test broadcast failed'
      });
    } finally {
      setBroadcastTesting(false);
    }
  };

  // -------------------------------------------------------------
  // SUB-VIEW: MENU
  // -------------------------------------------------------------
  if (subView === 'menu') {
    return (
      <div className="space-y-4 pb-28">
        {/* Admin Profile Header Card (Smooth Capsule Rounded Style with 7-Tap Webhook Setup Gesture) */}
        <div 
          onClick={handleHeaderSecretTap}
          title="Admin Profile"
          className={`glass-panel rounded-full py-3.5 px-5 border shadow-lg flex items-center justify-between gap-3 cursor-pointer select-none active:scale-[0.985] transition-all duration-200 ${
            gestureFeedback
              ? 'border-emerald-500/80 bg-emerald-950/40 shadow-[0_0_30px_rgba(16,185,129,0.4)]'
              : 'border-zinc-800/90 bg-gradient-to-r from-zinc-900/95 via-[#101018]/90 to-zinc-900/95 hover:border-zinc-700/80'
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Official Telegram Logo Avatar */}
            <div className="w-11 h-11 shrink-0 rounded-full overflow-hidden flex items-center justify-center shadow-md shadow-sky-500/20 bg-[#229ED9]">
              <svg viewBox="0 0 48 48" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="24" r="24" fill="url(#tg_more_card_grad)" />
                <path fillRule="evenodd" clipRule="evenodd" d="M10.2 23.3C18.6 19.6 24.2 17.1 27.1 15.9C35.2 12.5 36.9 11.9 38 11.9C38.2 11.9 38.8 12 39.2 12.3C39.5 12.6 39.6 13 39.6 13.3C39.6 13.6 39.6 14.2 39.5 14.9L34.3 39.5C33.9 41.3 32.8 41.8 31.3 40.9L23.4 35.1L19.6 38.8C19.2 39.2 18.8 39.6 18 39.6L18.6 31.1L34.1 17.1C34.8 16.5 33.9 16.1 33 16.7L13.8 28.8L5.6 26.2C3.8 25.6 3.8 24.4 6 23.5L10.2 23.3Z" fill="white" />
                <defs>
                  <linearGradient id="tg_more_card_grad" x1="24" y1="0" x2="24" y2="48" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#2AABEE" />
                    <stop offset="1" stopColor="#229ED9" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">
                {currentUser.name}
              </div>
              <div className="text-xs text-zinc-400 font-mono mt-0.5 truncate">
                ID: {currentUser.telegramId}
              </div>
            </div>
          </div>

          {/* Strictly Plain Text Role Badge (No emojis or symbols attached) */}
          <div className="shrink-0 text-right pr-1">
            <span className={`text-xs font-bold tracking-wide ${
              currentUser.role?.toLowerCase() === 'owner' ? 'text-amber-400' : 'text-zinc-300'
            }`}>
              {currentUser.role?.toLowerCase() === 'owner' ? 'Owner' : 'Admin'}
            </span>
          </div>
        </div>

        {/* Menu Items */}
        <div className="glass-panel rounded-2xl divide-y divide-zinc-800/80 border border-zinc-800 overflow-hidden">
          {/* Templates */}
          <button
            onClick={() => setSubView('templates')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Message Templates</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* Admins */}
          <button
            onClick={() => setSubView('admins')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Sub-Admins &amp; Permissions</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* Bot Settings */}
          <button
            onClick={() => setSubView('settings')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Bot Settings</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* Broadcast Notification System */}
          <button
            onClick={() => setSubView('broadcast')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500/20 to-rose-600/20 text-red-400 flex items-center justify-center border border-red-500/30">
                <Megaphone className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>Broadcast System</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-red-500/20 text-red-300 font-mono font-semibold">
                    {broadcastUsersCount > 0 ? `${broadcastUsersCount} Users` : 'Rich Media'}
                  </span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* User Reports & Moderation */}
          <button
            onClick={() => setSubView('reports')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20">
                <Flag className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>User Reports</span>
                  {reportsList.filter(r => r.status === 'pending').length > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-rose-500/30 text-rose-300 font-mono font-semibold animate-pulse">
                      {reportsList.filter(r => r.status === 'pending').length} Pending
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-zinc-800 text-zinc-400 font-mono">
                      {reportsList.length} Total
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* Fraud Protection & Word Filter */}
          <button
            onClick={() => setSubView('fraud')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>Fraud &amp; Word Filter</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300 font-mono font-semibold">
                    {fraudRulesList.filter(r => r.enabled).length} Active Rules
                  </span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* Backup Server & Live Failover Mirror */}
          <button
            onClick={() => setSubView('backup')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>Backup Server</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono font-semibold ${
                    backupConfig?.role === 'backup'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : backupConfig?.enabled
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                  }`}>
                    {backupConfig?.role === 'backup' ? 'Silent Mirror' : backupConfig?.enabled ? 'Real-Time Sync' : 'Standby'}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Real-time database &amp; file replication, failover mirror
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* Emoji Store */}
          <button
            onClick={() => setSubView('emoji')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-pink-500/10 text-pink-400 flex items-center justify-center">
                <Smile className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>Emoji Store</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-pink-500/20 text-pink-300 font-mono font-semibold">
                    Hot
                  </span>
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="w-full p-3.5 rounded-2xl glass-panel border border-rose-500/20 text-rose-400 hover:bg-rose-500/10 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out of Admin Portal</span>
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: EMOJI STORE
  // -------------------------------------------------------------
  if (subView === 'emoji') {
    return <EmojiStore onBack={() => setSubView('menu')} />;
  }

  // -------------------------------------------------------------
  // SUB-VIEW: MESSAGE TEMPLATES (Sections 31-34)
  // -------------------------------------------------------------
  if (subView === 'templates') {
    const startTemplate = templates.START_MESSAGE;
    const otherTemplates = Object.values(templates).filter((t) => t.key !== 'START_MESSAGE');

    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <span className="text-xs text-zinc-400">Live Bot Messages</span>
        </div>

        {/* Featured: Start Message Template (/start) */}
        {startTemplate && (
          <div className="p-4 rounded-2xl bg-gradient-to-br from-sky-500/15 via-indigo-500/10 to-zinc-900 border border-red-500/40 shadow-lg space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-sky-300 border border-red-500/30">
                    /start Command
                  </span>
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white">{startTemplate.name}</h3>
              </div>
              <button
                onClick={() => {
                  setEditingTemplate(startTemplate);
                  setTemplateContent(startTemplate.content);
                  setTemplateMediaType(startTemplate.mediaType || 'none');
                  setTemplateMediaUrl(startTemplate.mediaUrl || '');
                }}
                className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit /start Msg</span>
              </button>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs font-mono text-zinc-200 whitespace-pre-wrap">
              {startTemplate.content}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-zinc-400 pt-0.5">
              <span className="text-zinc-500 font-medium">Placeholders:</span>
              {(startTemplate.variables || ['user_name', 'user_id', 'bot_name']).map((v) => (
                <span key={v} className="bg-zinc-800 border border-zinc-700/60 px-1.5 py-0.5 rounded text-red-400 font-mono">
                  {`{${v}}`}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs font-semibold text-zinc-400 px-1 pt-2">
          Other Bot Templates
        </div>

        <div className="space-y-2.5">
          {(otherTemplates.length > 0 ? otherTemplates : Object.values(templates)).map((tpl) => (
            <div
              key={tpl.key}
              className="glass-panel rounded-2xl p-4 border border-zinc-800/80 hover:border-zinc-700/80 transition-all space-y-2"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">{tpl.name}</h4>
                </div>
                <button
                  onClick={() => {
                    setEditingTemplate(tpl);
                    setTemplateContent(tpl.content);
                    setTemplateMediaType(tpl.mediaType || 'none');
                    setTemplateMediaUrl(tpl.mediaUrl || '');
                  }}
                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-red-400 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Template Content Box */}
              <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs font-mono text-zinc-200 whitespace-pre-wrap">
                {tpl.content}
              </div>

              {/* Variables */}
              {tpl.variables?.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-zinc-400 pt-1">
                  <span>Variables:</span>
                  {tpl.variables.map((v) => (
                    <span key={v} className="bg-zinc-800 px-1.5 py-0.5 rounded text-red-400 font-mono">
                      {`{${v}}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {renderTemplateEditModal()}
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: ADMINS & PERMISSIONS (Section 19 & 42)
  // -------------------------------------------------------------
  if (subView === 'admins') {
    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          {currentUser.role === 'owner' && (
            <button
              onClick={() => setShowAddAdmin(true)}
              className="py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Sub-Admin</span>
            </button>
          )}
        </div>

        <div className="space-y-2.5">
          {adminsList.map((adm) => (
            <div key={adm.id} className="glass-panel rounded-2xl p-4 border border-zinc-800/80 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>{adm.name}</span>
                    <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded font-mono">
                      {adm.role}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                    Telegram ID: {adm.telegramId}
                  </div>
                </div>

                {currentUser.role === 'owner' && adm.role !== 'owner' && (
                  <button
                    onClick={() => handleDeleteAdmin(adm.id)}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Permissions list */}
              <div className="pt-2 border-t border-zinc-800/80 text-[11px] text-zinc-400 grid grid-cols-2 gap-1">
                <div>Files View/Add: {adm.permissions?.files_view ? '✅' : '❌'}</div>
                <div>Files Delete: {adm.permissions?.files_delete ? '✅' : '❌'}</div>
                <div>Links View/Add: {adm.permissions?.links_view ? '✅' : '❌'}</div>
                <div>Messages Edit: {adm.permissions?.messages_edit ? '✅' : '❌'}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Add Sub Admin Modal */}
        {showAddAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <div className="glass-panel w-full max-w-sm rounded-3xl p-5 border border-zinc-700 space-y-3.5">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-sm">Add New Sub-Admin</h4>
                <button onClick={() => setShowAddAdmin(false)} className="text-zinc-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateAdmin} className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Name</label>
                  <input
                    type="text"
                    required
                    value={newAdminData.name}
                    onChange={(e) => setNewAdminData({ ...newAdminData, name: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Telegram User ID</label>
                  <input
                    type="text"
                    required
                    value={newAdminData.telegramId}
                    onChange={(e) => setNewAdminData({ ...newAdminData, telegramId: e.target.value })}
                    placeholder="e.g. 987654321"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={newAdminData.password}
                    onChange={(e) => setNewAdminData({ ...newAdminData, password: e.target.value })}
                    placeholder="Min 6 characters"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-2 text-xs text-white"
                  />
                </div>

                {/* Permissions Toggles */}
                <div className="pt-2 border-t border-zinc-800 space-y-1.5 text-xs text-zinc-300">
                  <div className="font-semibold text-zinc-400 text-[11px]">Server-Enforced Permissions:</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAdminData.permissions.files_delete}
                      onChange={(e) =>
                        setNewAdminData({
                          ...newAdminData,
                          permissions: { ...newAdminData.permissions, files_delete: e.target.checked }
                        })
                      }
                      className="rounded accent-sky-500"
                    />
                    <span>Allow Delete Files</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAdminData.permissions.messages_edit}
                      onChange={(e) =>
                        setNewAdminData({
                          ...newAdminData,
                          permissions: { ...newAdminData.permissions, messages_edit: e.target.checked }
                        })
                      }
                      className="rounded accent-sky-500"
                    />
                    <span>Allow Edit Message Templates</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAdminData.permissions.cleanup_manage}
                      onChange={(e) =>
                        setNewAdminData({
                          ...newAdminData,
                          permissions: { ...newAdminData.permissions, cleanup_manage: e.target.checked }
                        })
                      }
                      className="rounded accent-sky-500"
                    />
                    <span>Allow Trigger Message Cleanup</span>
                  </label>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAdmin(false)}
                    className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-red-600/30 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-blue-600/30 transition-colors"
                  >
                    Create Admin
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: MESSAGE CLEANUP (Section 41)
  // -------------------------------------------------------------
  if (subView === 'cleanup') {
    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <span className="text-xs text-zinc-400">Persistent Cleanup</span>
        </div>

        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Trash2 className="w-4 h-4 text-emerald-400" />
            <span>Bot Message Limit &amp; Cleanup</span>
          </div>
          <p className="text-xs text-zinc-400">
            Enforces a maximum of 10 bot-generated messages per group chat. When the 11th bot message is generated, the oldest bot message is deleted automatically.
          </p>

          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1.5 text-xs text-zinc-300">
            <div className="flex justify-between">
              <span className="text-zinc-400">Max bot messages per chat:</span>
              <span className="font-semibold text-white">10 messages</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Tracked bot messages:</span>
              <span className="font-semibold text-red-400">{cleanupStatus?.trackedMessagesCount || 0} messages</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">User message protection:</span>
              <span className="font-semibold text-emerald-400">Never touched</span>
            </div>
          </div>

          {cleanupMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
              {cleanupMsg}
            </div>
          )}

          <button
            onClick={handleRunCleanup}
            disabled={cleanupRunning}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {cleanupRunning ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Run Cleanup Now (24h+ Old Messages)</span>
              </>
            )}
          </button>
        </div>

        {/* Delivery Files Auto-Destruct Status */}
        <div className="glass-panel rounded-2xl p-4 border border-rose-500/30 bg-rose-950/10 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Clock className="w-4 h-4 text-rose-400" />
            <span>Delivery File Auto-Destruct (10-Minute Timeout)</span>
          </div>
          <p className="text-xs text-zinc-400">
            Files delivered in Telegram private chat will automatically be deleted from chat after the configured timeout period (default: 10 minutes).
          </p>

          <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2 text-xs text-zinc-300">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Auto-delete status:</span>
              <span className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${cleanupStatus?.autoDeleteDeliveryEnabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400'}`}>
                {cleanupStatus?.autoDeleteDeliveryEnabled ? 'Active' : 'Disabled'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Timeout duration:</span>
              <span className="font-semibold text-rose-400">{cleanupStatus?.deliveryTimeoutMinutes || 10} Minutes</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Active pending self-destruct timers:</span>
              <span className="font-semibold text-amber-400">{cleanupStatus?.pendingScheduledDeletionsCount || 0} files</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: SETTINGS & BOT (Sections 51 & 58)
  // -------------------------------------------------------------
  if (subView === 'settings') {
    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <span className="text-xs text-zinc-400">Bot Settings</span>
        </div>

        {botStatusMsg && (
          <div
            className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
              botStatusMsg.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
            }`}
          >
            {botStatusMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <span>{botStatusMsg.text}</span>
          </div>
        )}

        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-4">
          <form onSubmit={handleSaveSettings} className="space-y-3.5">
            {/* Delivery Auto-Remove / Timeout Settings */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-rose-950/20 via-zinc-900/80 to-zinc-950/90 border border-rose-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Delivery File Auto-Delete (Timeout)</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={botSettings.autoDeleteDeliveryEnabled}
                    onChange={(e) => setBotSettings({ ...botSettings, autoDeleteDeliveryEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500"></div>
                </label>
              </div>

              {botSettings.autoDeleteDeliveryEnabled && (
                <div className="space-y-2.5 pt-1 border-t border-rose-500/20 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Delivery Timeout (Minutes)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="1440"
                        value={botSettings.deliveryTimeoutMinutes}
                        onChange={(e) => setBotSettings({ ...botSettings, deliveryTimeoutMinutes: Math.max(1, Number(e.target.value) || 10) })}
                        placeholder="e.g. 10"
                        className="w-24 bg-zinc-900 border border-zinc-700 rounded-xl py-1.5 px-3 text-xs text-white font-mono font-bold"
                      />
                      <span className="text-rose-400 font-semibold text-xs">Minutes</span>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={botSettings.autoDeleteNoticeEnabled}
                      onChange={(e) => setBotSettings({ ...botSettings, autoDeleteNoticeEnabled: e.target.checked })}
                      className="rounded accent-rose-500"
                    />
                    <span>Send self-destruct warning notice message with the file</span>
                  </label>
                </div>
              )}
            </div>

            {/* Bot Maintenance Mode Toggle & Editable Custom Maintenance Notice */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-amber-950/25 via-zinc-900/80 to-zinc-950/90 border border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>Bot Maintenance Mode</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                        botSettings.maintenanceMode 
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      }`}>
                        {botSettings.maintenanceMode ? 'ACTIVE (OFFLINE)' : 'ONLINE'}
                      </span>
                    </div>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={botSettings.maintenanceMode}
                    onChange={(e) => setBotSettings({ ...botSettings, maintenanceMode: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>

              {/* Maintenance Notice Customization Input with Dynamic Variable Support */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Maintenance Notice
                  </label>
                  <span className="text-[10px] text-amber-400 font-mono">Dynamic Tags</span>
                </div>
                <textarea
                  rows={2}
                  value={botSettings.maintenanceNotice || ''}
                  onChange={(e) => setBotSettings({ ...botSettings, maintenanceNotice: e.target.value })}
                  placeholder="e.g. ⚠️ Hello @username! {bot_name} is under maintenance. User ID: {user_id}"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-2.5 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
                />
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {[
                    { tag: '@username', label: '@username' },
                    { tag: '{user_id}', label: '{user_id}' },
                    { tag: '{bot_name}', label: '{bot_name}' },
                    { tag: '{name}', label: '{name}' },
                  ].map(({ tag, label }) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const current = botSettings.maintenanceNotice || '';
                        const spacer = current.length > 0 && !current.endsWith(' ') ? ' ' : '';
                        setBotSettings({
                          ...botSettings,
                          maintenanceNotice: `${current}${spacer}${tag}`
                        });
                      }}
                      className="px-2 py-0.5 rounded-md bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-[10px] font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer"
                      title={`Click to insert ${tag}`}
                    >
                      +{label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Anti-Forward Protection System (Block & Auto-Delete Forwarded Messages) */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-violet-950/25 via-zinc-900/80 to-zinc-950/90 border border-violet-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>Anti-Forward Protection</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                        botSettings.antiForwardEnabled 
                          ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' 
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}>
                        {botSettings.antiForwardEnabled ? 'ACTIVE (BLOCKING)' : 'DISABLED'}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      Detect and instantly delete any forwarded messages from other chats, channels, or users in connected groups
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={botSettings.antiForwardEnabled || false}
                    onChange={(e) => setBotSettings((prev: any) => ({ ...prev, antiForwardEnabled: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
                </label>
              </div>
            </div>

            {/* Force Sub / Mandatory Channel Join System */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-950/25 via-zinc-900/80 to-zinc-950/90 border border-indigo-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>Mandatory Channel Join (Force Sub)</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                        botSettings.forceSubEnabled 
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' 
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}>
                        {botSettings.forceSubEnabled ? 'ACTIVE (FORCED)' : 'OFF'}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      Require users to subscribe to specific channels/groups before accessing bot files
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={botSettings.forceSubEnabled || false}
                    onChange={(e) => setBotSettings((prev: any) => ({ ...prev, forceSubEnabled: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                </label>
              </div>

              {botSettings.forceSubEnabled && (
                <div className="space-y-3.5 pt-2 border-t border-indigo-500/20">
                  {/* Action Bar: Connect Command Guide & Edit Message Template */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-zinc-950/70 border border-indigo-500/20">
                    <div className="flex items-center gap-2 text-xs text-indigo-300 font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>Chat Connection &amp; Templates</span>
                      <span className="hidden sm:inline-flex text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                        /connect &lt;chat_id_or_username&gt;
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleOpenForceSubTemplate}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-indigo-300 hover:text-indigo-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-zinc-700/80"
                        title="Edit Force Sub Message in Message Templates"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit Msg Template</span>
                      </button>
                    </div>
                  </div>

                  {/* Private Channels & Groups: Join Request & Auto-Approval Settings */}
                  <div className="p-3 rounded-xl bg-zinc-950/70 border border-emerald-500/30 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>Auto-Approve Join Requests</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              SMART AUTO-APPROVAL
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-400 mt-0.5">
                            Automatically accept join requests for private channels &amp; groups and verify user access instantly
                          </p>
                        </div>
                      </div>

                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={botSettings.autoApproveJoinRequests !== false}
                          onChange={(e) => setBotSettings((prev: any) => ({ ...prev, autoApproveJoinRequests: e.target.checked }))}
                          className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                      </label>
                    </div>

                    {/* Join Request Records Drawer / Stats */}
                    <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                        <span className="text-zinc-300 font-medium">Join Requests Recorded:</span>
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 font-mono text-white text-[10px] border border-zinc-700">
                          {joinRequests.length}
                        </span>
                        {joinRequests.filter(r => r.status === 'approved').length > 0 && (
                          <span className="text-[10px] text-emerald-400 font-semibold">
                            ({joinRequests.filter(r => r.status === 'approved').length} approved)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => loadJoinRequests()}
                          disabled={loadingJoinRequests}
                          className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                          title="Refresh Join Requests"
                        >
                          <RefreshCw className={`w-3 h-3 ${loadingJoinRequests ? 'animate-spin text-emerald-400' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowJoinRequests(!showJoinRequests)}
                          className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <span>{showJoinRequests ? 'Hide Details' : 'View Log'}</span>
                        </button>
                      </div>
                    </div>

                    {showJoinRequests && (
                      <div className="mt-2 pt-2 border-t border-zinc-800/80 space-y-2 max-h-60 overflow-y-auto">
                        {joinRequests.length === 0 ? (
                          <div className="p-3 rounded-lg bg-zinc-900/60 text-center text-xs text-zinc-400 italic">
                            No join requests received yet. When users submit join requests to private channels, they will be logged and approved here.
                          </div>
                        ) : (
                          joinRequests.slice(0, 15).map((req) => (
                            <div
                              key={req.id}
                              className="p-2 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-white truncate">
                                    {req.userName || 'User'}
                                  </span>
                                  {req.userUsername && (
                                    <span className="text-[10px] text-zinc-400 truncate">
                                      {req.userUsername}
                                    </span>
                                  )}
                                  <span className="text-[9px] font-mono text-zinc-400 bg-zinc-800 px-1 rounded">
                                    ID: {req.userId}
                                  </span>
                                </div>
                                <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                                  Channel: <span className="text-zinc-300 font-medium">{req.chatTitle || req.chatId}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                  req.status === 'approved'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                }`}>
                                  {req.status === 'approved' ? 'APPROVED ✅' : 'PENDING ⏳'}
                                </span>
                                {req.status === 'pending' && (
                                  <button
                                    type="button"
                                    onClick={() => handleApproveJoinRequest(req.chatId, req.userId)}
                                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold transition-all cursor-pointer"
                                  >
                                    Approve
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* List of Detected & Configured Channels / Groups */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <label className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                          <span>Channels & Groups List</span>
                          <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                            {(botSettings.requiredChannels || []).filter((c: any) => c.enabled !== false).length} active of {(botSettings.requiredChannels || []).length}
                          </span>
                        </label>
                      </div>
                      <span className="text-[10px] text-zinc-400">Toggle switch ON/OFF to include or exclude</span>
                    </div>

                    {(!botSettings.requiredChannels || botSettings.requiredChannels.length === 0) ? (
                      <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-center space-y-2">
                        <div className="text-xs text-zinc-400">
                          No connected channels or groups yet.
                        </div>
                        <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">
                          Add the bot as an administrator to your Telegram channel or group, then send <code className="text-indigo-400 font-mono">/connect &lt;chat_id_or_username&gt;</code> to register it instantly!
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {botSettings.requiredChannels.map((ch: any) => {
                          const isChanActive = ch.enabled !== false;
                          const isAuto = ch.isAutoDetected !== false;
                          const channelType = ch.type || (String(ch.chatId).startsWith('-100') ? 'supergroup' : 'channel');

                          return (
                            <div
                              key={ch.id}
                              className={`p-3 rounded-xl border transition-all text-xs flex items-center justify-between gap-3 ${
                                isChanActive 
                                  ? 'bg-zinc-950/80 border-indigo-500/40 shadow-sm' 
                                  : 'bg-zinc-900/40 border-zinc-800/60 opacity-60'
                              }`}
                            >
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-white text-xs truncate">
                                    {ch.name}
                                  </span>

                                  {/* Type Badge */}
                                  <span className="text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                                    {channelType === 'supergroup' ? '👥 Supergroup' : channelType === 'group' ? '👥 Group' : '📢 Channel'}
                                  </span>

                                  {/* Auto-detected pill */}
                                  {isAuto && (
                                    <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                      ⚡ Auto-Detected
                                    </span>
                                  )}

                                  {/* Active / Excluded status pill */}
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded ${
                                    isChanActive
                                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                  }`}>
                                    {isChanActive ? '✓ Required for Users' : '✕ Excluded / Off'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                                  <span className="font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.2 rounded border border-indigo-500/20 truncate">
                                    {ch.chatId}
                                  </span>

                                  {ch.inviteLink && (
                                    <a
                                      href={ch.inviteLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-zinc-400 hover:text-indigo-300 truncate inline-flex items-center gap-1 transition-colors"
                                    >
                                      <span>{ch.inviteLink}</span>
                                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                    </a>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {/* Toggle Switch (ON / OFF) */}
                                <label className="relative inline-flex items-center cursor-pointer" title={isChanActive ? "Click to exclude channel" : "Click to require channel"}>
                                  <input
                                    type="checkbox"
                                    checked={isChanActive}
                                    onChange={() => handleToggleChannel(ch.id, isChanActive)}
                                    className="sr-only peer"
                                  />
                                  <div className="w-8 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>

                                {/* Delete / Remove Button */}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveForceSubChannel(ch.id)}
                                  className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                                  title="Remove from list"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Manual Add Collapsible Toggle */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowManualAddChannel(!showManualAddChannel)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1.5 cursor-pointer py-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{showManualAddChannel ? 'Hide Manual Add Form' : 'Add Channel / Group Manually'}</span>
                    </button>

                    {showManualAddChannel && (
                      <div className="mt-2 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
                        <div className="text-[11px] font-bold text-indigo-300 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Channel / Group by ID or Username</span>
                          </span>
                          <span className="text-[10px] text-zinc-400 font-normal">No invite link required</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-zinc-400 mb-1 block">Chat ID or Username *</label>
                            <input
                              type="text"
                              value={newChannelChatId}
                              onChange={(e) => setNewChannelChatId(e.target.value)}
                              placeholder="@channel or -100xxxxxxxxxx"
                              className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg p-2 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-400 mb-1 block">Channel Name (Optional)</label>
                            <input
                              type="text"
                              value={newChannelName}
                              onChange={(e) => setNewChannelName(e.target.value)}
                              placeholder="e.g. VIP Channel (auto-named if blank)"
                              className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg p-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <p className="text-[10px] text-zinc-400">
                            💡 You can also send <code className="text-indigo-300">/connect &lt;channel_id&gt;</code> directly in Telegram.
                          </p>
                          <button
                            type="button"
                            onClick={handleAddForceSubChannel}
                            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Channel</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Telegram Inline Button Theme Preview (Showing only active channels) */}
                  {Array.isArray(botSettings.requiredChannels) && botSettings.requiredChannels.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-indigo-500/30 space-y-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center justify-between">
                        <span>Telegram Inline Button Theme Preview</span>
                        <span className="text-zinc-400 font-normal">
                          {(botSettings.requiredChannels || []).filter((c: any) => c.enabled !== false).length} active channel(s)
                        </span>
                      </div>

                      {(() => {
                        const activeChannels = (botSettings.requiredChannels || []).filter((c: any) => c.enabled !== false);
                        if (activeChannels.length === 0) {
                          return (
                            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-center text-xs text-zinc-400 italic">
                              All channel toggles are currently turned OFF. Users will bypass verification until a channel is enabled.
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-1.5 pt-0.5">
                            {activeChannels.map((c: any) => (
                              <div
                                key={c.id}
                                className="w-full py-2 px-3 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm border border-blue-500/40 select-none"
                              >
                                <span>📢 Join {c.name || 'Channel'} ↗️</span>
                              </div>
                            ))}
                            <div className="w-full py-2 px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm border border-emerald-500/40 select-none">
                              <span>🔄 Verify / Try Again ✅</span>
                            </div>
                          </div>
                        );
                      })()}

                      <p className="text-[10px] text-zinc-400 text-center pt-0.5 italic">
                        Styled with primary link accents and success confirmation theme matching the bot.
                      </p>
                    </div>
                  )}

                  {/* Quick Save Force Sub Button */}
                  <div className="pt-2 border-t border-indigo-500/20 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      {(botSettings.requiredChannels || []).filter((c: any) => c.enabled !== false).length} active channel(s) in mandatory join list
                    </span>
                    <button
                      type="button"
                      disabled={settingSaving}
                      onClick={() => handleSaveSettings()}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{settingSaving ? 'Saving...' : 'Save Channels'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={settingSaving}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-blue-600/30 disabled:opacity-50 transition-colors"
            >
              {settingSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: WEBHOOK SETUP (Standalone Section)
  // -------------------------------------------------------------
  if (subView === 'webhook') {
    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <span className="text-xs text-zinc-400">Webhook Setup</span>
        </div>

        {webhookStatusMsg && (
          <div
            className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
              webhookStatusMsg.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
            }`}
          >
            {webhookStatusMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-semibold">{webhookStatusMsg.text}</div>
              {webhookStatusMsg.details && (
                <div className="text-[11px] font-mono text-zinc-300 bg-zinc-950/70 p-2 rounded-lg border border-zinc-800 space-y-0.5">
                  <div>Bot Name: {webhookStatusMsg.details.first_name}</div>
                  <div>Username: @{webhookStatusMsg.details.username}</div>
                  <div>Bot ID: {webhookStatusMsg.details.id}</div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">
              Application Webhook URL
            </label>
            <input
              type="text"
              value={webhookAppUrl}
              onChange={(e) => setWebhookAppUrl(e.target.value)}
              placeholder="e.g. https://your-app-domain.com"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={handleCheckBotInfo}
              disabled={webhookLoading}
              className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              {webhookLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>Test Bot Token</span>
            </button>
            <button
              type="button"
              onClick={handleRegisterWebhook}
              disabled={webhookLoading}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-blue-600/30 disabled:opacity-50 transition-colors"
            >
              {webhookLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              <span>Set Webhook</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: BROADCAST SYSTEM (Rich Media: Photo, Video, Audio, Voice, Text)
  // -------------------------------------------------------------
  if (subView === 'broadcast') {
    return (
      <div className="space-y-4 pb-28">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('settings')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>← Back to Settings</span>
          </button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{broadcastUsersCount} Reachable Users</span>
          </div>
        </div>

        {/* Broadcast Container */}
        <div className="glass-panel rounded-3xl p-5 border border-zinc-800 space-y-4 shadow-xl">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-500/20 to-rose-600/30 text-red-400 border border-red-500/40 flex items-center justify-center shrink-0 shadow-md shadow-red-500/10">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">Mass Broadcast Notification</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 font-mono font-semibold">
                  All Media
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Dispatch rich notifications and announcements to all bot users in direct message. Strictly supports all rich media types.
              </p>
            </div>
          </div>

          {/* 1. Media Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Select Notification Type *
            </label>
            <div className="grid grid-cols-5 gap-1.5 p-1 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <button
                type="button"
                onClick={() => {
                  setBroadcastMediaType('text');
                  setBroadcastFile(null);
                  setBroadcastMediaUrl('');
                }}
                className={`py-2 px-1 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  broadcastMediaType === 'text'
                    ? 'bg-red-500/20 text-sky-300 border border-red-500/40 shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-[11px]">Text</span>
              </button>

              <button
                type="button"
                onClick={() => setBroadcastMediaType('photo')}
                className={`py-2 px-1 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  broadcastMediaType === 'photo'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                <span className="text-[11px]">Photo</span>
              </button>

              <button
                type="button"
                onClick={() => setBroadcastMediaType('video')}
                className={`py-2 px-1 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  broadcastMediaType === 'video'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <VideoIcon className="w-4 h-4" />
                <span className="text-[11px]">Video</span>
              </button>

              <button
                type="button"
                onClick={() => setBroadcastMediaType('audio')}
                className={`py-2 px-1 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  broadcastMediaType === 'audio'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Music className="w-4 h-4" />
                <span className="text-[11px]">Audio</span>
              </button>

              <button
                type="button"
                onClick={() => setBroadcastMediaType('voice')}
                className={`py-2 px-1 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                  broadcastMediaType === 'voice'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Mic className="w-4 h-4" />
                <span className="text-[11px]">Voice</span>
              </button>
            </div>
          </div>

          {/* 2. Media Source Selection & File Picker (When mediaType !== 'text') */}
          {broadcastMediaType !== 'text' && (
            <div className="p-3.5 rounded-2xl bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  {broadcastMediaType === 'photo' && <ImageIcon className="w-4 h-4 text-rose-400" />}
                  {broadcastMediaType === 'video' && <VideoIcon className="w-4 h-4 text-purple-400" />}
                  {broadcastMediaType === 'audio' && <Music className="w-4 h-4 text-amber-400" />}
                  {broadcastMediaType === 'voice' && <Mic className="w-4 h-4 text-emerald-400" />}
                  <span className="capitalize">{broadcastMediaType} Media Source</span>
                </span>

                <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setBroadcastMediaSource('upload')}
                    className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                      broadcastMediaSource === 'upload'
                        ? 'bg-red-500/20 text-sky-300 border border-red-500/30'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => setBroadcastMediaSource('url')}
                    className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                      broadcastMediaSource === 'url'
                        ? 'bg-red-500/20 text-sky-300 border border-red-500/30'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    URL / File ID
                  </button>
                </div>
              </div>

              {/* Upload from Gallery / Device */}
              {broadcastMediaSource === 'upload' && (
                <div className="space-y-2">
                  <label className="w-full py-4 px-4 rounded-xl border border-dashed border-zinc-700 hover:border-red-500/50 bg-zinc-900/60 hover:bg-zinc-900 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all">
                    <Paperclip className="w-5 h-5 text-red-400" />
                    <span className="text-xs font-semibold text-white">
                      {broadcastFile ? broadcastFile.name : `Select ${broadcastMediaType.toUpperCase()} from Device`}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {broadcastMediaType === 'photo' && 'Supports JPG, PNG, WEBP (gallery photos)'}
                      {broadcastMediaType === 'video' && 'Supports MP4, MOV, MKV, WebM video clips'}
                      {broadcastMediaType === 'audio' && 'Supports MP3, M4A, WAV audio files'}
                      {broadcastMediaType === 'voice' && 'Supports OGG, MP3, M4A voice notes'}
                    </span>
                    <input
                      type="file"
                      accept={
                        broadcastMediaType === 'photo' ? 'image/*' :
                        broadcastMediaType === 'video' ? 'video/*' :
                        broadcastMediaType === 'audio' ? 'audio/*' :
                        'audio/*,.ogg,.mp3,.m4a'
                      }
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setBroadcastFile(file);
                        }
                      }}
                    />
                  </label>

                  {broadcastFile && (
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {broadcastMediaType === 'photo' && <ImageIcon className="w-4 h-4 text-rose-400 shrink-0" />}
                        {broadcastMediaType === 'video' && <VideoIcon className="w-4 h-4 text-purple-400 shrink-0" />}
                        {broadcastMediaType === 'audio' && <Music className="w-4 h-4 text-amber-400 shrink-0" />}
                        {broadcastMediaType === 'voice' && <Mic className="w-4 h-4 text-emerald-400 shrink-0" />}
                        <div className="truncate text-white font-medium">
                          {broadcastFile.name}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                          ({(broadcastFile.size / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBroadcastFile(null)}
                        className="text-rose-400 hover:text-rose-300 text-[11px] font-semibold cursor-pointer shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* URL or Telegram File ID input */}
              {broadcastMediaSource === 'url' && (
                <div>
                  <input
                    type="text"
                    value={broadcastMediaUrl}
                    onChange={(e) => setBroadcastMediaUrl(e.target.value)}
                    placeholder={`Enter ${broadcastMediaType} URL or Telegram file_id...`}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white font-mono focus:outline-none focus:border-red-500 placeholder:text-zinc-600"
                  />
                  <p className="text-[10px] text-zinc-400 mt-1">
                    Direct public media URL or pre-existing Telegram file_id.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 3. Notification Message / Caption Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300">
                {broadcastMediaType === 'text' ? 'Announcement Message *' : 'Media Caption (Optional)'}
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">
                {broadcastMessage.length} characters
              </span>
            </div>

            <textarea
              rows={4}
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder={
                broadcastMediaType === 'text'
                  ? 'Write your announcement message here... (HTML tags <b>, <i>, <code> supported)'
                  : 'Add an optional caption for this media...'
              }
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30 transition-colors"
            />

            {/* Formatting & Placeholder Helpers */}
            <div className="flex flex-wrap items-center justify-between gap-1 pt-1">
              <div className="flex flex-wrap gap-1">
                {['user_name', 'user_id', 'bot_name'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBroadcastMessage((prev) => `${prev} {${v}}`)}
                    className="bg-zinc-800 border border-zinc-700/80 px-1.5 py-0.5 rounded text-red-400 text-[10px] font-mono hover:bg-zinc-700 cursor-pointer"
                  >
                    +{`{${v}}`}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                <button
                  type="button"
                  onClick={() => setBroadcastMessage((prev) => `${prev}<b>bold text</b>`)}
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastMessage((prev) => `${prev}<i>italic text</i>`)}
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 italic"
                >
                  I
                </button>
                <button
                  type="button"
                  onClick={() => setBroadcastMessage((prev) => `${prev}<code>code</code>`)}
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono"
                >
                  &lt;/&gt;
                </button>
              </div>
            </div>
          </div>

          {/* 4. Broadcast Options (Pin Message) */}
          <div className="p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300">
                <Pin className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Pin Message</div>
                <div className="text-[10px] text-zinc-400">Pin notification at the top of user chat</div>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={broadcastPin}
                onChange={(e) => setBroadcastPin(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500"></div>
            </label>
          </div>

          {/* 5. Result Banner */}
          {broadcastResult && (
            <div
              className={`p-3.5 rounded-2xl text-xs space-y-1.5 animate-in fade-in duration-200 ${
                broadcastResult.type === 'success'
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {broadcastResult.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{broadcastResult.text}</span>
              </div>
              {broadcastResult.details && (
                <div className="text-[11px] text-zinc-300 font-mono pt-1 border-t border-emerald-500/20 flex items-center gap-4">
                  <span>Total: <b>{broadcastResult.details.total}</b></span>
                  <span className="text-emerald-400">Delivered: <b>{broadcastResult.details.sent}</b></span>
                  {broadcastResult.details.failed > 0 && (
                    <span className="text-rose-400">Failed / Blocked: <b>{broadcastResult.details.failed}</b></span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 6. Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleTestBroadcast}
              disabled={broadcastSending || broadcastTesting}
              className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer border border-zinc-700 transition-colors disabled:opacity-50"
            >
              {broadcastTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending Test...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Test to Me</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSendBroadcast}
              disabled={broadcastSending || broadcastTesting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-red-600/30 transition-all disabled:opacity-50 active:scale-95"
            >
              {broadcastSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Broadcasting to {broadcastUsersCount} users...</span>
                </>
              ) : (
                <>
                  <Megaphone className="w-4 h-4" />
                  <span>Broadcast to All Users ({broadcastUsersCount})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: BACKUP SERVER & LIVE FAILOVER MIRROR
  // -------------------------------------------------------------
  if (subView === 'backup') {
    const isPrimaryRole = (backupConfig?.role || 'primary') === 'primary';
    const isBackupRole = backupConfig?.role === 'backup';
    const isFailoverActive = Boolean(backupConfig?.failoverActive);

    return (
      <div className="space-y-4 pb-28">
        {/* Top Header & Back Button */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                isBackupRole
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : backupConfig?.enabled
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
              }`}
            >
              {isBackupRole ? (isFailoverActive ? '⚡ Failover Active' : '🛡️ Silent Backup Mirror') : (backupConfig?.enabled ? '🟢 Real-Time Primary Active' : 'Standby Master')}
            </span>
          </div>
        </div>

        {/* Server Role & Failover Status Banner */}
        <div className={`p-4 rounded-2xl glass-panel border space-y-3 ${
          isBackupRole 
            ? 'bg-gradient-to-br from-amber-950/30 via-zinc-900 to-zinc-950 border-amber-500/30' 
            : 'bg-gradient-to-br from-cyan-950/30 via-zinc-900 to-zinc-950 border-cyan-500/30'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border shadow-md ${
                isBackupRole 
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                  : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
              }`}>
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{isBackupRole ? 'Backup Server (Silent Mirror)' : 'Primary Master Server'}</span>
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {isBackupRole 
                    ? 'Receives all database records, ZIPs, files, users, and templates silently in real-time. Dormant bot listener awaits failover.' 
                    : 'Active server hosting Telegram bot operations. Continuously replicates all data and files to your designated backup mirror.'}
                </p>
              </div>
            </div>

            {/* Quick Refresh */}
            <button
              onClick={loadBackupStatus}
              disabled={backupLoading}
              className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title="Refresh status"
            >
              <RefreshCw className={`w-4 h-4 ${backupLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Role Switcher & Failover Action */}
          <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2.5">
            <div className="text-[11px] text-zinc-300">
              <span className="text-zinc-500">Current Mode: </span>
              <b className={isBackupRole ? 'text-amber-400' : 'text-cyan-400'}>
                {isBackupRole ? 'Standby Failover Copy' : 'Active Primary Source'}
              </b>
            </div>

            <button
              onClick={handleSwitchRole}
              disabled={backupSwitchingRole}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-md active:scale-95 disabled:opacity-50 ${
                isBackupRole
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-black'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
              }`}
            >
              {backupSwitchingRole ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Radio className="w-3.5 h-3.5" />
              )}
              <span>
                {isBackupRole
                  ? (isFailoverActive ? 'Demote to Silent Mirror' : 'ACTIVATE FAILOVER (Promote to Primary)')
                  : 'Switch to Silent Backup Mode'}
              </span>
            </button>
          </div>
        </div>

        {/* Live Mirror Vault & Local Data Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-2xl glass-panel border border-zinc-800 bg-zinc-950/60 space-y-1">
            <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
              <Database className="w-3 h-3 text-cyan-400" />
              <span>Items &amp; Triggers</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              {backupLocalStats?.itemsCount ?? 0}
            </div>
            <div className="text-[9px] text-zinc-500">
              {backupConfig?.mirroredStats?.itemsCount ? `Mirrored: ${backupConfig.mirroredStats.itemsCount}` : 'Fully synced'}
            </div>
          </div>

          <div className="p-3 rounded-2xl glass-panel border border-zinc-800 bg-zinc-950/60 space-y-1">
            <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
              <HardDrive className="w-3 h-3 text-emerald-400" />
              <span>Files &amp; ZIPs</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              {backupLocalStats?.filesCount ?? 0}
            </div>
            <div className="text-[9px] text-zinc-500">
              {backupConfig?.mirroredStats?.filesCount ? `Mirrored: ${backupConfig.mirroredStats.filesCount}` : 'Binary mirrored'}
            </div>
          </div>

          <div className="p-3 rounded-2xl glass-panel border border-zinc-800 bg-zinc-950/60 space-y-1">
            <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
              <Users className="w-3 h-3 text-purple-400" />
              <span>Bot Users</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              {backupLocalStats?.usersCount ?? 0}
            </div>
            <div className="text-[9px] text-zinc-500">
              {backupConfig?.mirroredStats?.usersCount ? `Mirrored: ${backupConfig.mirroredStats.usersCount}` : 'User ledger'}
            </div>
          </div>

          <div className="p-3 rounded-2xl glass-panel border border-zinc-800 bg-zinc-950/60 space-y-1">
            <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              <span>Rules &amp; Reports</span>
            </div>
            <div className="text-base font-bold text-white font-mono">
              {(backupLocalStats?.reportsCount ?? 0) + (backupLocalStats?.rulesCount ?? 0)}
            </div>
            <div className="text-[9px] text-zinc-500">
              Security settings
            </div>
          </div>
        </div>

        {/* Sync Status Feedback Banner */}
        {backupConfig?.lastSyncStatus && (
          <div className={`p-3 rounded-2xl border text-xs flex items-center justify-between gap-3 ${
            backupConfig.lastSyncStatus === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : backupConfig.lastSyncStatus === 'failed'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : backupConfig.lastSyncStatus === 'in_progress'
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              {backupConfig.lastSyncStatus === 'in_progress' ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0 text-cyan-400" />
              ) : backupConfig.lastSyncStatus === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : backupConfig.lastSyncStatus === 'failed' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              ) : (
                <Clock className="w-4 h-4 shrink-0 text-zinc-400" />
              )}
              <div className="truncate">
                <span className="font-semibold block">{backupConfig.lastSyncMessage || 'Ready for replication'}</span>
                {backupConfig.lastSyncAt && (
                  <span className="text-[10px] opacity-75">
                    Last sync: {new Date(backupConfig.lastSyncAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={handleSyncNow}
              disabled={backupSyncing}
              className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50 transition-all active:scale-95"
            >
              {backupSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              <span>Sync Now</span>
            </button>
          </div>
        )}

        {/* Replication Configuration Form */}
        <form onSubmit={handleSaveBackupConfig} className="p-4 rounded-2xl glass-panel border border-zinc-800 space-y-3.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Replication &amp; Mirror Settings
              </h4>
            </div>

            {/* Enable toggle switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={backupEnabled}
                onChange={(e) => setBackupEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
              Designated Backup Server URL <span className="text-rose-400">*</span>
            </label>
            <input
              type="url"
              value={backupServerUrl}
              onChange={(e) => setBackupServerUrl(e.target.value)}
              placeholder="https://backup-bot.yourdomain.com"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <span className="text-[10px] text-zinc-500 mt-1 block">
              The public URL of your secondary bot instance where mirror snapshots are automatically delivered.
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-zinc-300">
                Replication Secret Token <span className="text-rose-400">*</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopySecretKey}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerateNewSecretKey}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  Regenerate
                </button>
              </div>
            </div>
            <input
              type="text"
              value={backupSecretKey}
              onChange={(e) => setBackupSecretKey(e.target.value)}
              placeholder="e.g. bsk_abc123xyz"
              className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <span className="text-[10px] text-zinc-500 mt-1 block">
              Both Primary and Backup instances must use this identical token in headers to authenticate replication.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
              <div>
                <div className="text-xs font-semibold text-white">Auto-Sync on Changes</div>
                <div className="text-[10px] text-zinc-400">Mirror files and triggers instantly on save</div>
              </div>
              <input
                type="checkbox"
                checked={backupAutoSync}
                onChange={(e) => setBackupAutoSync(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
              <div>
                <div className="text-xs font-semibold text-white">Heartbeat Interval</div>
                <div className="text-[10px] text-zinc-400">Periodic mirror check</div>
              </div>
              <select
                value={backupInterval}
                onChange={(e) => setBackupInterval(Number(e.target.value) || 5)}
                className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
          </div>

          {/* Test Result Callout */}
          {backupTestResult && (
            <div className={`p-3 rounded-xl border text-xs ${
              backupTestResult.success
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              <div className="font-semibold flex items-center gap-1.5">
                {backupTestResult.success ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
                <span>{backupTestResult.message}</span>
              </div>
              {backupTestResult.latencyMs !== undefined && (
                <div className="text-[10px] opacity-75 mt-0.5">
                  Handshake Latency: {backupTestResult.latencyMs}ms | Remote Role: {backupTestResult.role || 'silent-mirror'}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={backupTesting}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
            >
              {backupTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5 text-cyan-400" />}
              <span>Test Connection</span>
            </button>

            <button
              type="submit"
              disabled={backupSaving}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md transition-all active:scale-95"
            >
              {backupSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Configuration</span>
            </button>
          </div>
        </form>

        {/* Offline Snapshot & Disaster Recovery Tools */}
        <div className="p-4 rounded-2xl glass-panel border border-zinc-800 space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-purple-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Offline Disaster Recovery &amp; Snapshots
            </h4>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Download a complete standalone JSON archive containing all database tables, bot users, settings, and uploaded files. You can restore this archive on any instance at any time.
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleDownloadSnapshot}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors border border-zinc-700"
            >
              <Download className="w-3.5 h-3.5 text-purple-400" />
              <span>Download Snapshot (.json)</span>
            </button>

            <label className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors border border-zinc-700">
              {backupRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" /> : <Upload className="w-3.5 h-3.5 text-purple-400" />}
              <span>Restore from File</span>
              <input
                type="file"
                accept=".json"
                onChange={handleRestoreFile}
                disabled={backupRestoring}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Architecture & Disaster Recovery Guide */}
        <div className="p-4 rounded-2xl glass-panel border border-zinc-800/80 bg-zinc-950/40 space-y-2 text-xs">
          <div className="font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>How the Silent Mirror &amp; Failover Works</span>
          </div>
          <div className="space-y-1.5 text-zinc-400 text-[11px] leading-relaxed">
            <p>
              1. <b>Silent Mirroring:</b> When configured, the Primary Server pushes a complete snapshot of all files, documents, ZIPs, triggers, and user records to the Backup Server without interrupting active Telegram sessions.
            </p>
            <p>
              2. <b>Zero Collision:</b> While in Backup Mirror mode, bot listeners remain dormant so Telegram updates are never doubled or duplicated.
            </p>
            <p>
              3. <b>Instant Failover:</b> If the Primary server ever encounters downtime, simply open the Backup Server panel and tap <b>ACTIVATE FAILOVER</b>. Operations resume instantly with the mirrored database.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: USER REPORTS
  // -------------------------------------------------------------
  if (subView === 'reports') {
    const filteredReports = reportsList.filter((r) => {
      if (reportFilter === 'all') return true;
      return r.status === reportFilter;
    });

    const pendingCount = reportsList.filter((r) => r.status === 'pending').length;
    const resolvedCount = reportsList.filter((r) => r.status === 'resolved').length;
    const dismissedCount = reportsList.filter((r) => r.status === 'dismissed').length;

    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={loadReports}
              disabled={reportsLoading}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reportsLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Header Summary */}
        <div className="p-4 rounded-2xl glass-panel border border-rose-500/30 bg-gradient-to-r from-rose-950/30 via-zinc-900 to-zinc-900 shadow-lg space-y-2">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider">
            <Flag className="w-4 h-4" />
            <span>User Reports Management</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Review reports submitted by group members using the <code className="text-rose-300 font-mono">/report</code> command. Take instant action to ban violators or dismiss false flags.
          </p>

          <div className="grid grid-cols-4 gap-2 pt-2">
            <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-center">
              <div className="text-lg font-bold text-white font-mono">{reportsList.length}</div>
              <div className="text-[10px] text-zinc-400">Total</div>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
              <div className="text-lg font-bold text-rose-400 font-mono">{pendingCount}</div>
              <div className="text-[10px] text-rose-300">Pending</div>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
              <div className="text-lg font-bold text-emerald-400 font-mono">{resolvedCount}</div>
              <div className="text-[10px] text-emerald-300">Resolved</div>
            </div>
            <div className="p-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700 text-center">
              <div className="text-lg font-bold text-zinc-400 font-mono">{dismissedCount}</div>
              <div className="text-[10px] text-zinc-400">Dismissed</div>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-medium">
          {(['all', 'pending', 'resolved', 'dismissed'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setReportFilter(filter)}
              className={`flex-1 py-1.5 rounded-lg text-center capitalize transition-colors cursor-pointer ${
                reportFilter === filter
                  ? 'bg-rose-500 text-white font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Reports List */}
        {reportsLoading ? (
          <div className="p-8 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
            <span>Loading user reports...</span>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="p-8 rounded-2xl glass-panel border border-zinc-800 text-center space-y-2">
            <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
            <div className="text-xs font-semibold text-white">No reports found</div>
            <p className="text-[11px] text-zinc-400">
              {reportFilter === 'all'
                ? 'No reports have been submitted yet. When users reply with /report, they will show up here.'
                : `No ${reportFilter} reports at this time.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((report) => (
              <div
                key={report.id}
                className="p-4 rounded-2xl glass-panel border border-zinc-800 hover:border-zinc-700 transition-all space-y-3"
              >
                {/* Header: Status and timestamp */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      report.status === 'pending'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : report.status === 'resolved'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {report.status}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {new Date(report.createdAt).toLocaleString()}
                  </span>
                </div>

                {/* Users info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1">
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold">Reported User</span>
                    <div className="font-semibold text-white truncate">
                      {report.reportedUserName || 'User'}
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono">
                      {report.reportedUserUsername ? `@${report.reportedUserUsername}` : `ID: ${report.reportedUserId}`}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1">
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold">Reported By</span>
                    <div className="font-semibold text-zinc-300 truncate">
                      {report.reporterName || 'Reporter'}
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono">
                      {report.reporterUsername ? `@${report.reporterUsername}` : `ID: ${report.reporterId}`}
                    </div>
                  </div>
                </div>

                {/* Reason & Chat */}
                <div className="space-y-1 text-xs">
                  <div className="text-zinc-400 flex items-center gap-1">
                    <span className="font-semibold text-zinc-300">Reason:</span>
                    <span className="text-rose-300 italic">{report.reason}</span>
                  </div>
                  {report.chatTitle && (
                    <div className="text-[11px] text-zinc-500">
                      Chat: <span className="text-zinc-300">{report.chatTitle}</span>
                    </div>
                  )}
                </div>

                {/* Content Quote */}
                {report.reportedContent && (
                  <div className="p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 text-[11px] font-mono text-zinc-300">
                    <span className="text-zinc-500 block text-[9px] uppercase font-sans mb-0.5">Reported Message:</span>
                    <div className="line-clamp-3 whitespace-pre-wrap">{report.reportedContent}</div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/60">
                  <div className="flex items-center gap-2 flex-wrap">
                    {report.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleResolveReport(report.id, true)}
                          disabled={reportActionLoading === report.id}
                          className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Ban User</span>
                        </button>
                        <button
                          onClick={() => handleResolveReport(report.id, false)}
                          disabled={reportActionLoading === report.id}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Resolve</span>
                        </button>
                        <button
                          onClick={() => handleDismissReport(report.id)}
                          disabled={reportActionLoading === report.id}
                          className="px-2.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                    {report.status !== 'pending' && (
                      <span className="text-[11px] text-zinc-500 italic">
                        Marked as {report.status}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleDeleteReport(report.id)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Delete Record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // SUB-VIEW: FRAUD PROTECTION & WORD FILTER
  // -------------------------------------------------------------
  if (subView === 'fraud') {
    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <button
            onClick={() => setShowAddFraudRule(!showAddFraudRule)}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddFraudRule ? 'Close Form' : 'Add Word Rule'}</span>
          </button>
        </div>

        {/* Header card */}
        <div className="p-4 rounded-2xl glass-panel border border-amber-500/30 bg-gradient-to-r from-amber-950/30 via-zinc-900 to-zinc-900 shadow-lg space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="w-4 h-4" />
            <span>Fraud Protection &amp; Anti-Scam Rules</span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            Automatically block and penalize malicious keywords, spam, or scam phrases in group chats. When triggered by a non-admin, the bot instantly deletes the message, warns the user, or issues a ban.
          </p>
        </div>

        {/* Add Rule Form */}
        {showAddFraudRule && (
          <form
            onSubmit={handleCreateFraudRule}
            className="p-4 rounded-2xl glass-panel border border-amber-500/40 bg-zinc-900/95 space-y-3 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Add Restricted Keyword Rule</h3>
              <button
                type="button"
                onClick={() => setShowAddFraudRule(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                Restricted Keyword or Phrase <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={newFraudKeyword}
                onChange={(e) => setNewFraudKeyword(e.target.value)}
                placeholder="e.g. scam, free crypto, dm me for bonus"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-semibold text-zinc-300 block mb-1">Match Type</label>
                <select
                  value={newFraudMatchType}
                  onChange={(e) => setNewFraudMatchType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="contains">Contains Word</option>
                  <option value="exact">Exact Match</option>
                  <option value="regex">Regular Expression</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-zinc-300 block mb-1">Enforcement Action</label>
                <select
                  value={newFraudAction}
                  onChange={(e) => setNewFraudAction(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="delete_and_warn">Delete &amp; Warn User</option>
                  <option value="delete">Delete Message Only</option>
                  <option value="warn">Warn User Only</option>
                  <option value="mute">Mute User in Chat</option>
                  <option value="ban">Ban User from Chat &amp; Bot</option>
                </select>
              </div>
            </div>

            {(newFraudAction === 'mute' || newFraudAction === 'ban') && (
              <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-zinc-950/80 border border-amber-500/20">
                <div>
                  <label className="text-[11px] font-semibold text-amber-300 block mb-1">
                    Penalty Duration
                  </label>
                  <select
                    value={newFraudDuration}
                    onChange={(e) => setNewFraudDuration(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="permanent">Permanent</option>
                    <option value="1h">1 Hour</option>
                    <option value="6h">6 Hours</option>
                    <option value="24h">24 Hours (1 Day)</option>
                    <option value="7d">7 Days</option>
                    <option value="30d">30 Days</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-amber-300 block mb-1">
                    Warning Limit Counter
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={newFraudMaxWarnings}
                    onChange={(e) => setNewFraudMaxWarnings(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-500"
                    placeholder="3"
                  />
                  <span className="text-[9px] text-zinc-500 mt-0.5 block">
                    Warnings before enforcing final {newFraudAction}
                  </span>
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                Custom Warning Message <span className="text-zinc-500 font-normal">(supports &#123;user_name&#125;, &#123;user_id&#125;, &#123;keyword&#125;, &#123;warning_count&#125;, &#123;max_warnings&#125;, &#123;action&#125;)</span>
              </label>
              <textarea
                value={newFraudWarningText}
                onChange={(e) => setNewFraudWarningText(e.target.value)}
                placeholder="⚠️ Warning ({warning_count}/{max_warnings}): Prohibited keyword detected. User: {user_name} | Action: {action}"
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-semibold text-zinc-300 block mb-1">Optional Media URL</label>
                <input
                  type="text"
                  value={newFraudMediaUrl}
                  onChange={(e) => setNewFraudMediaUrl(e.target.value)}
                  placeholder="https://... or Telegram file ID"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-zinc-300 block mb-1">Media Type</label>
                <select
                  value={newFraudMediaType}
                  onChange={(e) => setNewFraudMediaType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="text">None / Text Only</option>
                  <option value="photo">Photo / Image</option>
                  <option value="video">Video</option>
                  <option value="voice">Voice Note</option>
                  <option value="audio">Audio</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowAddFraudRule(false)}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingFraudRule}
                className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {savingFraudRule && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Keyword Rule</span>
              </button>
            </div>
          </form>
        )}

        {/* Rules List */}
        {fraudRulesLoading ? (
          <div className="p-8 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            <span>Loading keyword rules...</span>
          </div>
        ) : fraudRulesList.length === 0 ? (
          <div className="p-8 rounded-2xl glass-panel border border-zinc-800 text-center space-y-2">
            <Shield className="w-8 h-8 text-amber-400 mx-auto" />
            <div className="text-xs font-semibold text-white">No restricted words configured</div>
            <p className="text-[11px] text-zinc-400">
              Click &quot;Add Word Rule&quot; above to create custom triggers that auto-delete, mute, warn, or ban users upon detection.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {fraudRulesList.map((rule) => (
              <div
                key={rule.id}
                className={`p-4 rounded-2xl glass-panel border transition-all space-y-2.5 ${
                  rule.enabled ? 'border-zinc-800 hover:border-zinc-700' : 'border-zinc-800/40 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white font-mono bg-zinc-950 px-2.5 py-0.5 rounded-lg border border-zinc-800">
                      {rule.keyword}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 font-mono">
                      {rule.matchType}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                        rule.action === 'ban'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : rule.action === 'mute'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : rule.action === 'delete_and_warn'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {rule.action.replace(/_/g, ' ')}
                    </span>
                    {rule.duration && (rule.action === 'mute' || rule.action === 'ban') && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-800 text-amber-300 border border-amber-500/20">
                        ⏱️ {rule.duration}
                      </span>
                    )}
                    {rule.maxWarnings && rule.maxWarnings > 1 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700">
                        Max: {rule.maxWarnings} warnings
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleFraudRule(rule)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                        rule.enabled
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700'
                      }`}
                    >
                      {rule.enabled ? 'Active' : 'Paused'}
                    </button>
                    <button
                      onClick={() => handleDeleteFraudRule(rule.id)}
                      className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      title="Delete Rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {rule.warningText && (
                  <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs text-zinc-300 italic">
                    {rule.warningText}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
};
