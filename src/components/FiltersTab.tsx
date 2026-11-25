import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ItemRecord, TriggerType, AdminUser, DesignConfig, api } from '../lib/api';
import { toast } from '../lib/toast';
import { 
  Filter, Plus, Search, Edit2, Trash2, Copy, Check, 
  FileText, Link2, Hash, Slash, Terminal,
  X, Eye, EyeOff, AlertTriangle, CheckCircle2, ChevronDown, MessageSquare
} from 'lucide-react';

interface FiltersTabProps {
  items: ItemRecord[];
  currentUser: AdminUser;
  botUsername?: string;
  design?: DesignConfig;
  onRefresh: () => void;
}

const FiltersTabComponent: React.FC<FiltersTabProps> = ({
  items,
  currentUser,
  botUsername,
  design,
  onRefresh
}) => {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'in_filters' | 'hidden'>('all');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };
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

  // Filtered list ordered newest-first (chronological descending):
  // Newly added triggers/filters appear automatically at the very top of the list.
  const displayedItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });

    return sorted.filter((item) => {
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
  // Show / Hide Toggle handler
  const handleToggleVisibility = async (item: ItemRecord) => {
    const nextVal = !(item.inFiltersList === true);
    try {
      await api.updateItem(item.id, { inFiltersList: nextVal });
      toast.success(nextVal ? 'Filter set to Visible in list' : 'Filter Hidden from list');
      onRefresh();
    } catch (err: any) {
      const msg = err.message || 'Failed to update filter visibility';
      setError(msg);
      toast.error(msg);
    }
  };

  // Delete Filter handler
  const handleDeleteItem = async () => {
    if (!deleteConfirmItem) return;
    setLoading(true);
    try {
      await api.deleteItem(deleteConfirmItem.id);
      setDeleteConfirmItem(null);
      toast.success('Filter deleted successfully');
      onRefresh();
    } catch (err: any) {
      const msg = err.message || 'Failed to delete filter';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Copy Deep Link
  const copyShareableLink = async (itemId: string, deepLink: string) => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopiedLink(itemId);
      toast.info('Deep link copied to clipboard!');
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
      toast.info(`Keyword tag copied: ${tag}`);
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
      const msg = 'Please enter a keyword name.';
      setError(msg);
      toast.error(msg);
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
      toast.success('Filter added successfully!');
      onRefresh();
    } catch (err: any) {
      const msg = err.message || 'Failed to add filter';
      setError(msg);
      toast.error(msg);
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
      const msg = 'Please enter a keyword name.';
      setError(msg);
      toast.error(msg);
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
      toast.success('Filter updated successfully!');
      onRefresh();
    } catch (err: any) {
      const msg = err.message || 'Failed to update filter';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-28 md:pb-8">
      {/* =========================================================================
          REDESIGNED FILTER HEADER (Requirement 1)
          - Title on Top: "Filter Keywords & Commands"
          - Top-Left: Active Filter Count display
          - Top-Right: "Add Filter" Button
          ========================================================================= */}
      <div className="glass-panel lg-rise rounded-[24px] p-4 space-y-3">
        {/* Title on Top */}
        <div className="border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2.5">
            <div
              className="lg-tile w-9 h-9 rounded-xl shrink-0"
              style={{
                background: 'color-mix(in srgb, #f472b6 22%, rgba(255,255,255,.06))',
                '--c': 'rgba(244,114,182,0.45)',
              } as React.CSSProperties}
            >
              <Filter className="w-4 h-4 text-pink-300" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white tracking-tight">
                Filter Keywords &amp; Commands
              </h2>
              <p className="text-[11px] text-white/60">
                Manage group triggers and public <code className="lg-kw">/filters</code> list
              </p>
            </div>
          </div>
        </div>

        {/* Top-Left: Active Filter Count | Top-Right: Add Filter Button */}
        <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-3 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-white/75">Active Filters:</span>
            <div className="lg-badge shrink-0">
              <span className="lg-dot" />
              <span className="text-xs font-extrabold font-mono text-white">{activeFilters.length}</span>
              <span className="text-[10px] text-white/65 font-semibold">in /filters</span>
            </div>
          </div>

          {canEdit && (
            <button
              onClick={openAddModal}
              className="tap py-2 px-3.5 rounded-xl text-white font-bold text-xs flex items-center gap-1.5 border border-white/25 cursor-pointer whitespace-nowrap shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--a), var(--a2))',
                boxShadow: '0 8px 20px -4px color-mix(in srgb, var(--a) 55%, transparent)',
              }}
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Add Filter</span>
            </button>
          )}
        </div>

        {/* Search and Filter View Bar */}
        <div className="space-y-2 md:space-y-0 md:flex md:items-center md:gap-3 pt-1">
          <div className="relative md:flex-1">
            <Search className="w-4 h-4 text-white/50 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keyword or trigger name..."
              className="w-full bg-white/[0.06] border border-white/15 rounded-2xl py-2.5 pl-9 pr-3 text-xs text-white placeholder-white/45 focus:outline-none focus:border-white/40 transition-colors"
            />
          </div>

          <div className="flex p-1 bg-white/[0.05] border border-white/15 rounded-2xl text-xs gap-1 md:min-w-[300px] shrink-0">
            <button
              onClick={() => setFilterMode('all')}
              className={`tap flex-1 py-1.5 px-2.5 text-center font-semibold rounded-xl cursor-pointer whitespace-nowrap ${
                filterMode === 'all' ? 'bg-white/15 text-white border border-white/25 shadow-xs' : 'text-white/60 hover:text-white'
              }`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setFilterMode('in_filters')}
              className={`tap flex-1 py-1.5 px-2.5 text-center font-semibold rounded-xl cursor-pointer whitespace-nowrap ${
                filterMode === 'in_filters' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/35' : 'text-white/60 hover:text-white'
              }`}
            >
              Visible ({activeFilters.length})
            </button>
            <button
              onClick={() => setFilterMode('hidden')}
              className={`tap flex-1 py-1.5 px-2.5 text-center font-semibold rounded-xl cursor-pointer whitespace-nowrap ${
                filterMode === 'hidden' ? 'bg-white/12 text-white/90 border border-white/20' : 'text-white/60 hover:text-white'
              }`}
            >
              Hidden ({items.length - activeFilters.length})
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          FILTER LIST & CARD ACTIONS (Accordion Collapsed by Default: Icon + Name Only)
          ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 md:gap-3.5 items-start">
        {displayedItems.length === 0 ? (
          <div className="col-span-full glass-panel rounded-2xl p-8 border border-zinc-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 flex items-center justify-center mx-auto text-zinc-500">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">No Filters Found</p>
              <p className="text-xs text-zinc-400 mt-1">
                {items.length === 0
                  ? 'No filters created yet. Tap "Add Filter" above to get started.'
                  : 'No filters match your current search or tab.'}
              </p>
            </div>
            {canEdit && (
              <button
                onClick={openAddModal}
                className="py-2 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-lg active:scale-95 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Filter</span>
              </button>
            )}
          </div>
        ) : (
          displayedItems.map((item, index) => {
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
            const isExpanded = Boolean(expandedIds[item.id]);

            return (
              <div
                key={item.id}
                className={`glass-panel rounded-2xl border transition-all ${
                  isExpanded ? 'p-4' : 'px-3.5 py-2.5'
                } ${
                  isVisible
                    ? 'border-zinc-800 hover:border-amber-500/40 bg-zinc-900/80 shadow-md'
                    : 'border-zinc-800/50 bg-zinc-950/40 opacity-85'
                }`}
              >
                {/* Minimalist Collapsed Header Row: Type Logo + Name + Expand Chevron */}
                <button
                  type="button"
                  onClick={() => toggleExpand(item.id)}
                  aria-expanded={isExpanded}
                  className="w-full flex items-center justify-between gap-3 text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="lg-tile w-9 h-9 rounded-xl shrink-0"
                      style={{
                        background: item.isTextOnly
                          ? 'color-mix(in srgb, #c084fc 22%, rgba(255,255,255,.06))'
                          : item.type === 'file'
                          ? 'color-mix(in srgb, #60a5fa 22%, rgba(255,255,255,.06))'
                          : 'color-mix(in srgb, #818cf8 22%, rgba(255,255,255,.06))',
                        '--c': item.isTextOnly
                          ? 'rgba(192,132,252,0.4)'
                          : item.type === 'file'
                          ? 'rgba(96,165,250,0.4)'
                          : 'rgba(129,140,248,0.4)',
                      } as React.CSSProperties}
                    >
                      {item.isTextOnly ? (
                        <MessageSquare className="w-4 h-4 text-purple-300" />
                      ) : item.type === 'file' ? (
                        <FileText className="w-4 h-4 text-sky-300" />
                      ) : (
                        <Link2 className="w-4 h-4 text-indigo-300" />
                      )}
                    </div>
                    <div className="text-sm font-bold text-white truncate min-w-0 flex-1">
                      {item.name}
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-white/50 group-hover:text-white/85 shrink-0 transition-transform duration-300 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Accordion Body: Expanded Filter Metadata & Quick Actions */}
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                    isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="pt-3">
                      {/* Card Top Row: Sequence # + Trigger Badge + Type Badge + Show/Hide Toggle */}
                      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {/* Sequential FIFO Index Badge */}
                          <span 
                            className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-zinc-800/90 text-zinc-300 border border-zinc-700/60 shadow-xs" 
                            title={`Filter #${index + 1} (Sequential chronological FIFO order)`}
                          >
                            #{index + 1}
                          </span>

                          {/* Trigger Keyword Badge */}
                          <button
                            type="button"
                            onClick={() => copyKeywordTag(primaryTrigger)}
                            title="Tap to copy trigger"
                            className="max-w-full min-w-0 font-mono text-sm font-bold px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                          >
                            {triggerType === 'hashtag' && <Hash className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                            {triggerType === 'slash' && <Slash className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                            {triggerType === 'normal' && <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                            <span className="truncate">{primaryTrigger}</span>
                            {isTagCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <Copy className="w-3 h-3 opacity-60 shrink-0" />
                            )}
                          </button>

                          {/* Type Badge */}
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700">
                            {triggerType === 'hashtag' ? 'Hashtag (#)' : triggerType === 'slash' ? 'Slash (/)' : 'Normal Text'}
                          </span>

                          {/* Associated Item Type */}
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-zinc-900 text-zinc-300 flex items-center gap-1">
                            {item.type === 'file' ? (
                              <FileText className="w-3 h-3 text-red-400" />
                            ) : (
                              <Link2 className="w-3 h-3 text-indigo-400" />
                            )}
                            <span className="capitalize">{item.type}</span>
                          </span>
                        </div>

                        {/* SHOW / HIDE EXPLICIT TOGGLE */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleToggleVisibility(item)}
                            title={isVisible ? 'Visible in public /filters list. Click to hide.' : 'Hidden from public /filters list. Click to show.'}
                            className={`px-2.5 py-1 rounded-xl border flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all active:scale-95 ${
                              isVisible
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                                : 'bg-zinc-800/80 text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-300'
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
                                <span className="w-2 h-2 rounded-full bg-zinc-500" />
                                <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
                                <span>Hide</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Card Body: Associated File/Link Information */}
                      <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 mb-3 text-xs text-zinc-300 space-y-1">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-semibold text-white min-w-0 flex-1 truncate">
                            {item.name}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                            ID: {item.id}
                          </span>
                        </div>
                        {item.fileName && item.fileName !== item.name && (
                          <p className="text-[11px] text-zinc-400 font-mono truncate">
                            File: {item.fileName}
                          </p>
                        )}
                        {item.url && (
                          <p className="text-[11px] text-zinc-400 font-mono truncate">
                            URL: {item.url}
                          </p>
                        )}
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-400 pt-0.5">
                          <span>Deliveries: <strong className="text-white">{item.deliveryCount || 0}</strong></span>
                          <span>·</span>
                          <span>Status: <strong className={isVisible ? 'text-emerald-400' : 'text-zinc-400'}>{isVisible ? 'Visible in /filters' : 'Hidden'}</strong></span>
                        </div>
                      </div>

                      {/* DIRECT INLINE QUICK ACTION BUTTONS: [ Edit ] [ Delete ] [ Copy Link ] */}
                      <div className="pt-2.5 border-t border-white/10 grid grid-cols-3 gap-1.5 sm:gap-2">
                        {/* Action 1: [ Edit ] */}
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="tap min-w-0 py-2 px-1.5 min-[360px]:px-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.14] text-white border border-white/15 text-[11px] min-[360px]:text-xs font-semibold flex items-center justify-center gap-1 min-[360px]:gap-1.5 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                          <span className="truncate">Edit</span>
                        </button>

                        {/* Action 2: [ Delete ] */}
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmItem(item)}
                          disabled={!canDelete}
                          className="tap min-w-0 py-2 px-1.5 min-[360px]:px-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 border border-rose-400/25 text-[11px] min-[360px]:text-xs font-semibold flex items-center justify-center gap-1 min-[360px]:gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                          <span className="truncate">Delete</span>
                        </button>

                        {/* Action 3: [ Copy Link ] */}
                        <button
                          type="button"
                          onClick={() => copyShareableLink(item.id, shareableDeepLink)}
                          className={`tap min-w-0 py-2 px-1.5 min-[360px]:px-2 rounded-xl text-[11px] min-[360px]:text-xs font-semibold flex items-center justify-center gap-1 min-[360px]:gap-1.5 cursor-pointer border ${
                            isLinkCopied
                              ? 'bg-emerald-500/25 text-emerald-200 font-bold border-emerald-400/45'
                              : 'bg-white/[0.07] hover:bg-white/[0.14] text-cyan-200 border-white/15'
                          }`}
                        >
                          {isLinkCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-300 stroke-[3] shrink-0" />
                              <span className="truncate">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                              <span className="truncate">Copy Link</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
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
      {isAddModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="glass-panel border border-zinc-800 w-full max-w-md md:max-w-xl rounded-3xl p-4 sm:p-5 max-h-[90dvh] overflow-y-auto overscroll-contain space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">Add New Filter</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-xl bg-zinc-800/80 text-zinc-400 hover:text-white cursor-pointer shrink-0"
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
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  1. Trigger Type
                </label>
                <div className="grid grid-cols-3 max-[329px]:grid-cols-1 gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setFormType('hashtag')}
                    className={`min-w-0 py-2 px-1.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'hashtag'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Hash className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-[10.5px] sm:text-[11px] text-center leading-tight">Hashtag Command (#)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('slash')}
                    className={`min-w-0 py-2 px-1.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'slash'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Slash className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-[10.5px] sm:text-[11px] text-center leading-tight">Slash Command (/)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('normal')}
                    className={`min-w-0 py-2 px-1.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'normal'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-[10.5px] sm:text-[11px] text-center leading-tight">Normal Text</span>
                  </button>
                </div>
              </div>

              {/* 2. Keyword Input Field */}
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">
                  2. Keyword Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formKeyword}
                    onChange={(e) => setFormKeyword(e.target.value)}
                    placeholder="Enter Filter Name"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 px-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 transition-colors font-mono"
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
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">
                    Target File or Link
                  </label>
                  <select
                    value={formItemId}
                    onChange={(e) => setFormItemId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
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
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  3. Visibility in /filters list
                </label>
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormVisibility(true)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      formVisibility === true
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
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
                        ? 'bg-zinc-800 border-zinc-600 text-zinc-200 shadow-md'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <EyeOff className="w-4 h-4 text-zinc-400" />
                    <span>Hide (Hidden)</span>
                  </button>
                </div>
              </div>

              {/* 4. Action Buttons: [ Cancel ] and [ Save ] */}
              <div className="pt-2 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="py-2 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs cursor-pointer shadow-md shadow-red-600/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="py-2 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/30 cursor-pointer disabled:opacity-50 transition-all"
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
        </div>,
        document.body
      )}

      {/* =========================================================================
          "EDIT FILTER" MODAL
          ========================================================================= */}
      {isEditModalOpen && selectedItem && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="glass-panel border border-zinc-800 w-full max-w-md md:max-w-xl rounded-3xl p-4 sm:p-5 max-h-[90dvh] overflow-y-auto overscroll-contain space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">Edit Filter</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setSelectedItem(null);
                }}
                className="p-1 rounded-xl bg-zinc-800/80 text-zinc-400 hover:text-white cursor-pointer shrink-0"
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
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  1. Trigger Type
                </label>
                <div className="grid grid-cols-3 max-[329px]:grid-cols-1 gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setFormType('hashtag')}
                    className={`min-w-0 py-2 px-1.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'hashtag'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Hash className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-[10.5px] sm:text-[11px] text-center leading-tight">Hashtag Command (#)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('slash')}
                    className={`min-w-0 py-2 px-1.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'slash'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Slash className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-[10.5px] sm:text-[11px] text-center leading-tight">Slash Command (/)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('normal')}
                    className={`min-w-0 py-2 px-1.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      formType === 'normal'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-[10.5px] sm:text-[11px] text-center leading-tight">Normal Text</span>
                  </button>
                </div>
              </div>

              {/* 2. Keyword Input Field */}
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">
                  2. Keyword Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formKeyword}
                    onChange={(e) => setFormKeyword(e.target.value)}
                    placeholder="Enter Filter Name"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 px-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 transition-colors font-mono"
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
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  3. Visibility in /filters list
                </label>
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormVisibility(true)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      formVisibility === true
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-500/10'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
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
                        ? 'bg-zinc-800 border-zinc-600 text-zinc-200 shadow-md'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <EyeOff className="w-4 h-4 text-zinc-400" />
                    <span>Hide (Hidden)</span>
                  </button>
                </div>
              </div>

              {/* 4. Action Buttons: [ Cancel ] and [ Save ] */}
              <div className="pt-2 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedItem(null);
                  }}
                  className="py-2 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs cursor-pointer shadow-md shadow-red-600/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="py-2 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/30 cursor-pointer disabled:opacity-50 transition-all"
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
        </div>,
        document.body
      )}

      {/* =========================================================================
          DELETE CONFIRMATION DIALOG
          ========================================================================= */}
      {deleteConfirmItem && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="glass-panel border border-rose-500/40 w-full max-w-sm rounded-3xl p-4 sm:p-5 max-h-[90dvh] overflow-y-auto space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">Delete Filter?</h3>
                <p className="text-xs text-zinc-400">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80 break-words">
              Are you sure you want to delete filter <strong className="text-amber-400 font-mono">{deleteConfirmItem.triggers?.[0] || deleteConfirmItem.rawKeyword}</strong> ({deleteConfirmItem.name})?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() => setDeleteConfirmItem(null)}
                className="py-2 px-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs cursor-pointer shadow-md shadow-red-600/30 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteItem}
                disabled={loading}
                className="py-2 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-red-700/30 cursor-pointer disabled:opacity-50 transition-all"
              >
                {loading ? 'Deleting...' : 'Delete Filter'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export const FiltersTab = React.memo(FiltersTabComponent);
