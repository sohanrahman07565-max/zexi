import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  AdminUser, MessageTemplate, BotSettings, UserReportRecord, FraudKeywordRule, JoinRequestRecord, api 
} from '../lib/api';
import { toast } from '../lib/toast';
import { 
  MessageSquare, Users, Trash2, Settings, Smartphone, LogOut, 
  ChevronRight, Edit2, Check, RefreshCw, Plus, Minus, Shield, Send, Sparkles, X, CheckCircle2, AlertCircle, Clock, Smile, Wifi, WifiOff,
  Megaphone, Image as ImageIcon, Video as VideoIcon, Music, Mic, Pin, Paperclip, Loader2, Radio,
  Flag, AlertTriangle, Ban, CheckCircle, ShieldAlert, Eye, ExternalLink, ShieldCheck,
  Server, Database, Copy, Download, Upload, Activity, HardDrive, Key, CheckSquare, Square, Bot
} from 'lucide-react';
import { EmojiStore } from './EmojiStore';

export const ALL_PERMISSIONS: { key: keyof AdminUser['permissions']; label: string; category: string; desc: string }[] = [
  { key: 'files_view', label: 'View Files', category: 'Files & Media', desc: 'Browse file list and search files' },
  { key: 'files_add', label: 'Upload / Add Files', category: 'Files & Media', desc: 'Upload documents, videos, photos' },
  { key: 'files_edit', label: 'Edit Files', category: 'Files & Media', desc: 'Change file triggers, names, videos' },
  { key: 'files_delete', label: 'Delete Files', category: 'Files & Media', desc: 'Permanently remove files' },
  { key: 'links_view', label: 'View Links', category: 'Links & Web', desc: 'Browse configured link triggers' },
  { key: 'links_add', label: 'Create Links', category: 'Links & Web', desc: 'Add new link triggers and buttons' },
  { key: 'links_edit', label: 'Edit Links', category: 'Links & Web', desc: 'Modify link buttons, URLs, previews' },
  { key: 'links_delete', label: 'Delete Links', category: 'Links & Web', desc: 'Permanently remove links' },
  { key: 'messages_view', label: 'View Templates', category: 'Bot Messages', desc: 'View bot /start and automated messages' },
  { key: 'messages_edit', label: 'Edit Templates', category: 'Bot Messages', desc: 'Modify bot messages and replies' },
  { key: 'settings_edit', label: 'Bot Settings', category: 'System Control', desc: 'Configure bot token, force-sub, channels' },
  { key: 'cleanup_manage', label: 'Message Cleanup', category: 'System Control', desc: 'Run cleanup and purge old messages' },
  { key: 'admins_manage', label: 'Manage Sub-Admins', category: 'System Control', desc: 'Create and edit sub-admin permissions' },
  { key: 'design_edit', label: 'Customize Design', category: 'System Control', desc: 'Change panel themes, colors, branding' },
];

interface MoreTabProps {
  currentUser: AdminUser;
  templates: Record<string, MessageTemplate>;
  settings: BotSettings | null;
  onRefreshTemplates: () => void;
  onRefreshSettings: () => void;
  onLogout: () => void;
  onOpenBotSwitcher?: () => void;
}

export const MoreTab: React.FC<MoreTabProps> = ({
  currentUser,
  templates,
  settings,
  onRefreshTemplates,
  onRefreshSettings,
  onLogout,
  onOpenBotSwitcher
}) => {
  const [subView, setSubView] = useState<'menu' | 'templates' | 'admins' | 'cleanup' | 'settings' | 'webhook' | 'broadcast' | 'apk' | 'emoji' | 'reports' | 'fraud' | 'backup' | 'firebase'>('menu');
  const [copiedRulesType, setCopiedRulesType] = useState<'rtdb' | 'firestore' | null>(null);

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
  const [newFraudDuration, setNewFraudDuration] = useState<string>('30m');
  const [newFraudDurationUnit, setNewFraudDurationUnit] = useState<'minutes' | 'hours' | 'days' | 'permanent'>('minutes');
  const [newFraudDurationValue, setNewFraudDurationValue] = useState<number>(30);
  const [newFraudMaxWarnings, setNewFraudMaxWarnings] = useState<number>(3);
  const [newFraudWarningText, setNewFraudWarningText] = useState<string>('');
  const [newFraudMediaUrl, setNewFraudMediaUrl] = useState<string>('');
  const [newFraudVideoFile, setNewFraudVideoFile] = useState<File | null>(null);
  const [newFraudVideoName, setNewFraudVideoName] = useState<string>('');
  const fraudVideoInputRef = useRef<HTMLInputElement>(null);
  const [newFraudMediaType, setNewFraudMediaType] = useState<'text' | 'photo' | 'video' | 'audio' | 'voice'>('text');
  const [savingFraudRule, setSavingFraudRule] = useState<boolean>(false);



  // Admin Details Popup State & 7-Tap Gesture Trigger
  const tapCountRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const [gestureFeedback, setGestureFeedback] = useState(false);
  const [showAdminDetailsPopup, setShowAdminDetailsPopup] = useState(false);

  const handleHeaderSecretTap = () => {
    const now = Date.now();
    // Reset if more than 2 seconds between taps
    if (now - lastTapTimeRef.current > 2000) {
      tapCountRef.current = 1;
    } else {
      tapCountRef.current += 1;
    }
    lastTapTimeRef.current = now;

    if (tapCountRef.current >= 7) {
      tapCountRef.current = 0;
      setGestureFeedback(true);
      setShowAdminDetailsPopup(true);
      setTimeout(() => setGestureFeedback(false), 800);
    }
  };

  // Templates state
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [templateContent, setTemplateContent] = useState('');
  const [templateMediaType, setTemplateMediaType] = useState<'none' | 'photo' | 'video'>('none');
  const [templateMediaUrl, setTemplateMediaUrl] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);

  // Auto-focus, scroll to top, and cursor-position tracking refs for seamless editing
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const templateSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const maintenanceTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const maintenanceSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const broadcastTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const broadcastSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const modalScrollRef = useRef<HTMLDivElement | null>(null);

  const syncTextareaSelection = (
    el: HTMLTextAreaElement | null,
    selectionRef: React.MutableRefObject<{ start: number; end: number } | null>
  ) => {
    if (!el) return;
    if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
      selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
    }
  };

  const insertAtCursor = (
    el: HTMLTextAreaElement | null,
    currentValue: string,
    snippet: string,
    onUpdate: (nextValue: string) => void,
    selectionRef?: React.MutableRefObject<{ start: number; end: number } | null>
  ) => {
    if (!el) {
      onUpdate(`${currentValue}${snippet}`);
      return;
    }

    const isFocused = document.activeElement === el;
    const hasLiveSelection =
      typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number';

    let start = hasLiveSelection ? el.selectionStart : currentValue.length;
    let end = hasLiveSelection ? el.selectionEnd : currentValue.length;

    if (!isFocused && selectionRef?.current) {
      start = selectionRef.current.start;
      end = selectionRef.current.end;
    }

    start = Math.max(0, Math.min(start, currentValue.length));
    end = Math.max(start, Math.min(end, currentValue.length));

    const nextValue = currentValue.slice(0, start) + snippet + currentValue.slice(end);
    const nextCursor = start + snippet.length;

    if (selectionRef) {
      selectionRef.current = { start: nextCursor, end: nextCursor };
    }

    onUpdate(nextValue);

    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const wrapSelectionWithTag = (
    el: HTMLTextAreaElement | null,
    currentValue: string,
    openTag: string,
    closeTag: string,
    fallbackInner: string,
    onUpdate: (nextValue: string) => void,
    selectionRef?: React.MutableRefObject<{ start: number; end: number } | null>
  ) => {
    if (!el) {
      onUpdate(`${currentValue}${openTag}${fallbackInner}${closeTag}`);
      return;
    }

    const isFocused = document.activeElement === el;
    const hasLiveSelection =
      typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number';

    let start = hasLiveSelection ? el.selectionStart : currentValue.length;
    let end = hasLiveSelection ? el.selectionEnd : currentValue.length;

    if (!isFocused && selectionRef?.current) {
      start = selectionRef.current.start;
      end = selectionRef.current.end;
    }

    start = Math.max(0, Math.min(start, currentValue.length));
    end = Math.max(start, Math.min(end, currentValue.length));

    const selected = currentValue.slice(start, end);
    const inner = selected || fallbackInner;
    const snippet = `${openTag}${inner}${closeTag}`;
    const nextValue = currentValue.slice(0, start) + snippet + currentValue.slice(end);
    const nextCursorStart = start + openTag.length;
    const nextCursorEnd = selected ? start + snippet.length : nextCursorStart + inner.length;

    if (selectionRef) {
      selectionRef.current = { start: nextCursorEnd, end: nextCursorEnd };
    }

    onUpdate(nextValue);

    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        if (selected) {
          el.setSelectionRange(nextCursorEnd, nextCursorEnd);
        } else {
          el.setSelectionRange(nextCursorStart, nextCursorEnd);
        }
      }
    });
  };

  useEffect(() => {
    if (editingTemplate) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const timer = setTimeout(() => {
        if (modalScrollRef.current) {
          modalScrollRef.current.scrollTop = 0;
        }
        if (textareaRef.current) {
          textareaRef.current.focus();
          const len = textareaRef.current.value.length;
          textareaRef.current.setSelectionRange(len, len);
          templateSelectionRef.current = { start: len, end: len };
        }
      }, 50);
      return () => clearTimeout(timer);
    } else {
      templateSelectionRef.current = null;
    }
  }, [editingTemplate]);

  // Admins state
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<any | null>(null);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [editAdminForm, setEditAdminForm] = useState<{
    name: string;
    password: string;
    enabled: boolean;
    permissions: Record<string, boolean>;
  }>({
    name: '',
    password: '',
    enabled: true,
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

  const handleUpdateDeliveryTimeout = async (newMins: number) => {
    const mins = Math.max(1, Math.min(10080, Math.round(Number(newMins) || 10)));
    setBotSettings((prev: any) => ({ ...prev, deliveryTimeoutMinutes: mins }));
    setCleanupStatus((prev: any) => ({ ...prev, deliveryTimeoutMinutes: mins }));
    try {
      const res = await api.updateSettings({
        ...botSettings,
        deliveryTimeoutMinutes: mins
      });
      if (res && res.settings) {
        setBotSettings((prev: any) => ({
          ...prev,
          ...res.settings,
          deliveryTimeoutMinutes: res.settings.deliveryTimeoutMinutes || mins
        }));
      }
      onRefreshSettings();
      toast.success(`File auto-delete timer set to ${mins} minute${mins === 1 ? '' : 's'}!`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update auto-delete timer');
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
      let finalMediaUrl = newFraudMediaUrl.trim();
      let finalMediaType = newFraudMediaType;

      // Handle direct video file upload if provided from device/gallery
      if (newFraudVideoFile) {
        toast.info('Uploading video file from device...');
        const vFd = new FormData();
        vFd.append('file', newFraudVideoFile);
        vFd.append('fileName', newFraudVideoFile.name);
        vFd.append('fileType', 'video');
        const vRes = await api.uploadFile(vFd);
        finalMediaUrl = vRes.uploadedFileId || vRes.fileId;
        finalMediaType = 'video';
      }

      await api.createFraudRule({
        keyword: newFraudKeyword.trim(),
        matchType: newFraudMatchType,
        action: newFraudAction,
        duration: (newFraudAction === 'mute' || newFraudAction === 'ban') ? newFraudDuration : undefined,
        maxWarnings: newFraudMaxWarnings,
        warningText: newFraudWarningText.trim() || undefined,
        mediaUrl: finalMediaUrl || undefined,
        mediaType: finalMediaType !== 'text' ? (finalMediaType as any) : undefined,
        enabled: true
      });
      toast.success(`Rule for "${newFraudKeyword.trim()}" created!`);
      setNewFraudKeyword('');
      setNewFraudWarningText('');
      setNewFraudMediaUrl('');
      setNewFraudVideoFile(null);
      setNewFraudVideoName('');
      setNewFraudMediaType('text');
      setNewFraudMaxWarnings(3);
      setNewFraudDuration('permanent');
      if (fraudVideoInputRef.current) fraudVideoInputRef.current.value = '';
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
              onChange={(e) => {
                setTemplateContent(e.target.value);
                syncTextareaSelection(e.currentTarget, templateSelectionRef);
              }}
              onSelect={(e) => syncTextareaSelection(e.currentTarget, templateSelectionRef)}
              onKeyUp={(e) => syncTextareaSelection(e.currentTarget, templateSelectionRef)}
              onClick={(e) => syncTextareaSelection(e.currentTarget, templateSelectionRef)}
              onBlur={(e) => syncTextareaSelection(e.currentTarget, templateSelectionRef)}
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
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    insertAtCursor(
                      textareaRef.current,
                      templateContent,
                      '@username',
                      setTemplateContent,
                      templateSelectionRef
                    )
                  }
                  className="bg-indigo-950/70 border border-indigo-500/50 px-2 py-1 rounded-lg text-indigo-300 text-[10px] font-mono hover:bg-indigo-900/60 cursor-pointer font-bold transition-all active:scale-95"
                >
                  +@username
                </button>
              )}
              {(editingTemplate.variables || ['user_name', 'user_id', 'bot_name']).map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    insertAtCursor(
                      textareaRef.current,
                      templateContent,
                      `{${v}}`,
                      setTemplateContent,
                      templateSelectionRef
                    )
                  }
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
      toast.success('Sub-admin created successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to add admin');
    }
  };

  const handleStartEditAdmin = (adm: any) => {
    setEditingAdmin(adm);
    setEditAdminForm({
      name: adm.name || '',
      password: '',
      enabled: adm.enabled !== false,
      permissions: {
        files_view: Boolean(adm.permissions?.files_view),
        files_add: Boolean(adm.permissions?.files_add),
        files_edit: Boolean(adm.permissions?.files_edit),
        files_delete: Boolean(adm.permissions?.files_delete),
        links_view: Boolean(adm.permissions?.links_view),
        links_add: Boolean(adm.permissions?.links_add),
        links_edit: Boolean(adm.permissions?.links_edit),
        links_delete: Boolean(adm.permissions?.links_delete),
        messages_view: Boolean(adm.permissions?.messages_view),
        messages_edit: Boolean(adm.permissions?.messages_edit),
        admins_manage: Boolean(adm.permissions?.admins_manage),
        design_edit: Boolean(adm.permissions?.design_edit),
        settings_edit: Boolean(adm.permissions?.settings_edit),
        cleanup_manage: Boolean(adm.permissions?.cleanup_manage),
      }
    });
  };

  const handleUpdateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin) return;
    setSavingAdmin(true);
    try {
      const payload: any = {
        name: editAdminForm.name.trim(),
        enabled: editAdminForm.enabled,
        permissions: editAdminForm.permissions
      };
      if (editAdminForm.password && editAdminForm.password.trim().length >= 6) {
        payload.password = editAdminForm.password.trim();
      }
      await api.updateAdmin(editingAdmin.id, payload);
      toast.success(`Sub-admin "${editAdminForm.name}" updated successfully!`);
      setEditingAdmin(null);
      await loadAdmins();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update admin');
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleToggleAdminStatus = async (adm: any) => {
    try {
      const nextStatus = adm.enabled === false;
      await api.updateAdmin(adm.id, { enabled: nextStatus });
      toast.success(`Admin "${adm.name}" ${nextStatus ? 'enabled' : 'disabled'}`);
      await loadAdmins();
    } catch (err: any) {
      toast.error(err.message || 'Failed to change admin status');
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

        {/* Smooth Animated Admin Details Popup */}
        {showAdminDetailsPopup && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
            onClick={() => setShowAdminDetailsPopup(false)}
          >
            <div 
              className="w-full max-w-sm rounded-3xl bg-[#0c0c14]/98 border border-white/20 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.9),0_0_30px_rgba(239,68,68,0.2)] text-white relative animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header Title */}
              <div className="flex items-center justify-between pb-3.5 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Admin Details</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdminDetailsPopup(false)}
                  className="w-7 h-7 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Full Telegram Details */}
              <div className="space-y-3 pt-4">
                <div className="p-3 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Admin ID</span>
                  <span className="text-sm font-mono font-bold text-white block select-all">{currentUser.telegramId || currentUser.id || 'N/A'}</span>
                </div>

                <div className="p-3 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Username</span>
                  <span className="text-sm font-mono font-bold text-red-400 block select-all">
                    {currentUser.username ? (currentUser.username.startsWith('@') ? currentUser.username : `@${currentUser.username}`) : `@${(currentUser.name || 'admin').toLowerCase().replace(/\s+/g, '_')}`}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Role</span>
                  <span className="text-xs font-bold text-amber-400 block uppercase tracking-wide">
                    {currentUser.role === 'owner' ? 'Owner / Super Administrator' : 'Administrator'}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Credentials</span>
                  <span className="text-xs font-mono text-zinc-300 block break-all">
                    Authorized Session Token ({currentUser.role || 'admin'})
                  </span>
                </div>
              </div>

              <div className="pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdminDetailsPopup(false)}
                  className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-bold text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Menu Items */}
        <div className="glass-panel rounded-2xl divide-y divide-zinc-800/80 border border-zinc-800 overflow-hidden">
          {/* Switch Bot & Fleet Management (Main Panel Only) */}
          {onOpenBotSwitcher && (
            <button
              onClick={() => onOpenBotSwitcher()}
              className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer bg-red-500/[0.04]"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500/20 to-rose-600/20 text-red-400 flex items-center justify-center border border-red-500/30 shadow-sm shadow-red-500/20">
                  <Bot className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-2">
                    <span>Switch Bot &amp; Fleet Manager</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-red-500/20 text-red-300 font-semibold border border-red-500/30">
                      Multi-Bot
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Manage active bot or clone a new bot instance
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-500" />
            </button>
          )}

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

          {/* File Auto-Delete & Cleanup */}
          <button
            onClick={() => {
              loadCleanupStatus();
              setSubView('cleanup');
            }}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>File Auto-Delete &amp; Cleanup</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-rose-500/20 text-rose-300 font-mono font-semibold">
                    {botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10}m Timeout
                  </span>
                </div>
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

          {/* Firebase Security Rules */}
          <button
            onClick={() => setSubView('firebase')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>Firebase Security Rules</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-emerald-500/20 text-emerald-300 font-mono font-semibold">
                    Secured
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
  // SUB-VIEW: FIREBASE SECURITY RULES
  // -------------------------------------------------------------
  if (subView === 'firebase') {
    const rtdbRulesCode = `{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null",
    "app_state": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "admins": {
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.email == 'sohanrahman07565@gmail.com' || auth.token.email == 'zexiofficial8884@gmail.com' || auth.token.admin == true)"
    },
    "bot_config": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "users": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}`;

    const firestoreRulesCode = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(adminId) {
      return isSignedIn() && (
        request.auth.uid == adminId || 
        request.auth.token.email == 'sohanrahman07565@gmail.com' ||
        request.auth.token.email == 'zexiofficial8884@gmail.com'
      );
    }

    match /admins/{adminId} {
      allow read: if isSignedIn();
      allow write: if isOwner(adminId);
    }
  }
}`;

    const handleCopyRules = (type: 'rtdb' | 'firestore', code: string) => {
      try {
        navigator.clipboard.writeText(code);
        setCopiedRulesType(type);
        toast.success(`${type === 'rtdb' ? 'Realtime Database' : 'Firestore'} rules copied to clipboard!`);
        setTimeout(() => setCopiedRulesType(null), 2500);
      } catch {
        toast.error('Failed to copy to clipboard');
      }
    };

    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <span className="text-xs text-zinc-400">Firebase Security Rules</span>
        </div>

        {/* Security Status Card */}
        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Database Protection Active</div>
                <div className="text-[10px] text-zinc-400">Zero-Trust Realtime Database &amp; Firestore Security</div>
              </div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold font-mono">
              PUBLIC BLOCKED
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800/80 space-y-1">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider block">Access Policy</span>
              <span className="text-xs font-semibold text-white block">Strictly Authenticated</span>
              <p className="text-[10px] text-emerald-400 font-mono mt-0.5">.read: auth != null</p>
            </div>
            <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800/80 space-y-1">
              <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider block">Write Policy</span>
              <span className="text-xs font-semibold text-white block">Admin &amp; Bot Sync Only</span>
              <p className="text-[10px] text-emerald-400 font-mono mt-0.5">.write: auth != null</p>
            </div>
          </div>

          {/* Authorized Admin Emails */}
          <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Authorized Admin Identifiers</span>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                sohanrahman07565@gmail.com
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                zexiofficial8884@gmail.com
              </span>
            </div>
          </div>

          {/* Dual Database Targets */}
          <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block">Configured Firebase Projects</span>
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-mono text-[11px]">Primary: zexiofficial844</span>
                <span className="text-[10px] text-emerald-400 font-semibold">Active</span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-mono text-[11px]">Secondary: zexi-official</span>
                <span className="text-[10px] text-emerald-400 font-semibold">Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* Realtime Database Rules Block */}
        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400" />
              <div className="text-xs font-bold text-white">Realtime Database Security Rules (database.rules.json)</div>
            </div>
            <button
              onClick={() => handleCopyRules('rtdb', rtdbRulesCode)}
              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedRulesType === 'rtdb' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Rules</span>
                </>
              )}
            </button>
          </div>

          <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/90 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-56">
            <code>{rtdbRulesCode}</code>
          </pre>

          <p className="text-[10px] text-zinc-400 leading-relaxed">
            💡 <strong>How to apply in Firebase:</strong> In the Firebase Console, navigate to <strong>Realtime Database</strong> → <strong>Rules</strong> tab, paste this JSON, and click <strong>Publish</strong>. This permanently closes all public reads/writes.
          </p>
        </div>

        {/* Cloud Firestore Rules Block */}
        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-400" />
              <div className="text-xs font-bold text-white">Cloud Firestore Rules (firestore.rules)</div>
            </div>
            <button
              onClick={() => handleCopyRules('firestore', firestoreRulesCode)}
              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedRulesType === 'firestore' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Rules</span>
                </>
              )}
            </button>
          </div>

          <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/90 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-56">
            <code>{firestoreRulesCode}</code>
          </pre>
        </div>
      </div>
    );
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
    const categories = ['Files & Media', 'Links & Web', 'Bot Messages', 'System Control'];

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
              className="py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Sub-Admin</span>
            </button>
          )}
        </div>

        {/* Info Banner */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 flex items-start gap-2.5">
          <Shield className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed text-zinc-400">
            <span className="font-semibold text-zinc-200">Owner Access Control:</span> As the Owner/Master Admin, you have full authority to grant or revoke any of the 14 granular capabilities for each sub-admin, toggle account access, or reset passwords.
          </div>
        </div>

        {adminsLoading ? (
          <div className="p-8 text-center text-xs text-zinc-500 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-red-400" />
            <span>Loading admin accounts...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {adminsList.map((adm) => {
              const activePermCount = ALL_PERMISSIONS.filter(p => adm.role === 'owner' || adm.permissions?.[p.key]).length;
              const isOwner = adm.role === 'owner';
              const isEnabled = adm.enabled !== false;

              return (
                <div
                  key={adm.id}
                  className={`glass-panel rounded-2xl p-4 border transition-all space-y-3 ${
                    !isEnabled 
                      ? 'border-rose-900/30 bg-rose-950/10 opacity-75' 
                      : isOwner
                      ? 'border-amber-500/30 bg-amber-950/5'
                      : 'border-zinc-800/90'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                        <span>{adm.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold uppercase ${
                          isOwner 
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                            : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                        }`}>
                          {adm.role}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${
                          isEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {isEnabled ? '● Active' : '○ Disabled'}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono mt-1 flex items-center gap-2">
                        <span>Telegram ID: <span className="text-zinc-200 font-semibold">{adm.telegramId}</span></span>
                        {adm.lastLoginAt && (
                          <span className="text-zinc-500 text-[10px]">
                            • Last active {new Date(adm.lastLoginAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    {currentUser.role === 'owner' && !isOwner && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Toggle enabled/disabled */}
                        <button
                          type="button"
                          onClick={() => handleToggleAdminStatus(adm)}
                          title={isEnabled ? 'Disable sub-admin' : 'Enable sub-admin'}
                          className={`p-1.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                            isEnabled
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Edit Permissions */}
                        <button
                          type="button"
                          onClick={() => handleStartEditAdmin(adm)}
                          title="Edit sub-admin permissions & password"
                          className="p-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 cursor-pointer transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => handleDeleteAdmin(adm.id)}
                          title="Remove sub-admin"
                          className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Permissions Granted Progress & Tags */}
                  <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400 font-medium">Permissions Granted:</span>
                      <span className="font-mono text-zinc-300 font-semibold">
                        {isOwner ? '14 / 14 (Full Master Access)' : `${activePermCount} / 14 Allowed`}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {ALL_PERMISSIONS.map(p => {
                        const isGranted = isOwner || Boolean(adm.permissions?.[p.key]);
                        return (
                          <span
                            key={p.key}
                            className={`text-[10px] px-2 py-0.5 rounded-md font-mono transition-colors ${
                              isGranted
                                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium'
                                : 'bg-zinc-900/60 text-zinc-600 border border-zinc-800 line-through'
                            }`}
                          >
                            {isGranted ? '✓ ' : '✕ '}{p.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add Sub Admin Modal */}
        {showAddAdmin && createPortal(
          <div
            onClick={() => setShowAddAdmin(false)}
            className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-5 pt-3 sm:pt-6 pb-28 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain animate-in fade-in duration-200"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="glass-panel w-full max-w-lg rounded-3xl p-5 border border-sky-500/35 shadow-[0_0_50px_-10px_rgba(14,165,233,0.35),0_25px_50px_-12px_rgba(0,0,0,0.95)] space-y-4 my-2 relative animate-in zoom-in-95 duration-200"
            >
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Add New Sub-Admin</h4>
                    <p className="text-[11px] text-zinc-400">Configure credentials & granular permissions</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAddAdmin(false)}
                  className="w-8 h-8 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateAdmin} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">Display Name</label>
                    <input
                      type="text"
                      required
                      value={newAdminData.name}
                      onChange={(e) => setNewAdminData({ ...newAdminData, name: e.target.value })}
                      placeholder="e.g. Moderator Alex"
                      className="w-full bg-[#101018] border border-zinc-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">Telegram User ID</label>
                    <input
                      type="text"
                      required
                      value={newAdminData.telegramId}
                      onChange={(e) => setNewAdminData({ ...newAdminData, telegramId: e.target.value })}
                      placeholder="e.g. 8153757163"
                      className="w-full bg-[#101018] border border-zinc-700 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={newAdminData.password}
                    onChange={(e) => setNewAdminData({ ...newAdminData, password: e.target.value })}
                    placeholder="Min 6 characters"
                    className="w-full bg-[#101018] border border-zinc-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                </div>

                {/* Permissions Toggles with Select All / Deselect All */}
                <div className="pt-2 border-t border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-xs">Granular Permissions (14 Capabilities)</div>
                      <div className="text-[10px] text-zinc-400">Toggle exactly what this sub-admin is allowed to do</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const allTrue: Record<string, boolean> = {};
                          ALL_PERMISSIONS.forEach(p => { allTrue[p.key] = true; });
                          setNewAdminData({ ...newAdminData, permissions: allTrue as any });
                        }}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 cursor-pointer font-medium"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const allFalse: Record<string, boolean> = {};
                          ALL_PERMISSIONS.forEach(p => { allFalse[p.key] = false; });
                          setNewAdminData({ ...newAdminData, permissions: allFalse as any });
                        }}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 cursor-pointer font-medium"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {categories.map(cat => {
                      const permsInCat = ALL_PERMISSIONS.filter(p => p.category === cat);
                      return (
                        <div key={cat} className="p-3 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                            {cat}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {permsInCat.map(p => {
                              const isChecked = Boolean(newAdminData.permissions[p.key]);
                              return (
                                <label
                                  key={p.key}
                                  className={`p-2 rounded-xl border flex items-start gap-2 cursor-pointer transition-colors ${
                                    isChecked
                                      ? 'bg-sky-500/10 border-sky-500/40 text-white'
                                      : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-400 hover:bg-zinc-800/50'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) =>
                                      setNewAdminData({
                                        ...newAdminData,
                                        permissions: { ...newAdminData.permissions, [p.key]: e.target.checked }
                                      })
                                    }
                                    className="mt-0.5 rounded accent-sky-500 shrink-0 cursor-pointer"
                                  />
                                  <div className="text-left">
                                    <div className="text-xs font-semibold leading-tight">{p.label}</div>
                                    <div className="text-[10px] text-zinc-400 leading-tight mt-0.5">{p.desc}</div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAdmin(false)}
                    className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-blue-600/30 transition-all active:scale-95"
                  >
                    Create Sub-Admin
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

        {/* Edit Sub Admin Modal */}
        {editingAdmin && createPortal(
          <div
            onClick={() => setEditingAdmin(null)}
            className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-5 pt-3 sm:pt-6 pb-28 bg-black/85 backdrop-blur-md overflow-y-auto overscroll-contain animate-in fade-in duration-200"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="glass-panel w-full max-w-lg rounded-3xl p-5 border border-blue-500/35 shadow-[0_0_50px_-10px_rgba(59,130,246,0.35),0_25px_50px_-12px_rgba(0,0,0,0.95)] space-y-4 my-2 relative animate-in zoom-in-95 duration-200"
            >
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Edit Sub-Admin</h4>
                    <p className="text-[11px] text-zinc-400">Telegram ID: {editingAdmin.telegramId}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingAdmin(null)}
                  className="w-8 h-8 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUpdateAdmin} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">Display Name</label>
                    <input
                      type="text"
                      required
                      value={editAdminForm.name}
                      onChange={(e) => setEditAdminForm({ ...editAdminForm, name: e.target.value })}
                      className="w-full bg-[#101018] border border-zinc-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Account Status
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditAdminForm({ ...editAdminForm, enabled: !editAdminForm.enabled })}
                      className={`w-full p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                        editAdminForm.enabled
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                          : 'bg-rose-500/15 border-rose-500/30 text-rose-300 hover:bg-rose-500/25'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{editAdminForm.enabled ? 'Account Active' : 'Account Disabled'}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-zinc-300">Reset Password</label>
                    <span className="text-[10px] text-zinc-500">Leave blank to keep existing password</span>
                  </div>
                  <input
                    type="password"
                    value={editAdminForm.password}
                    onChange={(e) => setEditAdminForm({ ...editAdminForm, password: e.target.value })}
                    placeholder="Enter new password (optional)"
                    className="w-full bg-[#101018] border border-zinc-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Permissions Toggles with Select All / Deselect All */}
                <div className="pt-2 border-t border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-white text-xs">Granular Permissions (14 Capabilities)</div>
                      <div className="text-[10px] text-zinc-400">Toggle permissions individually without restrictions</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const allTrue: Record<string, boolean> = {};
                          ALL_PERMISSIONS.forEach(p => { allTrue[p.key] = true; });
                          setEditAdminForm({ ...editAdminForm, permissions: allTrue });
                        }}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 cursor-pointer font-medium"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const allFalse: Record<string, boolean> = {};
                          ALL_PERMISSIONS.forEach(p => { allFalse[p.key] = false; });
                          setEditAdminForm({ ...editAdminForm, permissions: allFalse });
                        }}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 cursor-pointer font-medium"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {categories.map(cat => {
                      const permsInCat = ALL_PERMISSIONS.filter(p => p.category === cat);
                      return (
                        <div key={cat} className="p-3 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 space-y-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                            {cat}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {permsInCat.map(p => {
                              const isChecked = Boolean(editAdminForm.permissions[p.key]);
                              return (
                                <label
                                  key={p.key}
                                  className={`p-2 rounded-xl border flex items-start gap-2 cursor-pointer transition-colors ${
                                    isChecked
                                      ? 'bg-blue-500/10 border-blue-500/40 text-white'
                                      : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-400 hover:bg-zinc-800/50'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) =>
                                      setEditAdminForm({
                                        ...editAdminForm,
                                        permissions: { ...editAdminForm.permissions, [p.key]: e.target.checked }
                                      })
                                    }
                                    className="mt-0.5 rounded accent-blue-500 shrink-0 cursor-pointer"
                                  />
                                  <div className="text-left">
                                    <div className="text-xs font-semibold leading-tight">{p.label}</div>
                                    <div className="text-[10px] text-zinc-400 leading-tight mt-0.5">{p.desc}</div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingAdmin(null)}
                    className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingAdmin}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-blue-600/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {savingAdmin ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Changes</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
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

        {/* Delivery Files Auto-Destruct Status & Configurable Timer */}
        <div className="glass-panel rounded-2xl p-4 border border-rose-500/30 bg-rose-950/15 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">
                  Delivery File Auto-Delete ({botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10}m Timeout)
                </div>
                <div className="text-[10px] text-zinc-400">Configurable self-destruct timer for delivered files</div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={botSettings.autoDeleteDeliveryEnabled}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setBotSettings((prev: any) => ({ ...prev, autoDeleteDeliveryEnabled: enabled }));
                  setCleanupStatus((prev: any) => ({ ...prev, autoDeleteDeliveryEnabled: enabled }));
                  try {
                    await api.updateSettings({ ...botSettings, autoDeleteDeliveryEnabled: enabled });
                    onRefreshSettings();
                    toast.success(enabled ? 'File auto-delete enabled' : 'File auto-delete disabled');
                  } catch (err: any) {
                    toast.error(err.message || 'Failed to update setting');
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500"></div>
            </label>
          </div>

          <p className="text-xs text-zinc-400">
            Files delivered in Telegram private chat remain accessible for the exact configured duration, and then automatically delete themselves from the user's chat. They will not be deleted prematurely before this timer expires.
          </p>

          {/* Quick Preset Buttons */}
          <div className="space-y-1.5 pt-1 border-t border-rose-500/20">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-zinc-300">Quick Timer Presets:</span>
              <span className="text-rose-400 font-mono font-bold">
                Current: {botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10} min
              </span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
              {[1, 3, 5, 10, 15, 30, 60, 120].map((presetMins) => {
                const isSelected = (botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10) === presetMins;
                return (
                  <button
                    key={presetMins}
                    type="button"
                    onClick={() => handleUpdateDeliveryTimeout(presetMins)}
                    className={`py-1.5 px-2 rounded-xl text-xs font-semibold font-mono flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30 ring-1 ring-white/30 scale-102 font-bold'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800'
                    }`}
                  >
                    {presetMins}m
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stepper & Custom Duration Input */}
          <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-200">
                  Custom Expiration Duration
                </label>
                <span className="text-[10px] text-zinc-400">Set exact minutes (e.g. 5, 10, 45, 120)</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const cur = botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10;
                    handleUpdateDeliveryTimeout(Math.max(1, cur - 1));
                  }}
                  className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                  title="Decrease 1 minute"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>

                <input
                  type="number"
                  min="1"
                  max="10080"
                  value={botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10}
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value) || 1);
                    setBotSettings((prev: any) => ({ ...prev, deliveryTimeoutMinutes: val }));
                    setCleanupStatus((prev: any) => ({ ...prev, deliveryTimeoutMinutes: val }));
                  }}
                  onBlur={(e) => {
                    const val = Math.max(1, Number(e.target.value) || 10);
                    handleUpdateDeliveryTimeout(val);
                  }}
                  className="w-20 bg-zinc-950 border border-rose-500/40 rounded-lg py-1 px-2 text-center text-xs text-white font-mono font-bold focus:outline-none focus:border-rose-400"
                />

                <button
                  type="button"
                  onClick={() => {
                    const cur = botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10;
                    handleUpdateDeliveryTimeout(cur + 1);
                  }}
                  className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                  title="Increase 1 minute"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => handleUpdateDeliveryTimeout(botSettings.deliveryTimeoutMinutes || 10)}
                  className="py-1 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-all cursor-pointer active:scale-95 shadow-sm"
                >
                  Save
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer pt-1 border-t border-zinc-800/80">
              <input
                type="checkbox"
                checked={botSettings.autoDeleteNoticeEnabled}
                onChange={async (e) => {
                  const notice = e.target.checked;
                  setBotSettings((prev: any) => ({ ...prev, autoDeleteNoticeEnabled: notice }));
                  try {
                    await api.updateSettings({ ...botSettings, autoDeleteNoticeEnabled: notice });
                    onRefreshSettings();
                    toast.success(notice ? 'Notice enabled' : 'Notice disabled');
                  } catch (err: any) {
                    toast.error(err.message || 'Failed to update setting');
                  }
                }}
                className="rounded accent-rose-500"
              />
              <span>Send companion self-destruct notice message with delivered file</span>
            </label>
          </div>

          <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2 text-xs text-zinc-300">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Auto-delete status:</span>
              <span className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${cleanupStatus?.autoDeleteDeliveryEnabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400'}`}>
                {cleanupStatus?.autoDeleteDeliveryEnabled ? 'Active' : 'Disabled'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">Timeout duration:</span>
              <span className="font-semibold text-rose-400">{botSettings.deliveryTimeoutMinutes || cleanupStatus?.deliveryTimeoutMinutes || 10} Minutes</span>
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
                <div className="space-y-3 pt-1 border-t border-rose-500/20 text-xs">
                  {/* Quick Preset Buttons */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-zinc-300">Quick Duration Presets:</span>
                      <span className="text-rose-400 font-mono font-bold">
                        {botSettings.deliveryTimeoutMinutes || 10} min
                      </span>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                      {[1, 3, 5, 10, 15, 30, 60, 120].map((presetMins) => {
                        const isSelected = (botSettings.deliveryTimeoutMinutes || 10) === presetMins;
                        return (
                          <button
                            key={presetMins}
                            type="button"
                            onClick={() => {
                              setBotSettings({ ...botSettings, deliveryTimeoutMinutes: presetMins });
                            }}
                            className={`py-1.5 px-2 rounded-xl text-xs font-semibold font-mono flex items-center justify-center transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30 ring-1 ring-white/30 scale-102 font-bold'
                                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800'
                            }`}
                          >
                            {presetMins}m
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                      Custom Duration (Minutes)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const cur = botSettings.deliveryTimeoutMinutes || 10;
                          setBotSettings({ ...botSettings, deliveryTimeoutMinutes: Math.max(1, cur - 1) });
                        }}
                        className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                        title="Decrease 1 minute"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>

                      <input
                        type="number"
                        min="1"
                        max="10080"
                        value={botSettings.deliveryTimeoutMinutes}
                        onChange={(e) => setBotSettings({ ...botSettings, deliveryTimeoutMinutes: Math.max(1, Number(e.target.value) || 1) })}
                        placeholder="e.g. 10"
                        className="w-24 bg-zinc-950 border border-zinc-700 rounded-xl py-1.5 px-3 text-xs text-white font-mono font-bold text-center focus:outline-none focus:border-rose-400"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          const cur = botSettings.deliveryTimeoutMinutes || 10;
                          setBotSettings({ ...botSettings, deliveryTimeoutMinutes: cur + 1 });
                        }}
                        className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                        title="Increase 1 minute"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>

                      <span className="text-rose-400 font-semibold text-xs ml-1">Minutes</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 block mt-1">
                      Files will remain accessible for exactly {botSettings.deliveryTimeoutMinutes || 10} minute(s) before self-destructing.
                    </span>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer pt-1 border-t border-zinc-800/80">
                    <input
                      type="checkbox"
                      checked={botSettings.autoDeleteNoticeEnabled}
                      onChange={(e) => setBotSettings({ ...botSettings, autoDeleteNoticeEnabled: e.target.checked })}
                      className="rounded accent-rose-500"
                    />
                    <span>Send companion self-destruct warning notice message with the file</span>
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
                  ref={maintenanceTextareaRef}
                  rows={2}
                  value={botSettings.maintenanceNotice || ''}
                  onChange={(e) => {
                    setBotSettings({ ...botSettings, maintenanceNotice: e.target.value });
                    syncTextareaSelection(e.currentTarget, maintenanceSelectionRef);
                  }}
                  onSelect={(e) => syncTextareaSelection(e.currentTarget, maintenanceSelectionRef)}
                  onKeyUp={(e) => syncTextareaSelection(e.currentTarget, maintenanceSelectionRef)}
                  onClick={(e) => syncTextareaSelection(e.currentTarget, maintenanceSelectionRef)}
                  onBlur={(e) => syncTextareaSelection(e.currentTarget, maintenanceSelectionRef)}
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
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const current = botSettings.maintenanceNotice || '';
                        insertAtCursor(
                          maintenanceTextareaRef.current,
                          current,
                          tag,
                          (nextVal) =>
                            setBotSettings((prev: any) =>
                              prev ? { ...prev, maintenanceNotice: nextVal } : prev
                            ),
                          maintenanceSelectionRef
                        );
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
              ref={broadcastTextareaRef}
              rows={4}
              value={broadcastMessage}
              onChange={(e) => {
                setBroadcastMessage(e.target.value);
                syncTextareaSelection(e.currentTarget, broadcastSelectionRef);
              }}
              onSelect={(e) => syncTextareaSelection(e.currentTarget, broadcastSelectionRef)}
              onKeyUp={(e) => syncTextareaSelection(e.currentTarget, broadcastSelectionRef)}
              onClick={(e) => syncTextareaSelection(e.currentTarget, broadcastSelectionRef)}
              onBlur={(e) => syncTextareaSelection(e.currentTarget, broadcastSelectionRef)}
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
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      insertAtCursor(
                        broadcastTextareaRef.current,
                        broadcastMessage,
                        `{${v}}`,
                        setBroadcastMessage,
                        broadcastSelectionRef
                      )
                    }
                    className="bg-zinc-800 border border-zinc-700/80 px-1.5 py-0.5 rounded text-red-400 text-[10px] font-mono hover:bg-zinc-700 cursor-pointer"
                  >
                    +{`{${v}}`}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    wrapSelectionWithTag(
                      broadcastTextareaRef.current,
                      broadcastMessage,
                      '<b>',
                      '</b>',
                      'bold text',
                      setBroadcastMessage,
                      broadcastSelectionRef
                    )
                  }
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold cursor-pointer"
                >
                  B
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    wrapSelectionWithTag(
                      broadcastTextareaRef.current,
                      broadcastMessage,
                      '<i>',
                      '</i>',
                      'italic text',
                      setBroadcastMessage,
                      broadcastSelectionRef
                    )
                  }
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 italic cursor-pointer"
                >
                  I
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    wrapSelectionWithTag(
                      broadcastTextareaRef.current,
                      broadcastMessage,
                      '<code>',
                      '</code>',
                      'code',
                      setBroadcastMessage,
                      broadcastSelectionRef
                    )
                  }
                  className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono cursor-pointer"
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-zinc-950/80 border border-amber-500/25">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-amber-300">
                      Custom Penalty Duration *
                    </label>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      Current: {newFraudDuration}
                    </span>
                  </div>

                  {/* Custom Number + Unit Input */}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={newFraudDurationValue}
                      disabled={newFraudDurationUnit === 'permanent'}
                      onChange={(e) => {
                        const val = Math.max(1, parseInt(e.target.value) || 1);
                        setNewFraudDurationValue(val);
                        if (newFraudDurationUnit === 'minutes') setNewFraudDuration(`${val}m`);
                        else if (newFraudDurationUnit === 'hours') setNewFraudDuration(`${val}h`);
                        else if (newFraudDurationUnit === 'days') setNewFraudDuration(`${val}d`);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-500 font-mono disabled:opacity-40"
                      placeholder="e.g. 30"
                    />
                    <select
                      value={newFraudDurationUnit}
                      onChange={(e) => {
                        const unit = e.target.value as any;
                        setNewFraudDurationUnit(unit);
                        if (unit === 'permanent') setNewFraudDuration('permanent');
                        else if (unit === 'minutes') setNewFraudDuration(`${newFraudDurationValue}m`);
                        else if (unit === 'hours') setNewFraudDuration(`${newFraudDurationValue}h`);
                        else if (unit === 'days') setNewFraudDuration(`${newFraudDurationValue}d`);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="minutes">Minutes (m)</option>
                      <option value="hours">Hours (h)</option>
                      <option value="days">Days (d)</option>
                      <option value="permanent">Permanent</option>
                    </select>
                  </div>

                  {/* Quick Select Preset Duration Chips */}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {['10m', '30m', '1h', '6h', '12h', '24h', 'permanent'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          setNewFraudDuration(d);
                          if (d === 'permanent') {
                            setNewFraudDurationUnit('permanent');
                          } else if (d.endsWith('m')) {
                            setNewFraudDurationUnit('minutes');
                            setNewFraudDurationValue(parseInt(d));
                          } else if (d.endsWith('h')) {
                            setNewFraudDurationUnit('hours');
                            setNewFraudDurationValue(parseInt(d));
                          } else if (d.endsWith('d')) {
                            setNewFraudDurationUnit('days');
                            setNewFraudDurationValue(parseInt(d));
                          }
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded-lg border font-mono transition-all cursor-pointer ${
                          newFraudDuration === d
                            ? 'bg-amber-500/25 border-amber-500 text-amber-300 font-bold'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
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
                  <span className="text-[9px] text-zinc-500 mt-1 block">
                    Offenses before enforcing final {newFraudAction}
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

            {/* Optional Media URL, Type & Direct Video Upload Option */}
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-zinc-300 block mb-1">Optional Media URL</label>
                  <input
                    type="text"
                    value={newFraudMediaUrl}
                    onChange={(e) => {
                      setNewFraudMediaUrl(e.target.value);
                      if (e.target.value && newFraudVideoFile) {
                        setNewFraudVideoFile(null);
                        setNewFraudVideoName('');
                        if (fraudVideoInputRef.current) fraudVideoInputRef.current.value = '';
                      }
                    }}
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
                    <option value="video">Video</option>
                    <option value="photo">Photo / Image</option>
                    <option value="voice">Voice Note</option>
                    <option value="audio">Audio</option>
                  </select>
                </div>
              </div>

              {/* Direct Video File Upload Option from Device / Gallery */}
              <div className="p-3 rounded-xl bg-zinc-950/70 border border-dashed border-zinc-700/80 hover:border-amber-500/50 transition-colors">
                <input
                  type="file"
                  ref={fraudVideoInputRef}
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setNewFraudVideoFile(file);
                      setNewFraudVideoName(file.name);
                      setNewFraudMediaType('video');
                      setNewFraudMediaUrl('');
                    }
                  }}
                />

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                      <VideoIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>Upload Video File</span>
                        <span className="text-[10px] text-amber-400/90 font-normal">(Device / Gallery)</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 truncate">
                        {newFraudVideoName 
                          ? `Selected: ${newFraudVideoName} (${newFraudVideoFile ? (newFraudVideoFile.size / (1024 * 1024)).toFixed(1) + ' MB' : ''})` 
                          : 'Select video file directly from your device/gallery'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto">
                    {newFraudVideoName ? (
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-medium border border-amber-500/40 truncate max-w-[150px]">
                          {newFraudVideoName}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setNewFraudVideoFile(null);
                            setNewFraudVideoName('');
                            if (fraudVideoInputRef.current) fraudVideoInputRef.current.value = '';
                          }}
                          className="p-1 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors"
                          title="Remove video file"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fraudVideoInputRef.current?.click()}
                        className="w-full sm:w-auto px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-amber-500 hover:text-zinc-950 text-zinc-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Video File</span>
                      </button>
                    )}
                  </div>
                </div>
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
