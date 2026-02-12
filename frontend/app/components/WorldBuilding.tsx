'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import {
  WorldBuildingEntry,
  WB_CATEGORIES,
  getWorldBuildingByBook,
  createWorldBuildingEntry,
  updateWorldBuildingEntry,
  deleteWorldBuildingEntry,
} from '../lib/db';

// Inline markdown renderer (same logic as page.tsx)
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i} className="italic text-[var(--accent)]/80">{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-[var(--bg-surface)] text-[var(--accent)] px-1.5 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

function renderFeedbackLine(line: string, i: number): ReactNode {
  let trimmed = line.trim();
  trimmed = trimmed
    .replace(/^\*\*(#{1,5})\s+(.+?)\*\*\s*$/, '$1 $2')
    .replace(/^(#{1,5})\s*\*\*(#{1,5})\s+(.+?)\*\*/, '$1 $3')
    .replace(/^(#{1,5})\s+(#{1,5})\s+/, '$1 ')
    .replace(/^(#{1,5})(\*\*)/, '$1 $2');

  if (trimmed === '') return <div key={i} className="h-2" />;
  if (/^[-*_]{3,}$/.test(trimmed)) return <hr key={i} className="border-zinc-700/50 my-3" />;

  const headingMatch = trimmed.match(/^(#{1,5})\s+(.+)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const content = headingMatch[2].replace(/\s*#+\s*$/, '').replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1');
    if (level <= 2) {
      return <h2 key={i} className="text-base font-semibold text-[var(--text-primary)] mb-3 mt-4 first:mt-0 pb-1.5 border-b border-[var(--border-subtle)]">{renderInline(content)}</h2>;
    }
    return <h3 key={i} className="text-sm font-semibold text-[var(--accent)] mt-4 mb-2 flex items-center gap-2"><span className="w-0.5 h-3.5 bg-[var(--accent)] rounded-full inline-block flex-shrink-0 opacity-60" />{renderInline(content)}</h3>;
  }

  if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) {
    const inner = trimmed.replace(/^\*\*/, '').replace(/\*\*:?\s*$/, '');
    return <h4 key={i} className="text-sm font-semibold text-[var(--text-primary)] mt-4 mb-1.5">{inner}</h4>;
  }

  if (trimmed.startsWith('> ') || trimmed === '>') {
    const content = trimmed.startsWith('> ') ? trimmed.slice(2) : '';
    return <blockquote key={i} className="border-l-2 border-[var(--accent)]/30 pl-3 py-1.5 my-1.5 bg-[var(--accent-soft)] rounded-r-lg text-[var(--text-secondary)] italic text-sm leading-relaxed">{renderInline(content)}</blockquote>;
  }

  if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || /^\*\s+[^*]/.test(trimmed)) {
    const content = trimmed.startsWith('- ') || trimmed.startsWith('• ') ? trimmed.slice(2) : trimmed.slice(trimmed.indexOf(' ') + 1);
    return <div key={i} className="flex gap-2 my-1 ml-2 text-sm leading-relaxed text-[var(--text-secondary)]"><span className="text-[var(--accent)] mt-0.5 flex-shrink-0">•</span><span>{renderInline(content)}</span></div>;
  }

  return <p key={i} className="text-[var(--text-secondary)] text-sm leading-relaxed my-1">{renderInline(line)}</p>;
}

type Reviewer = { id: string; name: string };

interface Props {
  bookId: string;
  bookSummary: string;
  reviewers: Reviewer[];
}

export default function WorldBuilding({ bookId, bookSummary, reviewers }: Props) {
  const [entries, setEntries] = useState<WorldBuildingEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<WorldBuildingEntry | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [newEntryTitle, setNewEntryTitle] = useState('');
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [aiFeedback, setAiFeedback] = useState('');
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [loadingAutofill, setLoadingAutofill] = useState(false);
  const [selectedReviewer, setSelectedReviewer] = useState<string>('');
  const [editorHeight, setEditorHeight] = useState(50); // percentage for vertical split
  const [isDragging, setIsDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const titleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Drag to resize editor/feedback split
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setEditorHeight(Math.min(85, Math.max(15, pct)));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('resizing-v');
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('resizing-v');
    };
  }, [isDragging]);

  // Load entries when bookId changes
  useEffect(() => {
    loadEntries();
    setSelectedEntry(null);
    setAiFeedback('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const loadEntries = async () => {
    const all = await getWorldBuildingByBook(bookId);
    setEntries(all);
    // Auto-expand categories that have entries
    const cats = new Set(all.map(e => e.category));
    setExpandedCategories(cats);
  };

  // Group entries by category
  const entriesByCategory: Record<string, WorldBuildingEntry[]> = {};
  for (const entry of entries) {
    if (!entriesByCategory[entry.category]) {
      entriesByCategory[entry.category] = [];
    }
    entriesByCategory[entry.category].push(entry);
  }

  // Get categories that have entries + sort
  const activeCategories = Object.keys(entriesByCategory).sort((a, b) => {
    const aIdx = WB_CATEGORIES.findIndex(c => c.id === a);
    const bIdx = WB_CATEGORIES.findIndex(c => c.id === b);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  const getCategoryInfo = (catId: string) => {
    return WB_CATEGORIES.find(c => c.id === catId) || { id: catId, label: catId, icon: '📝' };
  };

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const handleAddCategory = (catId: string) => {
    setAddingToCategory(catId);
    setNewEntryTitle('');
    setShowAddMenu(false);
    // Auto-expand
    setExpandedCategories(prev => new Set([...prev, catId]));
  };

  const handleCreateEntry = async () => {
    if (!addingToCategory || !newEntryTitle.trim()) return;
    const entry = await createWorldBuildingEntry(bookId, addingToCategory, newEntryTitle.trim());
    setEntries(prev => [...prev, entry]);
    setAddingToCategory(null);
    setNewEntryTitle('');
    setSelectedEntry(entry);
    setEditContent('');
    setEditTitle(entry.title);
    setAiFeedback('');
  };

  const handleSelectEntry = (entry: WorldBuildingEntry) => {
    // Save current entry before switching
    flushSave();
    setSelectedEntry(entry);
    setEditContent(entry.content);
    setEditTitle(entry.title);
    setAiFeedback(entry.aiFeedback || '');
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Supprimer cet élément ?')) return;
    await deleteWorldBuildingEntry(entryId);
    setEntries(prev => prev.filter(e => e.id !== entryId));
    if (selectedEntry?.id === entryId) {
      setSelectedEntry(null);
      setEditContent('');
      setEditTitle('');
      setAiFeedback('');
    }
  };

  const flushSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (titleTimeoutRef.current) {
      clearTimeout(titleTimeoutRef.current);
      titleTimeoutRef.current = null;
    }
    if (selectedEntry) {
      updateWorldBuildingEntry(selectedEntry.id, { content: editContent, title: editTitle });
    }
  };

  const handleContentChange = (value: string) => {
    setEditContent(value);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (selectedEntry) {
        updateWorldBuildingEntry(selectedEntry.id, { content: value });
        setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, content: value, updatedAt: new Date() } : e));
      }
    }, 800);
  };

  const handleTitleChange = (value: string) => {
    setEditTitle(value);
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    titleTimeoutRef.current = setTimeout(() => {
      if (selectedEntry) {
        updateWorldBuildingEntry(selectedEntry.id, { title: value });
        setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, title: value } : e));
        setSelectedEntry(prev => prev ? { ...prev, title: value } : null);
      }
    }, 800);
  };

  const handleGetFeedback = async () => {
    if (!selectedEntry || !editContent.trim()) return;
    setLoadingFeedback(true);
    setAiFeedback('');

    // Build FULL context from all other entries (no truncation for mistral-large-latest)
    const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
    const contextParts = otherEntries.map(e => {
      const cat = getCategoryInfo(e.category);
      return `[${cat.label}] ${e.title} :\n${e.content}`;
    });
    const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

    try {
      const response = await fetch('http://localhost:8000/world-building/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_title: editTitle,
          entry_content: editContent,
          category: getCategoryInfo(selectedEntry.category).label,
          reviewer: selectedReviewer || null,
          book_summary: bookSummary || null,
          all_entries_context: allEntriesContext,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Pas de stream disponible');

      let fullFeedback = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullFeedback += chunk;
        setAiFeedback(prev => prev + chunk);
      }

      // Save feedback to DB
      if (fullFeedback) {
        await updateWorldBuildingEntry(selectedEntry.id, { aiFeedback: fullFeedback });
        setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, aiFeedback: fullFeedback } : e));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      setAiFeedback(`Erreur : ${msg}`);
    } finally {
      setLoadingFeedback(false);
    }
  };

  const handleAutofill = async () => {
    if (!selectedEntry) return;
    setLoadingAutofill(true);

    // Build context from all other entries (full content)
    const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
    const contextParts = otherEntries.map(e => {
      const cat = getCategoryInfo(e.category);
      return `[${cat.label}] ${e.title} :\n${e.content}`;
    });
    const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

    try {
      const response = await fetch('http://localhost:8000/world-building/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_title: editTitle,
          entry_content: editContent || null,
          category: selectedEntry.category,
          book_summary: bookSummary || null,
          all_entries_context: allEntriesContext,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Pas de stream disponible');

      // If there's existing content, append after a separator
      let newContent = editContent;
      if (newContent.trim()) {
        newContent += '\n\n--- Complété par IA ---\n\n';
      }

      let generated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        generated += chunk;
        const fullContent = editContent.trim()
          ? editContent + '\n\n--- Complété par IA ---\n\n' + generated
          : generated;
        setEditContent(fullContent);
      }

      // Save to DB
      const finalContent = editContent.trim()
        ? editContent + '\n\n--- Complété par IA ---\n\n' + generated
        : generated;
      await updateWorldBuildingEntry(selectedEntry.id, { content: finalContent });
      setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, content: finalContent, updatedAt: new Date() } : e));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      alert(`Erreur auto-fill : ${msg}`);
    } finally {
      setLoadingAutofill(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Categories & Entries list */}
      <div className="w-72 flex-shrink-0 border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-secondary)]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-[var(--text-primary)] font-semibold text-sm tracking-tight flex items-center gap-2">
            <span className="text-base">🌍</span> World Building
          </h2>
          <div className="relative">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="px-2.5 py-1 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-sm rounded-lg transition-all"
            >
              + Ajouter
            </button>
            {showAddMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-xl shadow-2xl z-50 py-1.5 max-h-80 overflow-y-auto">
                {WB_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => handleAddCategory(cat.id)}
                    className="w-full px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--accent)]/10 transition-colors flex items-center gap-2.5"
                  >
                    <span className="text-base">{cat.icon}</span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Categories list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {activeCategories.length === 0 && !addingToCategory && (
            <div className="text-center py-10 px-4">
              <p className="text-[var(--text-muted)] text-sm mb-1">Aucun élément</p>
              <p className="text-[var(--text-muted)]/60 text-xs">Cliquez sur « + Ajouter » pour construire votre univers</p>
            </div>
          )}

          {activeCategories.map(catId => {
            const catInfo = getCategoryInfo(catId);
            const catEntries = entriesByCategory[catId] || [];
            const isExpanded = expandedCategories.has(catId);

            return (
              <div key={catId} className="mb-1">
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(catId)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-lg transition-all"
                >
                  <span className="text-xs text-[var(--text-muted)] transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                  <span className="text-base">{catInfo.icon}</span>
                  <span>{catInfo.label}</span>
                  <span className="ml-auto text-[var(--text-muted)] text-xs">{catEntries.length}</span>
                </button>

                {/* Entries */}
                {isExpanded && (
                  <div className="ml-3 pl-3 border-l border-[var(--border-subtle)]">
                    {catEntries.map(entry => (
                      <div
                        key={entry.id}
                        className={`px-3 py-1.5 cursor-pointer flex items-center justify-between group rounded-md my-0.5 transition-all ${
                          selectedEntry?.id === entry.id
                            ? 'bg-[var(--accent-glow)] border-l-2 border-l-[var(--accent)]'
                            : 'hover:bg-[var(--bg-surface)]'
                        }`}
                        onClick={() => handleSelectEntry(entry)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-sm truncate ${selectedEntry?.id === entry.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                            {entry.title}
                          </span>
                          {entry.aiFeedback && (
                            <span className="text-[10px] text-emerald-400/60 flex-shrink-0" title="Avis IA disponible">✦</span>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id); }}
                          className="text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition-opacity flex-shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* Quick add in this category */}
                    <button
                      onClick={() => { setAddingToCategory(catId); setNewEntryTitle(''); }}
                      className="w-full px-3 py-1 text-left text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                    >
                      + ajouter…
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* New entry form (when adding) */}
          {addingToCategory && (
            <div className="mt-2 mx-1 p-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{getCategoryInfo(addingToCategory).icon}</span>
                <span className="text-sm text-[var(--text-secondary)] font-medium">{getCategoryInfo(addingToCategory).label}</span>
              </div>
              <input
                type="text"
                placeholder="Nom de l'élément…"
                value={newEntryTitle}
                onChange={(e) => setNewEntryTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateEntry();
                  if (e.key === 'Escape') { setAddingToCategory(null); setNewEntryTitle(''); }
                }}
                autoFocus
                className="input-writer w-full px-3 py-1.5 text-sm text-[var(--text-primary)] rounded-lg mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateEntry}
                  disabled={!newEntryTitle.trim()}
                  className="flex-1 px-3 py-1.5 bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--accent)] text-xs rounded-lg transition-all disabled:opacity-30"
                >
                  Créer
                </button>
                <button
                  onClick={() => { setAddingToCategory(null); setNewEntryTitle(''); }}
                  className="px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs rounded-lg transition-all"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Entry editor + AI feedback */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedEntry ? (
          <>
            {/* Entry header */}
            <div className="flex-shrink-0 px-6 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] flex items-center gap-3">
              <span className="text-lg">{getCategoryInfo(selectedEntry.category).icon}</span>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="input-writer flex-1 px-3 py-1.5 text-[var(--text-primary)] text-sm font-medium rounded-lg bg-transparent border-transparent hover:border-[var(--border-subtle)] focus:border-[var(--accent)]/40"
              />
              <span className="text-[var(--text-muted)] text-xs">
                {getCategoryInfo(selectedEntry.category).label}
              </span>
            </div>

            {/* Content area split: editor top, feedback bottom */}
            <div className="flex-1 flex flex-col overflow-hidden" ref={splitContainerRef}>
              {/* Content editor */}
              <div className="min-h-0 overflow-y-auto" style={{ height: `${editorHeight}%` }}>
                <div className="px-6 py-5 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[var(--text-muted)] text-[11px] font-medium tracking-widest uppercase">Description</label>
                    <button
                      onClick={handleAutofill}
                      disabled={loadingAutofill || loadingFeedback}
                      className="px-3 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-xs font-medium rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {loadingAutofill ? (
                        <><span className="loading-cursor">▊</span> Génération…</>
                      ) : (
                        <><span>🤖</span> {editContent.trim() ? 'Développer par IA' : 'Remplir par IA'}</>
                      )}
                    </button>
                  </div>
                  <textarea
                    className="input-writer w-full flex-1 min-h-[100px] p-4 text-[var(--text-secondary)] placeholder-[var(--text-muted)] rounded-xl resize-none leading-relaxed text-sm"
                    placeholder="Décrivez cet élément de votre univers en détail…"
                    value={editContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[var(--text-muted)] text-xs tabular-nums">{editContent.length} car.</span>
                  </div>
                </div>
              </div>

              {/* Draggable Divider */}
              {isDragging && (
                <div className="fixed inset-0 z-50" style={{ cursor: 'row-resize' }} />
              )}
              <div
                style={{
                  height: '6px',
                  width: '100%',
                  cursor: 'row-resize',
                  flexShrink: 0,
                  backgroundColor: isDragging ? '#c9a55a' : '#333',
                  position: 'relative',
                  zIndex: 10,
                  transition: 'background-color 0.15s',
                }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onMouseEnter={(e) => { if (!isDragging) (e.currentTarget as HTMLElement).style.backgroundColor = '#c9a55a'; }}
                onMouseLeave={(e) => { if (!isDragging) (e.currentTarget as HTMLElement).style.backgroundColor = '#333'; }}
              />

              {/* AI Feedback section */}
              <div className="min-h-0 overflow-y-auto" style={{ height: `${100 - editorHeight}%` }}>
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[var(--text-muted)] text-[11px] font-medium tracking-widest uppercase flex items-center gap-2">
                      <span className="text-base">✦</span> Avis IA
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        className="input-writer px-2 py-1.5 rounded-lg text-[var(--text-secondary)] text-xs"
                        value={selectedReviewer}
                        onChange={(e) => setSelectedReviewer(e.target.value)}
                      >
                        <option value="">Consultant générique</option>
                        {reviewers.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleGetFeedback}
                        disabled={loadingFeedback || loadingAutofill || !editContent.trim()}
                        className="px-4 py-2 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-medium rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {loadingFeedback ? 'Analyse en cours…' : 'Demander un avis'}
                      </button>
                    </div>
                  </div>

                  {(aiFeedback || loadingFeedback) ? (
                    <div className="p-5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl">
                      <div className="critique-content">
                        {aiFeedback.split('\n').map((line, i) => renderFeedbackLine(line, i))}
                        {loadingFeedback && <span className="loading-cursor text-[var(--accent)] text-lg">▊</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="p-5 bg-[var(--bg-surface)]/50 border border-dashed border-[var(--border-subtle)] rounded-xl text-center">
                      <p className="text-[var(--text-muted)] text-sm">Cliquez sur « Demander un avis » pour obtenir un retour IA sur cet élément</p>
                      <p className="text-[var(--text-muted)]/60 text-xs mt-1">L&apos;IA analysera la cohérence, l&apos;originalité et proposera des améliorations</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/5 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🌍</span>
              </div>
              <p className="text-[var(--text-muted)] text-lg font-light mb-1">World Building</p>
              <p className="text-[var(--text-muted)]/60 text-sm max-w-sm">
                Construisez l&apos;univers de votre ouvrage : personnages, magie, lieux, politique, et plus encore. Sélectionnez ou créez un élément pour commencer.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Close add menu on outside click */}
      {showAddMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
      )}
    </div>
  );
}
