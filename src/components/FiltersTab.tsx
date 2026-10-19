import React, { useState, useMemo } from 'react';
import { ItemRecord, TriggerType, AdminUser, DesignConfig, api } from '../lib/api';
import { 
  Filter, Plus, Search, Edit2, Trash2, Copy, Check, Share2, 
  FileText, Link2, ExternalLink, Hash, Slash, Terminal,
  X, Eye, EyeOff, AlertTriangle, CheckCircle2
} from 'lucide-react';

interface FiltersTabProps {
  items: ItemRecord[];
  currentUser: AdminUser;
  botUsername?: string;
  design?: DesignConfig;
  onRefresh: () => void;
  onSimulate?: (trigger: string) => void;
}

export const FiltersTab: React.FC<FiltersTabProps> = ({
  items,
  currentUser,
  botUsername,
  design,
  onRefresh
}) => {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'in_filters' | 'hidden'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemRecord | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<ItemRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Copy feedback states
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  // Add / Edit Modal Form State
  const [formType, setFormType] = useState<TriggerType>('hashtag');
  const [formKeyword, setFormKeyword] = useState('');
  const [formVisibility, setFormVisibility] = useState<boolean>(true); // true = Show, false = Hide
  const [formItemId, setFormItemId] = useState<string>('');

  const canEdit = currentUser.role === 'owner' || currentUser.permissions.files_edit || currentUser.permissions.files_add;
  const canDelete = currentUser.role === 'owner' || currentUser.permissions.files_delete || currentUser.permissions.links_delete;

  const cleanBot = (botUsername || 'YourBot').replace(/^@/, '');

  // Calculate Active Filters (items where inFiltersList === true)
  const activeFilters = useMemo(() => {
    return items.filter((item) => item.status === 'active' && item.inFiltersList === true);
  }, [items]);

  // Filtered list based on search and tab filter
  const displayedItems = useMemo(() => {
    return items.filter((item) => {
      const isVisible = item.inFiltersList === true;
      if (filterMode === 'in_filters' && !isVisible) return false;
      if (filterMode === 'hidden' && isVisible) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const matchName = (item.name || '').toLowerCase().includes(q);
      const matchKeyword = (item.rawKeyword || '').toLowerCase().includes(q);
      const matchTriggers = (item.triggers || []).some((t) => t.toLowerCase().includes(q));
      const matchFile = (item.fileName || '').toLowerCase().includes(q);
      return matchName || matchKeyword || matchTriggers || matchFile;
    });
  }, [items, filterMode, search]);

  // Open "Add Filter" Modal
  const openAddModal = () => {
    setError(null);
    setFormType('hashtag');
    setFormKeyword('');
    setFormVisibility(true);
    setFormItemId(items.length > 0 ? items[0].id : '');
    setSelectedItem(null);
    setIsAddModalOpen(true);
  };

  // Open "Edit Filter" Modal
  const openEditModal = (item: ItemRecord) => {
    setError(null);
    setSelectedItem(item);
    setFormType(item.triggerType || 'hashtag');
    setFormKeyword(item.rawKeyword || (item.triggers?.[0] ? item.triggers[0].replace(/^[#/]/, '') : ''));
    setFormVisibility(item.inFiltersList === true);
    setFormItemId(item.id);
    setIsEditModalOpen(true);
  };

  // Show / Hide Toggle handler
  const handleToggleVisibility = async (item: ItemRecord) => {
    const nextVal = !(item.inFiltersList === true);
    try {
      await api.updateItem(item.id, { inFiltersList: nextVal });
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to update filter visibility');
    }
  };

  // Delete Filter handler
  const handleDeleteItem = async () => {
    if (!deleteConfirmItem) return;
    setLoading(true);
    try {
      await api.deleteItem(deleteConfirmItem.id);
      setDeleteConfirmItem(null);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to delete filter');
    } finally {
      setLoading(false);
    }
  };

  // Copy Deep Link
  const copyShareableLink = async (itemId: string, deepLink: string) => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopiedLink(itemId);
      setTimeout(() => setCopiedLink((prev) => (prev === itemId ? null : prev)), 2000);
    } catch (err) {
      console.warn('Copy link error:', err);
    }
  };

  // Copy keyword tag
  const copyKeywordTag = async (tag: string) => {
    try {
      await navigator.clipboard.writeText(tag);
      setCopiedTag(tag);
      setTimeout(() => setCopiedTag((prev) => (prev === tag ? null : prev)), 2000);
    } catch (err) {
      console.warn('Copy keyword error:', err);
    }
  };

  // Format keyword preview
  const getFormattedTrigger = (keyword: string, type: TriggerType) => {
    const clean = keyword.replace(/^[#/]+/, '').trim();
    if (!clean) return type === 'hashtag' ? '#keyword' : type === 'slash' ? '/keyword' : 'keyword';
    if (type === 'hashtag') return `#${clean}`;
    if (type === 'slash') return `/${clean}`;
    return clean;
  };

  // Submit Add Filter Form
  const handleSaveAddFilter = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKeyword = formKeyword.replace(/^[#/]+/, '').trim();
    if (!cleanKeyword) {
      setError('Please enter a keyword name.');
      return;
    }

    setLoading(true);
    setError(null);

    const primaryTrigger = formType === 'hashtag'
      ? `#${cleanKeyword}`
      : formType === 'slash'
      ? `/${cleanKeyword}`
      : cleanKeyword;

    try {
      if (formItemId) {
        // Connect to existing item
        const target = items.find((i) => i.id === formItemId);
        if (target) {
          const updatedTriggers = Array.from(new Set([
            primaryTrigger,
            ...(target.triggers || [])
          ])).filter(Boolean);

          await api.updateItem(target.id, {
            rawKeyword: cleanKeyword,
            triggerType: formType,
            triggers: updatedTriggers,
            inFiltersList: formVisibility
          });
        }
      } else {
        // Create a standalone link filter
        await api.createItem({
          type: 'link',
          name: `Filter: ${primaryTrigger}`,
          rawKeyword: cleanKeyword,
          triggerType: formType,
          triggers: [primaryTrigger],
          url: 'https://t.me/' + cleanBot,
          inFiltersList: formVisibility
        });
      }

      setIsAddModalOpen(false);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to add filter');
    } finally {
      setLoading(false);
    }
  };

  // Submit Edit Filter Form
  const handleSaveEditFilter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    const cleanKeyword = formKeyword.replace(/^[#/]+/, '').trim();
    if (!cleanKeyword) {
      setError('Please enter a keyword name.');
      return;
    }

    setLoading(true);
    setError(null);

    const primaryTrigger = formType === 'hashtag'
      ? `#${cleanKeyword}`
      : formType === 'slash'
      ? `/${cleanKeyword}`
      : cleanKeyword;

    try {
      const updatedTriggers = [primaryTrigger];

      await api.updateItem(selectedItem.id, {
        rawKeyword: cleanKeyword,
        triggerType: formType,
        triggers: updatedTriggers,
        inFiltersList: formVisibility
      });

      setIsEditModalOpen(false);
      setSelectedItem(null);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to update filter');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-28">
      {/* =========================================================================
          REDESIGNED FILTER HEADER (Requirement 1)
          - Title on Top: "Filter Keywords & Commands"
          - Top-Left: Active Filter Count display
          - Top-Right: "Add Filter" Button
          ========================================================================= */}
      <div className="glass-panel rounded-2xl p-4 border border-slate-800 space-y-3">
        {/* Title on Top */}
        <div className="border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Filter className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Filter Keywords &amp; Commands
              </h2>
              <p className="text-[11px] text-slate-400">
                Manage group triggers and public <code className="text-amber-400 font-mono">/filters</code> list
              </p>
            </div>
          </div>
        </div>

        {/* Top-Left: Active Filter Count | Top-Right: Add Filter Button */}
        <div className="flex items-center justify-between gap-3 pt-1">
          {/* Top-Left: Active Filter Count display */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300">Active Filters:</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold font-mono">{activeFilters.length}</span>
              <span className="text-[10px] text-amber-400/80 font-medium">in /filters</span>
            </div>
          </div>

          {/* Top-Right: "Add Filter" Button */}
          {canEdit && (
            <button
              onClick={openAddModal}
              className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 cursor-pointer active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Add Filter</span>
            </button>
          )}
        </div>

        {/* Search and Filter View Bar */}
        <div className="space-y-2 pt-1">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keyword (e.g. #box, /download) or name..."
              className="w-full bg-slate-900/90 border border-slate-800 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          <div className="flex p-1 bg-slate-900/90 border border-slate-800/80 rounded-xl text-xs">
            <button
              onClick={() => setFilterMode('all')}
              className={`flex-1 py-1.5 text-center font-medium rounded-lg transition-colors cursor-pointer ${
                filterMode === 'all' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setFilterMode('in_filters')}
              className={`flex-1 py-1.5 text-center font-medium rounded-lg transition-colors cursor-pointer ${
                filterMode === 'in_filters' ? 'bg-amber-500/20 text-amber-300 shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Visible ({activeFilters.length})
            </button>
            <button
              onClick={() => setFilterMode('hidden')}
              className={`flex-1 py-1.5 text-center font-medium rounded-lg transition-colors cursor-pointer ${
                filterMode === 'hidden' ? 'bg-slate-800 text-slate-300 shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Hidden ({items.length - activeFilters.length})
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          FILTER LIST & CARD ACTIONS (Requirement 1)
          - Display all added filters below header
          - Inline Quick Actions: [ Edit ] [ Delete ] [ Copy Link ]
          - Show/Hide Toggle: Explicit toggle switch/button to Show or Hide
          ========================================================================= */}
      <div className="space-y-3">
        {displayedItems.length === 0 ? (
          <div className="glass-panel rounded-2xl p-8 border border-slate-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/60 flex items-center justify-center mx-auto text-slate-500">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">No Filters Found</p>
              <p className="text-xs text-slate-400 mt-1">
                {items.length === 0
                  ? 'No filters created yet. Tap "Add Filter" above to get started.'
                  : 'No filters match your current search or tab.'}
              </p>
            </div>
            {canEdit && (
              <button
                onClick={openAddModal}
                className="py-2 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-lg active:scale-95 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Filter</span>
              </button>
            )}
          </div>
        ) : (
          displayedItems.map((item) => {
            const isVisible = item.inFiltersList === true;
            const triggerType = item.triggerType || 'hashtag';
            const primaryTrigger = item.triggers?.[0] || (
              triggerType === 'hashtag' 
                ? (item.rawKeyword.startsWith('#') ? item.rawKeyword : `#${item.rawKeyword}`)
                : triggerType === 'slash'
                ? (item.rawKeyword.startsWith('/') ? item.rawKeyword : `/${item.rawKeyword}`)
                : item.rawKeyword
            );

            const payload = item.id.startsWith('f_') || item.id.startsWith('l_') ? item.id : `${item.type === 'file' ? 'f_' : 'l_'}${item.id}`;
            const shareableDeepLink = `https://t.me/${cleanBot}?start=${payload}`;
            const isLinkCopied = copiedLink === item.id;
            const isTagCopied = copiedTag === primaryTrigger;

            return (
              <div
                key={item.id}
                className={`glass-panel rounded-2xl p-4 border transition-all ${
                  isVisible
                    ? 'border-slate-800 hover:border-amber-500/40 bg-slate-900/80 shadow-md'
                    : 'border-slate-800/50 bg-slate-950/40 opacity-75'
                }`}
              >
                {/* Card Top Row: Trigger Badge + Type Badge + Show/Hide Toggle */}
                <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {/* Trigger Keyword Badge */}
                    <button
                      type="button"
                      onClick={() => copyKeywordTag(primaryTrigger)}
                      title="Tap to copy trigger"
                      className="font-mono text-sm font-bold px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                    >
                      {triggerType === 'hashtag' && <Hash className="w-3.5 h-3.5 text-amber-400" />}
                      {triggerType === 'slash' && <Slash className="w-3.5 h-3.5 text-amber-400" />}
                      {triggerType === 'normal' && <Terminal className="w-3.5 h-3.5 text-amber-400" />}
                      <span>{primaryTrigger}</span>
                      {isTagCopied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 opacity-60" />
                      )}
                    </button>

                    {/* Type Badge */}
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700">
                      {triggerType === 'hashtag' ? 'Hashtag (#)' : triggerType === 'slash' ? 'Slash (/)' : 'Normal Text'}
                    </span>

                    {/* Associated Item Type */}
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-slate-900 text-slate-300 flex items-center gap-1">
                      {item.type === 'file' ? (
                        <FileText className="w-3 h-3 text-sky-400" />
                      ) : (
                        <Link2 className="w-3 h-3 text-indigo-400" />
                      )}
                      <span className="capitalize">{item.type}</span>
                    </span>
                  </div>

                  {/* SHOW / HIDE EXPLICIT TOGGLE (Requirement 1) */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleVisibility(item)}
                      title={isVisible ? 'Visible in public /filters list. Click to hide.' : 'Hidden from public /filters list. Click to show.'}
                      className={`px-2.5 py-1 rounded-xl border flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all active:scale-95 ${
                        isVisible
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-800 hover:text-slate-300'
                      }`}
                    >
                      {isVisible ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          <Eye className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Show</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-slate-500" />
                          <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                          <span>Hide</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Card Body: Associated File/Link Information */}
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 mb-3 text-xs text-slate-300 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white truncate max-w-[260px]">
                      {item.name}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 shrink-0">
                      ID: {item.id}
                    </span>
                  </div>
                  {item.fileName && item.fileName !== item.name && (
                    <p className="text-[11px] text-slate-400 font-mono truncate">
                      File: {item.fileName}
                    </p>
                  )}
                  {item.url && (
                    <p className="text-[11px] text-slate-400 font-mono truncate">
                      URL: {item.url}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[10px] text-slate-400 pt-0.5">
                    <span>Deliveries: <strong className="text-white">{item.deliveryCount || 0}</strong></span>
                    <span>·</span>
                    <span>Status: <strong className={isVisible ? 'text-emerald-400' : 'text-slate-400'}>{isVisible ? 'Visible in /filters' : 'Hidden'}</strong></span>
                  </div>
                </div>

                {/* DIRECT INLINE QUICK ACTION BUTTONS (Requirement 1): [ Edit ] [ Delete ] [ Copy Link ] */}
                <div className="pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2">
                  {/* Action 1: [ Edit ] */}
                  <button
                    type="button"
                    onClick={() => openEditModal(item)}
                    className="py-2 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 hover:border-amber-500/40 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Edit</span>
                  </button>

                  {/* Action 2: [ Delete ] */}
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmItem(item)}
                    disabled={!canDelete}
                    className="py-2 px-2 rounded-xl bg-slate-900 hover:bg-rose-500/20 text-slate-200 hover:text-rose-300 border border-slate-800 hover:border-rose-500/40 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Delete</span>
                  </button>

                  {/* Action 3: [ Copy Link ] */}
                  <button
                    type="button"
                    onClick={() => copyShareableLink(item.id, shareableDeepLink)}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 ${
                      isLinkCopied
                        ? 'bg-emerald-500 text-slate-950 font-bold border border-emerald-400'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 hover:border-sky-500/40'
                    }`}
                  >
                    {isLinkCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* =========================================================================
          "ADD FILTER" MODAL / FORM POPUP (Requirement 1)
          When tapping "Add Filter" button, open clean modal containing:
          1. Type Selection: 3 Segmented/Radio buttons -> [ Hashtag Command (#) ] [ Slash Command (/) ] [ Normal Text ]
          2. Keyword Input Field: Field to type keyword name
          3. Visibility Option: Toggle/Choice for Show (visible to all) vs. Hide (hidden)
          4. Action Buttons: [ Cancel ] and [ Save ]
          ========================================================================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="glass-panel border border-slate-800 w-full max-w-md rounded-3xl p-5 max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add New Filter</h3>
                  <p className="text-[11px] text-slate-400">Configure trigger keyword &amp; visibility</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-xl bg-slate-800/80 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveAddFilter} className="space-y-4">
              {/* 1. Type Selection: 3 Segmented/Radio buttons */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  1. Trigger Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormType('hashtag')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'hashtag'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Hash className="w-4 h-4 text-amber-400" />
                    <span className="text-[11px] text-center leading-tight">Hashtag Command (#)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('slash')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'slash'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Slash className="w-4 h-4 text-amber-400" />
                    <span className="text-[11px] text-center leading-tight">Slash Command (/)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('normal')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'normal'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Terminal className="w-4 h-4 text-amber-400" />
                    <span className="text-[11px] text-center leading-tight">Normal Text</span>
                  </button>
                </div>
              </div>

              {/* 2. Keyword Input Field */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  2. Keyword Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formKeyword}
                    onChange={(e) => setFormKeyword(e.target.value)}
                    placeholder={formType === 'hashtag' ? 'e.g., box, crack, movie' : formType === 'slash' ? 'e.g., download, play' : 'e.g., tutorial, info'}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors font-mono"
                    autoFocus
                  />
                </div>
                {formKeyword.trim() && (
                  <p className="text-[11px] text-amber-400/90 mt-1.5 flex items-center gap-1 font-mono">
                    <span>Generated Trigger:</span>
                    <strong className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30">
                      {getFormattedTrigger(formKeyword, formType)}
                    </strong>
                  </p>
                )}
              </div>

              {/* Optional: Connect to existing File or Link */}
              {items.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Target File or Link
                  </label>
                  <select
                    value={formItemId}
                    onChange={(e) => setFormItemId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        [{i.type.toUpperCase()}] {i.name} (Current trigger: {i.triggers?.[0] || i.rawKeyword})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 3. Visibility Option: Toggle/Choice for Show vs. Hide */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  3. Visibility in /filters list
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormVisibility(true)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      formVisibility === true
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-4 h-4 text-emerald-400" />
                    <span>Show (Visible to all)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormVisibility(false)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      formVisibility === false
                        ? 'bg-slate-800 border-slate-600 text-slate-200 shadow-md'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <EyeOff className="w-4 h-4 text-slate-400" />
                    <span>Hide (Hidden)</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  {formVisibility 
                    ? 'Users can view this keyword when typing /filters in Telegram.'
                    : 'Hidden from public /filters list (direct exact matching still works).'}
                </p>
              </div>

              {/* 4. Action Buttons: [ Cancel ] and [ Save ] */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="py-2 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50 transition-all"
                >
                  {loading ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Save Filter</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          "EDIT FILTER" MODAL
          ========================================================================= */}
      {isEditModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="glass-panel border border-slate-800 w-full max-w-md rounded-3xl p-5 max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Filter</h3>
                  <p className="text-[11px] text-slate-400">{selectedItem.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setSelectedItem(null);
                }}
                className="p-1 rounded-xl bg-slate-800/80 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditFilter} className="space-y-4">
              {/* 1. Type Selection: 3 Segmented/Radio buttons */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  1. Trigger Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormType('hashtag')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'hashtag'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Hash className="w-4 h-4 text-amber-400" />
                    <span className="text-[11px] text-center leading-tight">Hashtag Command (#)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('slash')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'slash'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Slash className="w-4 h-4 text-amber-400" />
                    <span className="text-[11px] text-center leading-tight">Slash Command (/)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('normal')}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'normal'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Terminal className="w-4 h-4 text-amber-400" />
                    <span className="text-[11px] text-center leading-tight">Normal Text</span>
                  </button>
                </div>
              </div>

              {/* 2. Keyword Input Field */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  2. Keyword Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formKeyword}
                    onChange={(e) => setFormKeyword(e.target.value)}
                    placeholder="e.g. box, crack, tutorial"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors font-mono"
                    autoFocus
                  />
                </div>
                {formKeyword.trim() && (
                  <p className="text-[11px] text-amber-400/90 mt-1.5 flex items-center gap-1 font-mono">
                    <span>Generated Trigger:</span>
                    <strong className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30">
                      {getFormattedTrigger(formKeyword, formType)}
                    </strong>
                  </p>
                )}
              </div>

              {/* 3. Visibility Option */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  3. Visibility in /filters list
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormVisibility(true)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      formVisibility === true
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-4 h-4 text-emerald-400" />
                    <span>Show (Visible to all)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormVisibility(false)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      formVisibility === false
                        ? 'bg-slate-800 border-slate-600 text-slate-200 shadow-md'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <EyeOff className="w-4 h-4 text-slate-400" />
                    <span>Hide (Hidden)</span>
                  </button>
                </div>
              </div>

              {/* 4. Action Buttons: [ Cancel ] and [ Save ] */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedItem(null);
                  }}
                  className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="py-2 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50 transition-all"
                >
                  {loading ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          DELETE CONFIRMATION DIALOG
          ========================================================================= */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="glass-panel border border-rose-500/40 w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Filter?</h3>
                <p className="text-xs text-slate-400">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              Are you sure you want to delete filter <strong className="text-amber-400 font-mono">{deleteConfirmItem.triggers?.[0] || deleteConfirmItem.rawKeyword}</strong> ({deleteConfirmItem.name})?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setDeleteConfirmItem(null)}
                className="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteItem}
                disabled={loading}
                className="py-2 px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-rose-500/20 cursor-pointer disabled:opacity-50 transition-all"
              >
                {loading ? 'Deleting...' : 'Delete Filter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
