import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  AdminUser, MessageTemplate, BotSettings, api 
} from '../lib/api';
import { toast } from '../lib/toast';
import { 
  MessageSquare, Users, Trash2, Settings, Smartphone, LogOut, 
  ChevronRight, Edit2, Check, RefreshCw, Plus, Shield, Send, Sparkles, X, CheckCircle2, AlertCircle, Clock, Smile, Wifi, WifiOff,
  Megaphone, Image as ImageIcon, Video as VideoIcon, Music, Mic, Pin, Paperclip, Loader2, Radio
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
  const [subView, setSubView] = useState<'menu' | 'templates' | 'admins' | 'cleanup' | 'settings' | 'webhook' | 'broadcast' | 'apk' | 'emoji'>('menu');

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
    requiredChannels: settings?.requiredChannels || [],
    adminNewPassword: ''
  });
  const [botStatusMsg, setBotStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [settingSaving, setSettingSaving] = useState(false);

  // Force Sub Add Channel form state
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelChatId, setNewChannelChatId] = useState('');
  const [newChannelInviteLink, setNewChannelInviteLink] = useState('');

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
    }
    // Refresh user count for broadcast
    api.getUsers().then(users => {
      setBroadcastUsersCount(users.length);
    }).catch(() => {});
  }, [subView]);

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
    if (!newChannelName.trim() || !newChannelChatId.trim()) {
      toast.error('Please enter both Channel Name and Chat ID / Username');
      return;
    }
    const cleanChatId = newChannelChatId.trim();
    const inviteLink = newChannelInviteLink.trim() || (cleanChatId.startsWith('@') ? `https://t.me/${cleanChatId.replace(/^@/, '')}` : '');
    const newChan = {
      id: `ch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: newChannelName.trim(),
      chatId: cleanChatId,
      inviteLink: inviteLink
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
    setNewChannelInviteLink('');
    toast.success(`Channel "${newChan.name}" added! Click Save Configuration below to save.`);
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
        requiredChannels: Array.isArray(botSettings.requiredChannels) ? botSettings.requiredChannels : []
      };
      const res = await api.updateSettings(payload);
      if (res && res.settings) {
        setBotSettings((prev: any) => ({
          ...prev,
          ...res.settings,
          forceSubEnabled: res.settings.forceSubEnabled ?? false,
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

          {/* Cleanup */}
          <button
            onClick={() => setSubView('cleanup')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Message Cleanup</div>
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

          {/* Android APK */}
          <button
            onClick={() => setSubView('apk')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Android APK Architecture</div>
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
                <div className="space-y-3 pt-2 border-t border-indigo-500/20">
                  {/* List of currently required channels */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-semibold text-zinc-300">
                        Required Channels / Groups ({(botSettings.requiredChannels || []).length})
                      </label>
                      <span className="text-[10px] text-zinc-500">Bot must be admin in channels</span>
                    </div>

                    {(!botSettings.requiredChannels || botSettings.requiredChannels.length === 0) ? (
                      <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-center text-xs text-zinc-500">
                        No channels added yet. Add at least one channel below.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {botSettings.requiredChannels.map((ch: any) => (
                          <div
                            key={ch.id}
                            className="p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-white flex items-center gap-1.5 truncate">
                                <span>{ch.name}</span>
                                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.2 rounded border border-indigo-500/20 truncate">
                                  {ch.chatId}
                                </span>
                              </div>
                              {ch.inviteLink && (
                                <a
                                  href={ch.inviteLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-zinc-400 hover:text-indigo-300 truncate block transition-colors mt-0.5"
                                >
                                  {ch.inviteLink}
                                </a>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveForceSubChannel(ch.id)}
                              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                              title="Remove Channel"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add New Channel Form */}
                  <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
                    <div className="text-[11px] font-bold text-indigo-300 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Required Channel / Group</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newChannelName}
                        onChange={(e) => setNewChannelName(e.target.value)}
                        placeholder="Channel Name (e.g. Official Channel)"
                        className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg p-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                      />
                      <input
                        type="text"
                        value={newChannelChatId}
                        onChange={(e) => setNewChannelChatId(e.target.value)}
                        placeholder="Chat ID or Username (@channel or -100xxx)"
                        className="w-full bg-zinc-950 border border-zinc-700/80 rounded-lg p-2 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newChannelInviteLink}
                        onChange={(e) => setNewChannelInviteLink(e.target.value)}
                        placeholder="Invite Link (e.g. https://t.me/channel or https://t.me/+join)"
                        className="flex-1 bg-zinc-950 border border-zinc-700/80 rounded-lg p-2 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddForceSubChannel}
                        className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer active:scale-95 shadow-sm shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>

                  {/* Quick Save Force Sub Button */}
                  <div className="pt-2 border-t border-indigo-500/20 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">
                      {(botSettings.requiredChannels || []).length} channel(s) in list
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

          {/* Broadcast Notification System Link */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-red-950/30 via-zinc-900 to-zinc-950 border border-red-500/35 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center">
                  <Megaphone className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Broadcast System</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 font-semibold font-mono">
                      {broadcastUsersCount} users
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSubView('broadcast')}
              className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-red-600/25 cursor-pointer transition-all active:scale-95"
            >
              <Megaphone className="w-3.5 h-3.5" />
              <span>Open Broadcast Console ({broadcastUsersCount} Reachable Users)</span>
              <ChevronRight className="w-3.5 h-3.5 ml-auto" />
            </button>
          </div>
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
  // SUB-VIEW: ANDROID APK ARCHITECTURE (Sections 48-50)
  // -------------------------------------------------------------
  if (subView === 'apk') {
    return (
      <div className="space-y-4 pb-24">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSubView('menu')}
            className="text-xs text-red-400 hover:text-sky-300 font-medium cursor-pointer"
          >
            ← Back to More
          </button>
          <span className="text-xs text-zinc-400">Android APK Build</span>
        </div>

        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <Smartphone className="w-4 h-4 text-purple-400" />
            <span>Jetpack Compose APK Structure</span>
          </div>
          <p className="text-xs text-zinc-400">
            The project includes a ready-to-build Android native application in the <code className="text-zinc-300">/android</code> directory connecting directly to this backend API.
          </p>

          <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2 text-xs">
            <div className="text-red-400 font-mono font-semibold">Ready Project Files:</div>
            <ul className="list-disc list-inside text-zinc-300 space-y-1 font-mono text-[11px]">
              <li>android/app/src/main/AndroidManifest.xml</li>
              <li>android/app/build.gradle.kts (Kotlin + Compose)</li>
              <li>android/app/src/main/java/com/tgbot/admin/MainActivity.kt</li>
              <li>android/app/src/main/java/com/tgbot/admin/api/AdminApiService.kt</li>
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs space-y-1">
            <div className="font-semibold">How to build APK:</div>
            <p className="text-[11px] text-purple-200">
              Run <code className="bg-purple-950 px-1 py-0.5 rounded">./gradlew assembleRelease</code> inside the <code className="bg-purple-950 px-1 py-0.5 rounded">/android</code> folder or import the folder in Android Studio.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
