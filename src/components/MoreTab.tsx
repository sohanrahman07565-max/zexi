import React, { useState, useEffect } from 'react';
import { 
  AdminUser, MessageTemplate, BotSettings, api 
} from '../lib/api';
import { 
  MessageSquare, Users, Trash2, Settings, Smartphone, LogOut, 
  ChevronRight, Edit2, Check, RefreshCw, Plus, Shield, Send, Sparkles, X, CheckCircle2, AlertCircle, Clock, Smile, Wifi, WifiOff
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
  const [subView, setSubView] = useState<'menu' | 'templates' | 'admins' | 'cleanup' | 'settings' | 'apk' | 'emoji'>('menu');

  // Templates state
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [templateContent, setTemplateContent] = useState('');
  const [templateMediaType, setTemplateMediaType] = useState<'none' | 'photo' | 'video'>('none');
  const [templateMediaUrl, setTemplateMediaUrl] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);

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
    adminNewPassword: ''
  });
  const [botStatusMsg, setBotStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [settingSaving, setSettingSaving] = useState(false);

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
        autoDeleteNoticeEnabled: settings.autoDeleteNoticeEnabled ?? false
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
      onRefreshTemplates();
      setEditingTemplate(null);
    } catch (err: any) {
      alert(err.message || 'Failed to save template');
    } finally {
      setTemplateSaving(false);
    }
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
    } catch (err: any) {
      alert(err.message || 'Failed to add admin');
    }
  };

  const handleDeleteAdmin = async (id: string) => {
    if (!confirm('Are you sure you want to remove this admin?')) return;
    try {
      await api.deleteAdmin(id);
      loadAdmins();
    } catch (err: any) {
      alert(err.message || 'Failed to delete admin');
    }
  };

  // Run cleanup
  const handleRunCleanup = async () => {
    setCleanupRunning(true);
    setCleanupMsg(null);
    try {
      const res = await api.runCleanup(botSettings.cleanupAgeHours);
      setCleanupMsg(res.message);
      loadCleanupStatus();
    } catch (err: any) {
      setCleanupMsg(err.message || 'Cleanup failed');
    } finally {
      setCleanupRunning(false);
    }
  };

  // Save settings & Webhook
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingSaving(true);
    setBotStatusMsg(null);
    try {
      await api.updateSettings(botSettings);
      onRefreshSettings();
      setBotStatusMsg({ type: 'success', text: 'Bot settings updated successfully!' });
    } catch (err: any) {
      setBotStatusMsg({ type: 'error', text: err.message || 'Failed to update settings' });
    } finally {
      setSettingSaving(false);
    }
  };

  const handleRegisterWebhook = async () => {
    setBotStatusMsg(null);
    try {
      const res = await api.setWebhook(window.location.origin);
      if (res.ok) {
        setBotStatusMsg({ type: 'success', text: 'Telegram webhook registered successfully!' });
      } else {
        setBotStatusMsg({ type: 'error', text: res.description || 'Webhook registration error' });
      }
    } catch (err: any) {
      setBotStatusMsg({ type: 'error', text: err.message || 'Webhook failed' });
    }
  };

  const handleCheckBotInfo = async () => {
    setBotStatusMsg(null);
    try {
      const res = await api.getBotInfo();
      if (res.ok && res.result) {
        setBotStatusMsg({
          type: 'success',
          text: `Connected to @${res.result.username} (ID: ${res.result.id})`
        });
      } else {
        setBotStatusMsg({ type: 'error', text: res.description || 'Bot token invalid or unreachable' });
      }
    } catch (err: any) {
      setBotStatusMsg({ type: 'error', text: err.message || 'Check failed' });
    }
  };

  // -------------------------------------------------------------
  // SUB-VIEW: MENU
  // -------------------------------------------------------------
  if (subView === 'menu') {
    return (
      <div className="space-y-4 pb-28">
        {/* User Card */}
        <div className="glass-panel rounded-2xl p-4 border border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
              {currentUser.name.charAt(0)}
            </div>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span>{currentUser.name}</span>
                <span className="text-[10px] uppercase font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/20">
                  {currentUser.role}
                </span>
              </div>
              <div className="text-xs text-zinc-400 font-mono mt-0.5">
                ID: {currentUser.telegramId}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Access: Start / Welcome Message Template */}
        {templates.START_MESSAGE && (
          <div className="glass-panel rounded-2xl p-4 border border-red-500/30 bg-gradient-to-br from-sky-500/10 via-zinc-900 to-indigo-500/10 flex items-center justify-between gap-3 shadow-lg shadow-sky-500/5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white truncate">Start Message (/start)</span>
                  <span className="text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded-full shrink-0">
                    Active
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 truncate mt-0.5 font-mono">
                  {templates.START_MESSAGE.content.slice(0, 42)}...
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setSubView('templates');
                setEditingTemplate(templates.START_MESSAGE);
                setTemplateContent(templates.START_MESSAGE.content);
              }}
              className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm shadow-sky-500/20"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>Edit</span>
            </button>
          </div>
        )}

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
                <div className="text-[11px] text-zinc-400">Edit /start welcome message &amp; bot copy</div>
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
                <div className="text-[11px] text-zinc-400">Manage team accounts &amp; access</div>
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
                <div className="text-[11px] text-zinc-400">10-message limit &amp; auto-deletion</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

          {/* Settings & Webhook */}
          <button
            onClick={() => setSubView('settings')}
            className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Bot Settings &amp; Webhook</div>
                <div className="text-[11px] text-zinc-400">Bot token, URL &amp; connection test</div>
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
                <div className="text-[11px] text-zinc-400">Essential emojis for Telegram bot & message decoration</div>
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
                <div className="text-[11px] text-zinc-400">Jetpack Compose native app source</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          </button>

        </div>

        {/* Logout */}

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
                <p className="text-[11px] text-zinc-400">
                  {startTemplate.description || 'Welcome message sent to users who message /start in private chat'}
                </p>
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
                  <p className="text-[11px] text-zinc-400">{tpl.description}</p>
                </div>
                <button
                  onClick={() => {
                    setEditingTemplate(tpl);
                    setTemplateContent(tpl.content);
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

        {/* Edit Modal */}
        {editingTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <div className="glass-panel w-full max-w-sm rounded-3xl p-5 border border-zinc-700 space-y-3.5">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-sm">Edit {editingTemplate.name}</h4>
                <button onClick={() => setEditingTemplate(null)} className="text-zinc-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1">Message Content</label>
                <textarea
                  rows={4}
                  value={templateContent}
                  onChange={(e) => setTemplateContent(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs text-white font-mono"
                />
              </div>

              {/* Rich Media Attachment for /start Welcome Message */}
              {editingTemplate.key === 'START_MESSAGE' && (
                <div className="p-3 rounded-2xl bg-zinc-900/90 border border-zinc-700/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white">Attached Media</label>
                    <span className="text-[10px] text-zinc-400">Photo or Video header</span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {(['none', 'photo', 'video'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setTemplateMediaType(m)}
                        className={`py-1.5 px-2 rounded-lg text-xs font-semibold capitalize border transition-all cursor-pointer ${
                          templateMediaType === m
                            ? 'bg-red-500/20 text-sky-300 border-red-500/50'
                            : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                        }`}
                      >
                        {m === 'none' ? 'None' : m === 'photo' ? '📸 Photo' : '🎥 Video'}
                      </button>
                    ))}
                  </div>

                  {templateMediaType !== 'none' && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={templateMediaUrl}
                        onChange={(e) => setTemplateMediaUrl(e.target.value)}
                        placeholder={templateMediaType === 'photo' ? 'https://example.com/banner.jpg, file_id, or upload below' : 'https://example.com/video.mp4, file_id, or upload below'}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-xl py-1.5 px-3 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                      />

                      <div className="flex items-center gap-2">
                        <label className="flex-1 py-1.5 px-3 rounded-xl border border-dashed border-red-500/40 hover:border-sky-400 bg-red-500/10 hover:bg-red-500/15 flex items-center justify-center gap-1.5 cursor-pointer text-xs text-sky-300 font-semibold transition-all">
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

                      <p className="text-[10px] text-zinc-500">
                        Enter a direct URL, Telegram file_id, or upload directly from your gallery/storage.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Available Placeholders / Variables */}
              <div className="text-[11px] text-zinc-400">
                <span>Available Variables: </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {editingTemplate.key === 'START_MESSAGE' && (
                    <button
                      type="button"
                      onClick={() => setTemplateContent((prev) => `${prev} @username`)}
                      className="bg-indigo-950/60 border border-indigo-500/40 px-2 py-0.5 rounded text-indigo-300 text-[10px] font-mono hover:bg-indigo-900/60 cursor-pointer font-bold"
                    >
                      +@username
                    </button>
                  )}
                  {(editingTemplate.variables || ['user_name', 'user_id', 'bot_name']).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTemplateContent((prev) => `${prev} {${v}}`)}
                      className="bg-zinc-800 border border-zinc-700/80 px-1.5 py-0.5 rounded text-red-400 text-[10px] font-mono hover:bg-zinc-700 cursor-pointer"
                    >
                      +{`{${v}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setEditingTemplate(null)}
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-red-600/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={templateSaving}
                  className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-blue-600/30 disabled:opacity-50 transition-colors"
                >
                  {templateSaving ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>
          </div>
        )}
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
          <span className="text-xs text-zinc-400">Bot Connection</span>
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
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Telegram Bot Token
              </label>
              <input
                type="password"
                value={botSettings.botToken}
                onChange={(e) => setBotSettings({ ...botSettings, botToken: e.target.value })}
                placeholder={settings?.botTokenMasked || 'Enter Bot Token from @BotFather'}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white font-mono"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Required for sending replies in groups and private files.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Root Admin Telegram ID
              </label>
              <input
                type="text"
                value={botSettings.rootAdminId}
                onChange={(e) => setBotSettings({ ...botSettings, rootAdminId: e.target.value })}
                placeholder="Enter Telegram User ID"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Change Admin Web Portal Password (Optional)
              </label>
              <input
                type="password"
                value={botSettings.adminNewPassword || ''}
                onChange={(e) => setBotSettings({ ...botSettings, adminNewPassword: e.target.value })}
                placeholder="Enter new admin password (leave blank to keep current)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 px-3 text-xs text-white font-mono"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Enter a new password to change the admin login password (minimum 6 characters).
              </p>
            </div>

            {/* 10-Minute Delivery Auto-Remove / Timeout Settings */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-rose-950/20 via-zinc-900/80 to-zinc-950/90 border border-rose-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Delivery File Auto-Delete (Timeout)</div>
                    <div className="text-[11px] text-zinc-400">Files delivered will automatically be removed from chat after timeout</div>
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
                    <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                      Delivery Timeout in Minutes
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="1440"
                        value={botSettings.deliveryTimeoutMinutes}
                        onChange={(e) => setBotSettings({ ...botSettings, deliveryTimeoutMinutes: Math.max(1, Number(e.target.value) || 10) })}
                        className="w-24 bg-zinc-900 border border-zinc-700 rounded-xl py-1.5 px-3 text-xs text-white font-mono font-bold"
                      />
                      <span className="text-rose-400 font-semibold text-xs">Minutes (Default: 10 mins)</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1">
                      Files sent to users in private chat will be deleted automatically {botSettings.deliveryTimeoutMinutes || 10} minutes after delivery.
                    </p>
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

            <button
              type="submit"
              disabled={settingSaving}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-blue-600/30 disabled:opacity-50 transition-colors"
            >
              {settingSaving ? 'Saving...' : 'Save Configuration & Password'}
            </button>
          </form>

          {/* Quick Diagnostics & Message Templates Navigation */}
          <div className="pt-3 border-t border-zinc-800/80 space-y-2">
            <div className="text-xs font-semibold text-zinc-300">Message Templates &amp; Actions:</div>
            
            {/* Quick Link into Message Templates */}
            <button
              type="button"
              onClick={() => setSubView('templates')}
              className="w-full p-2.5 rounded-xl bg-gradient-to-r from-sky-500/15 via-zinc-800 to-indigo-500/15 border border-red-500/30 hover:border-red-500/50 text-white text-xs font-medium flex items-center justify-between cursor-pointer transition-colors shadow-xs"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-red-400" />
                <span>Edit All Bot Message Templates</span>
              </div>
              <ChevronRight className="w-4 h-4 text-red-400" />
            </button>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={handleCheckBotInfo}
                className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Test Token</span>
              </button>
              <button
                type="button"
                onClick={handleRegisterWebhook}
                className="p-2.5 rounded-xl bg-red-500/20 hover:bg-sky-500/30 text-sky-300 border border-red-500/30 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Set Webhook</span>
              </button>
            </div>
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
