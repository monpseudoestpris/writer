'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import {
  WorldBuildingEntry,
  WBFeedbackEntry,
  WB_CATEGORIES,
  TextVersion,
  getWorldBuildingByBook,
  createWorldBuildingEntry,
  updateWorldBuildingEntry,
  deleteWorldBuildingEntry,
  getWBFeedbacksByEntry,
  saveWBFeedback,
  deleteWBFeedback,
  getFavoritePanel,
  saveFavoritePanel,
  getChatSession,
  saveChatSession,
  ChatSession,
  saveTextVersion,
  getTextVersions,
  deleteTextVersion,
} from '../lib/db';
import RichEditor, { EditorToolbar } from './RichEditor';
import type { Editor } from '@tiptap/react';

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

// Render a markdown table from grouped lines
function renderMarkdownTable(lines: string[], keyBase: number): ReactNode {
  const parseRow = (line: string) =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

  const rows = lines.filter(l => !/^\|?\s*[-:]+[-|:\s]*\|?\s*$/.test(l));
  if (rows.length === 0) return null;

  const header = parseRow(rows[0]);
  const body = rows.slice(1).map(parseRow);

  return (
    <div key={`table-${keyBase}`} className="my-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[var(--bg-surface)]">
            {header.map((cell, j) => (
              <th key={j} className="px-4 py-2.5 text-left text-xs font-bold text-[var(--accent)] uppercase tracking-wider border-b border-[var(--border-subtle)]">
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-surface)]/50'}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2 text-[var(--text-secondary)] border-b border-[var(--border-subtle)]/50 leading-relaxed">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Parse AI feedback into selectable comment blocks
// Render full markdown content with table support
function renderMarkdownContent(text: string, lineRenderer: (line: string, i: number) => ReactNode, onApplySuggestion?: (text: string, original?: string) => void): ReactNode[] {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect fenced code blocks: ```lang ... ```
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const codeContent = codeLines.join('\n');

      if (lang === 'suggestion') {
        // Parse ORIGINAL: ... --- REMPLACEMENT: ... format
        const separatorIdx = codeLines.findIndex(l => l.trim() === '---');
        let originalText: string | undefined;
        let replacementText: string;

        if (separatorIdx !== -1) {
          const beforeSep = codeLines.slice(0, separatorIdx);
          const afterSep = codeLines.slice(separatorIdx + 1);
          // Remove "ORIGINAL:" prefix line
          const origStart = beforeSep.findIndex(l => /^ORIGINAL\s*:/i.test(l.trim()));
          if (origStart !== -1) {
            const origLabel = beforeSep[origStart].replace(/^ORIGINAL\s*:/i, '').trim();
            originalText = [origLabel, ...beforeSep.slice(origStart + 1)].filter(l => l).join('\n').trim();
          } else {
            originalText = beforeSep.join('\n').trim();
          }
          // Remove "REMPLACEMENT:" prefix line
          const replStart = afterSep.findIndex(l => /^REMPLACEMENT\s*:/i.test(l.trim()));
          if (replStart !== -1) {
            const replLabel = afterSep[replStart].replace(/^REMPLACEMENT\s*:/i, '').trim();
            replacementText = [replLabel, ...afterSep.slice(replStart + 1)].filter(l => l).join('\n').trim();
          } else {
            replacementText = afterSep.join('\n').trim();
          }
        } else {
          replacementText = codeContent;
        }

        elements.push(
          <div key={`suggestion-${i}`} className="my-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
            <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between">
              <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wider">✍️ Suggestion de réécriture</span>
              {onApplySuggestion && (
                <button
                  onClick={() => onApplySuggestion(replacementText, originalText)}
                  className="px-3 py-1 text-xs font-medium rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-all"
                >
                  Appliquer
                </button>
              )}
            </div>
            {originalText && (
              <div className="px-4 py-2 border-b border-white/5">
                <div className="text-xs text-red-400/70 font-semibold uppercase mb-1">Passage original</div>
                <div className="text-sm text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap line-through decoration-red-400/40">{originalText}</div>
              </div>
            )}
            <div className="px-4 py-3">
              {originalText && <div className="text-xs text-emerald-400/70 font-semibold uppercase mb-1">Remplacement</div>}
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{replacementText}</div>
            </div>
          </div>
        );
      } else {
        elements.push(
          <pre key={`code-${i}`} className="my-2 p-3 rounded-lg bg-[var(--bg-surface)] border border-white/5 overflow-x-auto">
            <code className="text-sm text-[var(--text-secondary)] leading-relaxed">{codeContent}</code>
          </pre>
        );
      }
      continue;
    }

    if (/\|/.test(line) && !/^[-*_]{3,}$/.test(line.trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && /\|/.test(lines[i]) && !/^[-*_]{3,}$/.test(lines[i].trim())) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 3 && tableLines.some(l => /^\|?\s*[-:]+[-|:\s]*\|?\s*$/.test(l))) {
        elements.push(renderMarkdownTable(tableLines, i));
      } else {
        tableLines.forEach((tl, ti) => elements.push(lineRenderer(tl, i - tableLines.length + ti)));
      }
    } else {
      elements.push(lineRenderer(line, i));
      i++;
    }
  }

  return elements;
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

const htmlToPlainText = (html: string): string => {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
};

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
  const [feedbackHistory, setFeedbackHistory] = useState<WBFeedbackEntry[]>([]);
  const [viewingFeedbackId, setViewingFeedbackId] = useState<string | null>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [loadingAutofill, setLoadingAutofill] = useState(false);
  const [selectedReviewer, setSelectedReviewer] = useState<string>('');
  const [showWBPanel, setShowWBPanel] = useState(true);
  const [feedbackFullscreen, setFeedbackFullscreen] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(true);
  const [wbLayoutMode, setWbLayoutMode] = useState<'horizontal' | 'vertical'>('horizontal');
  const [editorHeight, setEditorHeight] = useState(50); // percentage for both axes
  const [isDragging, setIsDragging] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const wbEditorRef = useRef<Editor | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const titleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [textSummary, setTextSummary] = useState('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [showSummaryPopup, setShowSummaryPopup] = useState(false);
  const [summaryHeight, setSummaryHeight] = useState(250);
  const [favoritePanel, setFavoritePanel] = useState<string[]>([]);
  const [showPanelConfig, setShowPanelConfig] = useState(false);
  // Chat with reviewer
  const [chatMessages, setChatMessages] = useState<{role: string; content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState<{
    reviewerId?: string;
    reviewerIds?: string[];
    initialFeedback: string;
  } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Chat summarization: every 5 messages, summarize batch with mistral-small
  const [chatSummaries, setChatSummaries] = useState<string[]>([]);
  const [summarizedCount, setSummarizedCount] = useState(0);
  const chatSummariesRef = useRef<string[]>([]);
  const summarizedCountRef = useRef(0);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  // Text versioning (git-like snapshots)
  const [versions, setVersions] = useState<TextVersion[]>([]);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  // Rewrite
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [showRewriteModal, setShowRewriteModal] = useState(false);
  const [rewriteResult, setRewriteResult] = useState('');
  const [rewriteInstructions, setRewriteInstructions] = useState('');

  // Refs to track latest values for unmount flush
  const selectedEntryRef = useRef<WorldBuildingEntry | null>(null);
  const editContentRef = useRef('');
  const editTitleRef = useRef('');

  // Drag to resize editor/feedback split
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      let pct: number;
      if (wbLayoutMode === 'horizontal') {
        pct = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        pct = ((e.clientY - rect.top) / rect.height) * 100;
      }
      setEditorHeight(Math.min(85, Math.max(15, pct)));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add(wbLayoutMode === 'horizontal' ? 'resizing-h' : 'resizing-v');
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('resizing-h', 'resizing-v');
    };
  }, [isDragging, wbLayoutMode]);

  // Load entries when bookId changes
  useEffect(() => {
    // Flush any pending save before loading new book
    if (selectedEntryRef.current) {
      updateWorldBuildingEntry(selectedEntryRef.current.id, {
        content: editContentRef.current,
        title: editTitleRef.current,
      });
    }
    loadEntries();
    getFavoritePanel().then(p => { if (p.length) setFavoritePanel(p); });
    setSelectedEntry(null);
    selectedEntryRef.current = null;
    setAiFeedback('');
    setFeedbackHistory([]);
    setViewingFeedbackId(null);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (titleTimeoutRef.current) {
        clearTimeout(titleTimeoutRef.current);
        titleTimeoutRef.current = null;
      }
      // Save latest content/title to DB on unmount
      if (selectedEntryRef.current) {
        updateWorldBuildingEntry(selectedEntryRef.current.id, {
          content: editContentRef.current,
          title: editTitleRef.current,
        });
      }
    };
  }, []);

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
    try {
      const entry = await createWorldBuildingEntry(bookId, addingToCategory, newEntryTitle.trim());
      setEntries(prev => [...prev, entry]);
      setAddingToCategory(null);
      setNewEntryTitle('');
      setSelectedEntry(entry);
      selectedEntryRef.current = entry;
      setEditContent('');
      editContentRef.current = '';
      setEditTitle(entry.title);
      editTitleRef.current = entry.title;
      setAiFeedback('');
      // Clear the editor
      // TipTap handles this via content prop
    } catch (e) {
      console.error('[WB] Failed to create entry:', e);
      alert('Erreur lors de la cr\u00e9ation. V\u00e9rifiez la console (F12) et rechargez la page.');
    }
  };

  const handleSelectEntry = (entry: WorldBuildingEntry) => {
    // Save current entry before switching
    flushSave();
    setSelectedEntry(entry);
    selectedEntryRef.current = entry;
    setEditContent(entry.content);
    editContentRef.current = entry.content;
    setEditTitle(entry.title);
    editTitleRef.current = entry.title;
    setAiFeedback('');
    setViewingFeedbackId(null);
    setTextSummary(entry.textSummary || '');
    setShowSummaryPopup(false);
    // Load feedback history
    getWBFeedbacksByEntry(entry.id).then(setFeedbackHistory);
    // Load version history
    getTextVersions(entry.id).then(setVersions);
    // TipTap handles content via prop
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Supprimer cet élément ?')) return;
    await deleteWorldBuildingEntry(entryId);
    setEntries(prev => prev.filter(e => e.id !== entryId));
    if (selectedEntry?.id === entryId) {
      setSelectedEntry(null);
      selectedEntryRef.current = null;
      setEditContent('');
      editContentRef.current = '';
      setEditTitle('');
      editTitleRef.current = '';
      setAiFeedback('');
      setFeedbackHistory([]);
      setViewingFeedbackId(null);
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
    editContentRef.current = value;
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
    editTitleRef.current = value;
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    titleTimeoutRef.current = setTimeout(() => {
      if (selectedEntry) {
        updateWorldBuildingEntry(selectedEntry.id, { title: value });
        setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, title: value } : e));
        setSelectedEntry(prev => prev ? { ...prev, title: value } : null);
      }
    }, 800);
  };

  // Generate text summary via AI
  const handleGenerateWBSummary = async () => {
    const plainText = htmlToPlainText(editContent);
    if (!plainText.trim() || !selectedEntry) return;
    setIsGeneratingSummary(true);
    try {
      const response = await fetch('http://localhost:8000/summarize-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: plainText }),
      });
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      const data = await response.json();
      if (data.summary) {
        setTextSummary(data.summary);
        await updateWorldBuildingEntry(selectedEntry.id, { textSummary: data.summary });
        setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, textSummary: data.summary } : e));
        setShowSummaryPopup(true);
      }
    } catch (e: unknown) {
      console.error('Erreur génération résumé WB:', e);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleGetFeedback = async () => {
    if (!selectedEntry || !htmlToPlainText(editContent).trim()) return;
    setChatOpen(false); setChatMessages([]); setChatContext(null);
    setLoadingFeedback(true);

    // Prepend text summary to feedback if available
    const summaryHeader = textSummary
      ? `**📋 Résumé du texte :**\n${textSummary}\n\n---\n\n`
      : '';
    setAiFeedback(summaryHeader);

    const plainContent = htmlToPlainText(editContent);

    // Build FULL context from all other entries (no truncation for mistral-large-latest)
    const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
    const contextParts = otherEntries.map(e => {
      const cat = getCategoryInfo(e.category);
      return `[${cat.label}] ${e.title} :\n${htmlToPlainText(e.content)}`;
    });
    const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

    try {
      const response = await fetch('http://localhost:8000/world-building/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_title: editTitle,
          entry_content: plainContent,
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

      let fullFeedback = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullFeedback += chunk;
        setAiFeedback(prev => prev + chunk);
      }

      // Save feedback to DB as a new history entry
      if (fullFeedback) {
        const reviewerName = selectedReviewer
          ? (reviewers.find(r => r.id === selectedReviewer)?.name || selectedReviewer)
          : 'Consultant générique';
        const saved = await saveWBFeedback(selectedEntry.id, reviewerName, fullFeedback);
        setFeedbackHistory(prev => [saved, ...prev]);
        setViewingFeedbackId(saved.id);
        // Also keep on entry for the indicator
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

  const handleWBReadersPanel = async () => {
    if (!selectedEntry || !htmlToPlainText(editContent).trim()) return;
    setChatOpen(false); setChatMessages([]); setChatContext(null);
    setLoadingFeedback(true);

    const summaryHeader = textSummary
      ? `**📋 Résumé du texte :**\n${textSummary}\n\n---\n\n`
      : '';
    setAiFeedback(summaryHeader);

    const plainContent = htmlToPlainText(editContent);

    const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
    const contextParts = otherEntries.map(e => {
      const cat = getCategoryInfo(e.category);
      return `[${cat.label}] ${e.title} :\n${htmlToPlainText(e.content)}`;
    });
    const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

    try {
      const response = await fetch('http://localhost:8000/world-building/readers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_title: editTitle,
          entry_content: plainContent,
          category: getCategoryInfo(selectedEntry.category).label,
          book_summary: bookSummary || null,
          all_entries_context: allEntriesContext,
          num_readers: 5,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Pas de stream disponible');

      let fullFeedback = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullFeedback += chunk;
        setAiFeedback(prev => prev + chunk);
      }

      if (fullFeedback) {
        const saved = await saveWBFeedback(selectedEntry.id, 'Panel de lecteurs', fullFeedback);
        setFeedbackHistory(prev => [saved, ...prev]);
        setViewingFeedbackId(saved.id);
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

  const handleWBCustomPanel = async () => {
    if (!selectedEntry || !htmlToPlainText(editContent).trim() || favoritePanel.length === 0) return;
    setChatOpen(false); setChatMessages([]); setChatContext(null);
    setLoadingFeedback(true);

    const summaryHeader = textSummary
      ? `**📋 Résumé du texte :**\n${textSummary}\n\n---\n\n`
      : '';
    setAiFeedback(summaryHeader);

    const plainContent = htmlToPlainText(editContent);

    const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
    const contextParts = otherEntries.map(e => {
      const cat = getCategoryInfo(e.category);
      return `[${cat.label}] ${e.title} :\n${htmlToPlainText(e.content)}`;
    });
    const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

    try {
      const response = await fetch('http://localhost:8000/world-building/panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_title: editTitle,
          entry_content: plainContent,
          category: getCategoryInfo(selectedEntry.category).label,
          reviewer_ids: favoritePanel,
          book_summary: bookSummary || null,
          all_entries_context: allEntriesContext,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Pas de stream disponible');

      let fullFeedback = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullFeedback += chunk;
        setAiFeedback(prev => prev + chunk);
      }

      if (fullFeedback) {
        const saved = await saveWBFeedback(selectedEntry.id, 'Mon panel', fullFeedback);
        setFeedbackHistory(prev => [saved, ...prev]);
        setViewingFeedbackId(saved.id);
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

  const handleWBPanelAnalyzeFeedback = async () => {
    if (!selectedEntry || !htmlToPlainText(editContent).trim() || favoritePanel.length === 0 || !aiFeedback.trim()) return;
    setChatOpen(false); setChatMessages([]); setChatContext(null);
    setLoadingFeedback(true);

    const summaryHeader = textSummary
      ? `**📋 Résumé du texte :**\n${textSummary}\n\n---\n\n`
      : '';
    const readerFeedback = aiFeedback;
    setAiFeedback(summaryHeader);

    const plainContent = htmlToPlainText(editContent);

    const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
    const contextParts = otherEntries.map(e => {
      const cat = getCategoryInfo(e.category);
      return `[${cat.label}] ${e.title} :\n${htmlToPlainText(e.content)}`;
    });
    const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

    try {
      const response = await fetch('http://localhost:8000/world-building/panel/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_title: editTitle,
          entry_content: plainContent,
          category: getCategoryInfo(selectedEntry.category).label,
          reviewer_ids: favoritePanel,
          reader_feedback: readerFeedback,
          book_summary: bookSummary || null,
          all_entries_context: allEntriesContext,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Pas de stream disponible');

      let fullFeedback = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullFeedback += chunk;
        setAiFeedback(prev => prev + chunk);
      }

      if (fullFeedback) {
        const saved = await saveWBFeedback(selectedEntry.id, 'Analyse des retours', fullFeedback);
        setFeedbackHistory(prev => [saved, ...prev]);
        setViewingFeedbackId(saved.id);
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

  const togglePanelMember = async (id: string) => {
    const updated = favoritePanel.includes(id)
      ? favoritePanel.filter(r => r !== id)
      : [...favoritePanel, id];
    setFavoritePanel(updated);
    await saveFavoritePanel(updated);
  };

  const startChat = async (initialFeedback: string, reviewerId?: string, reviewerIds?: string[], sourceId?: string) => {
    setChatContext({ reviewerId, reviewerIds, initialFeedback });
    setChatOpen(true);
    setChatInput('');

    const sessionId = sourceId || crypto.randomUUID();
    setChatSessionId(sessionId);
    if (sourceId) {
      const existing = await getChatSession(sourceId);
      if (existing) {
        setChatMessages(existing.messages);
        setChatSummaries(existing.summaries);
        chatSummariesRef.current = existing.summaries;
        setSummarizedCount(existing.summarizedCount);
        summarizedCountRef.current = existing.summarizedCount;
        return;
      }
    }
    setChatMessages([]);
    setChatSummaries([]);
    chatSummariesRef.current = [];
    setSummarizedCount(0);
    summarizedCountRef.current = 0;
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading || !chatContext || !selectedEntry) return;
    const userMessage = chatInput.trim();
    setChatInput('');
    const newMessages = [...chatMessages, { role: 'user', content: userMessage }];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const plainContent = htmlToPlainText(editContent);
      const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
      const contextParts = otherEntries.map(e => {
        const cat = getCategoryInfo(e.category);
        return `[${cat.label}] ${e.title} :\n${htmlToPlainText(e.content)}`;
      });
      const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.slice(summarizedCountRef.current),
          chat_summaries: chatSummariesRef.current.length > 0 ? chatSummariesRef.current : null,
          reviewer_id: chatContext.reviewerId || null,
          reviewer_ids: chatContext.reviewerIds || null,
          context_type: 'world_building',
          text: plainContent,
          initial_feedback: chatContext.initialFeedback,
          book_summary: bookSummary || null,
          entry_title: editTitle || null,
          category: getCategoryInfo(selectedEntry.category).label,
          all_entries_context: allEntriesContext,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Pas de stream disponible');

      let assistantMsg = '';
      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        assistantMsg += chunk;
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantMsg };
          return updated;
        });
      }

      // Auto-summarize every 5 messages to keep context compact
      const allMsgs = [...newMessages, { role: 'assistant', content: assistantMsg }];
      const unsummarized = allMsgs.length - summarizedCountRef.current;

      if (unsummarized >= 5) {
        const batch = allMsgs.slice(summarizedCountRef.current, summarizedCountRef.current + 5);
        setIsSummarizing(true);
        try {
          const sumRes = await fetch('http://localhost:8000/chat/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: batch }),
          });
          if (sumRes.ok) {
            const { summary } = await sumRes.json();
            chatSummariesRef.current = [...chatSummariesRef.current, summary];
            setChatSummaries(chatSummariesRef.current);
            summarizedCountRef.current += 5;
            setSummarizedCount(summarizedCountRef.current);
          }
        } catch { /* silently continue */ }
        setIsSummarizing(false);
      }

      // Save chat session to DB
      if (chatSessionId) {
        const session: ChatSession = {
          id: chatSessionId,
          contextType: 'world_building',
          messages: allMsgs,
          summaries: chatSummariesRef.current,
          summarizedCount: summarizedCountRef.current,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        saveChatSession(session).catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      setChatMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Erreur : ${msg}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const handleAutofill = async () => {
    if (!selectedEntry) return;
    setLoadingAutofill(true);

    const plainContent = htmlToPlainText(editContent);

    // Build context from all other entries (full content)
    const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
    const contextParts = otherEntries.map(e => {
      const cat = getCategoryInfo(e.category);
      return `[${cat.label}] ${e.title} :\n${htmlToPlainText(e.content)}`;
    });
    const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

    try {
      const response = await fetch('http://localhost:8000/world-building/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_title: editTitle,
          entry_content: plainContent || null,
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
      const currentHtml = wbEditorRef.current?.getHTML() || editContent;
      const hasPriorContent = htmlToPlainText(currentHtml).trim().length > 0;
      if (hasPriorContent && wbEditorRef.current) {
        wbEditorRef.current.commands.setContent(currentHtml + '<br><br><hr><p><em>Complété par IA :</em></p>');
      }

      let generated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        generated += chunk;
        // Convert newlines to <br> for display
        const generatedHtml = generated.replace(/\n/g, '<br>');
        if (wbEditorRef.current) {
          const prefix = hasPriorContent
            ? currentHtml + '<br><br><hr><p><em>Complété par IA :</em></p>'
            : '';
          wbEditorRef.current.commands.setContent(prefix + generatedHtml);
        }
      }

      // Save to DB
      const finalHtml = wbEditorRef.current?.getHTML() || '';
      handleContentChange(finalHtml);
      await updateWorldBuildingEntry(selectedEntry.id, { content: finalHtml });
      setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, content: finalHtml, updatedAt: new Date() } : e));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      alert(`Erreur auto-fill : ${msg}`);
    } finally {
      setLoadingAutofill(false);
    }
  };

  // ======================
  // TEXT VERSIONING
  // ======================

  const saveSnapshot = async (label: string) => {
    if (!selectedEntry) return;
    const version = await saveTextVersion(
      selectedEntry.id,
      'world_building',
      editTitle,
      editContent,
      label
    );
    setVersions(prev => [version, ...prev]);
    return version;
  };

  const restoreVersion = async (version: TextVersion) => {
    if (!selectedEntry) return;
    if (!confirm(`Restaurer la version « ${version.label} » du ${new Date(version.createdAt).toLocaleString('fr-FR')} ?\n\nLa version actuelle sera sauvegardée automatiquement.`)) return;
    await saveSnapshot(`Avant restauration de « ${version.label} »`);
    setEditContent(version.content);
    editContentRef.current = version.content;
    if (wbEditorRef.current) {
      wbEditorRef.current.commands.setContent(version.content);
    }
    await updateWorldBuildingEntry(selectedEntry.id, { content: version.content });
    setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, content: version.content, updatedAt: new Date() } : e));
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!confirm('Supprimer cette version ?')) return;
    await deleteTextVersion(versionId);
    setVersions(prev => prev.filter(v => v.id !== versionId));
  };

  // ======================
  // REWRITE
  // ======================

  const handleRewrite = async () => {
    if (!selectedEntry || !htmlToPlainText(editContent).trim()) return;
    setRewriteLoading(true);
    setRewriteResult('');

    try {
      const plainContent = htmlToPlainText(editContent);
      const otherEntries = entries.filter(e => e.id !== selectedEntry.id);
      const contextParts = otherEntries.map(e => {
        const cat = getCategoryInfo(e.category);
        return `[${cat.label}] ${e.title} :\n${htmlToPlainText(e.content)}`;
      });
      const allEntriesContext = contextParts.length > 0 ? contextParts.join('\n\n---\n\n') : null;

      const response = await fetch('http://localhost:8000/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: plainContent,
          instructions: rewriteInstructions || null,
          context_type: 'world_building',
          reviewer_id: selectedReviewer || null,
          reviewer_ids: null,
          book_summary: bookSummary || null,
          entry_title: editTitle || null,
          category: getCategoryInfo(selectedEntry.category).label,
          all_entries_context: allEntriesContext,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Pas de stream');

      let result = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        result += chunk;
        setRewriteResult(prev => prev + chunk);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      setRewriteResult(`⚠️ Erreur : ${msg}`);
    } finally {
      setRewriteLoading(false);
    }
  };

  const applyRewrite = async (newContent: string) => {
    if (!selectedEntry) return;
    await saveSnapshot('Avant réécriture IA');
    const htmlContent = newContent.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    setEditContent(htmlContent);
    editContentRef.current = htmlContent;
    if (wbEditorRef.current) {
      wbEditorRef.current.commands.setContent(htmlContent);
    }
    await updateWorldBuildingEntry(selectedEntry.id, { content: htmlContent });
    setEntries(prev => prev.map(e => e.id === selectedEntry.id ? { ...e, content: htmlContent, updatedAt: new Date() } : e));
    setShowRewriteModal(false);
    setRewriteResult('');
    setRewriteInstructions('');
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Categories & Entries list */}
      <div style={{ width: showWBPanel ? '20rem' : '0px', transition: 'width 200ms ease' }} className="flex-shrink-0 border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-secondary)] overflow-hidden">
        <div className="w-80 h-full flex flex-col">
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
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddMenu(false)}>
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-3xl shadow-2xl w-[90vw] max-w-[1200px] max-h-[90vh] overflow-y-auto py-8" onClick={e => e.stopPropagation()}>
                  <div className="px-10 pb-5 mb-5 border-b border-[var(--border-subtle)]">
                    <h3 className="text-[var(--text-primary)] font-bold text-3xl">Ajouter un élément</h3>
                    <p className="text-[var(--text-muted)] text-lg mt-2">Choisissez une catégorie pour votre univers</p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 px-10">
                    {WB_CATEGORIES.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => handleAddCategory(cat.id)}
                        className="px-6 py-5 text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--accent)]/10 rounded-2xl transition-colors flex items-center gap-4 border border-transparent hover:border-[var(--accent)]/30"
                      >
                        <span className="text-5xl">{cat.icon}</span>
                        <span className="text-xl font-semibold">{cat.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
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
                  className="w-full px-3 py-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-lg transition-all"
                >
                  <span className="text-sm text-[var(--text-muted)] transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                  <span className="text-lg">{catInfo.icon}</span>
                  <span className="text-sm">{catInfo.label}</span>
                  <span className="ml-auto text-[var(--text-secondary)] text-sm">{catEntries.length}</span>
                </button>

                {/* Entries */}
                {isExpanded && (
                  <div className="ml-3 pl-3 border-l border-[var(--border-subtle)]">
                    {catEntries.map(entry => (
                      <div
                        key={entry.id}
                        className={`px-3 py-2 cursor-pointer flex items-center justify-between group rounded-md my-0.5 transition-all ${
                          selectedEntry?.id === entry.id
                            ? 'bg-[var(--accent-glow)] border-l-2 border-l-[var(--accent)]'
                            : 'hover:bg-[var(--bg-surface)]'
                        }`}
                        onClick={() => handleSelectEntry(entry)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-sm truncate ${selectedEntry?.id === entry.id ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-secondary)]'}`}>
                            {entry.title}
                          </span>
                          {entry.aiFeedback && (
                            <span className="text-xs text-emerald-400/80 flex-shrink-0" title="Avis IA disponible">✦</span>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry.id); }}
                          className="text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm transition-opacity flex-shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* Quick add in this category */}
                    <button
                      onClick={() => { setAddingToCategory(catId); setNewEntryTitle(''); }}
                      className="w-full px-3 py-1.5 text-left text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
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
                <span className="text-sm text-[var(--text-primary)] font-bold">{getCategoryInfo(addingToCategory).label}</span>
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
                  className="flex-1 px-3 py-2 bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--accent)] text-sm rounded-lg transition-all disabled:opacity-30"
                >
                  Créer
                </button>
                <button
                  onClick={() => { setAddingToCategory(null); setNewEntryTitle(''); }}
                  className="px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm rounded-lg transition-all"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Toggle WB Panel */}
      <button
        onClick={() => setShowWBPanel(!showWBPanel)}
        className="flex-shrink-0 w-5 h-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center justify-center border-r border-[var(--border-subtle)] transition-all text-xs"
        title={showWBPanel ? 'Masquer la liste' : 'Afficher la liste'}
      >
        {showWBPanel ? '‹' : '›'}
      </button>

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
              <span className="text-[var(--text-secondary)] text-xs font-medium">
                {getCategoryInfo(selectedEntry.category).label}
              </span>
            </div>

            {/* Content area split: editor left/top, feedback right/bottom */}
            <div className={`flex-1 flex ${wbLayoutMode === 'vertical' ? 'flex-col' : ''} overflow-hidden`} ref={splitContainerRef}>
              {/* Content editor */}
              {!feedbackFullscreen && (
              <div className="flex flex-col min-h-0" data-wb-editor-panel style={{
                ...(editorFullscreen || !showFeedbackPanel
                  ? { width: '100%', height: '100%' }
                  : wbLayoutMode === 'horizontal'
                    ? { width: `${editorHeight}%` }
                    : { height: `${editorHeight}%`, width: '100%' }
                )
              }}>
                {/* Sticky toolbar */}
                <div className="flex-shrink-0 px-6 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[var(--accent)] text-sm font-bold tracking-widest uppercase">Description</label>
                    <div className="w-px h-5 bg-[var(--border-subtle)]" />
                    {wbEditorRef.current && (
                      <EditorToolbar
                        editor={wbEditorRef.current}
                        wordCount={`${htmlToPlainText(editContent).length} car.`}
                        onGenerateSummary={selectedEntry ? handleGenerateWBSummary : undefined}
                        isGeneratingSummary={isGeneratingSummary}
                        hasSummary={!!textSummary}
                        onShowSummary={() => setShowSummaryPopup(p => !p)}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowFeedbackPanel(p => !p)}
                      className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm px-1.5"
                      title={showFeedbackPanel ? 'Masquer les avis' : 'Afficher les avis'}
                    >
                      {showFeedbackPanel ? '⟫' : '⟪'}
                    </button>
                    <button
                      onClick={() => setWbLayoutMode(m => m === 'horizontal' ? 'vertical' : 'horizontal')}
                      className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm px-1.5"
                      title={wbLayoutMode === 'horizontal' ? 'Passer en mode haut/bas' : 'Passer en mode gauche/droite'}
                    >
                      {wbLayoutMode === 'horizontal' ? '⬒' : '⬓'}
                    </button>
                    <button
                      onClick={() => setEditorFullscreen(f => !f)}
                      className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm px-1.5"
                      title={editorFullscreen ? 'Réduire' : 'Plein écran éditeur'}
                    >
                      {editorFullscreen ? '⊟' : '⊞'}
                    </button>
                    <div className="w-px h-5 bg-[var(--border-subtle)]" />
                    <button
                      onClick={handleAutofill}
                      disabled={loadingAutofill || loadingFeedback}
                      className="px-4 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-sm font-medium rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                    >
                      {loadingAutofill ? (
                        <><span className="loading-cursor">▊</span> Génération…</>
                      ) : (
                        <><span>🤖</span> {htmlToPlainText(editContent).trim() ? 'Développer par IA' : 'Remplir par IA'}</>                      )}
                    </button>
                    <button
                      onClick={() => { setRewriteResult(''); setRewriteInstructions(''); setShowRewriteModal(true); }}
                      disabled={loadingFeedback || rewriteLoading || !htmlToPlainText(editContent).trim()}
                      className="px-3 py-2 bg-purple-500/5 hover:bg-purple-500/15 text-purple-400/80 text-sm rounded-lg transition-all disabled:opacity-30 flex items-center gap-1"
                      title="Demander une réécriture IA"
                    >
                      ✍️ Réécriture
                    </button>
                    <div className="w-px h-5 bg-[var(--border-subtle)]" />
                    <button
                      onClick={() => { if (selectedEntry) { getTextVersions(selectedEntry.id).then(setVersions); setShowVersionPanel(true); } }}
                      className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-xs px-2 py-1 rounded-lg hover:bg-[var(--accent)]/10 flex items-center gap-1"
                      title="Historique des versions"
                    >
                      📚 {versions.length > 0 && <span className="text-[var(--accent)]">{versions.length}</span>}
                    </button>
                    <button
                      onClick={() => saveSnapshot('Sauvegarde manuelle')}
                      className="text-[var(--text-muted)] hover:text-emerald-400 transition-colors text-xs px-1.5 py-1 rounded-lg hover:bg-emerald-500/10"
                      title="Sauvegarder un snapshot"
                    >
                      💾
                    </button>
                  </div>
                </div>
                {/* Scrollable editor */}
                <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                  <RichEditor
                    content={editContent}
                    onUpdate={(html) => handleContentChange(html)}
                    placeholder="Décrivez cet élément de votre univers en détail…"
                    wrapperClassName="editor-area w-full flex-1 min-h-[100px] rounded-xl overflow-y-auto"
                    className="p-4 placeholder-[#999] leading-relaxed focus:outline-none min-h-full"
                    style={{ fontSize: '18px' }}
                    editorRef={wbEditorRef}
                  />
                </div>
                {/* Summary popup - resizable */}
                {showSummaryPopup && textSummary && (
                  <div className="flex-shrink-0 border-t border-[var(--accent)]/30 bg-[var(--bg-surface)] flex flex-col" style={{ height: summaryHeight }}>
                    <div className="px-6 py-2 flex items-center justify-between flex-shrink-0">
                      <span className="text-[var(--accent)] text-sm font-bold tracking-widest uppercase">📋 Résumé auto-généré</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSummaryHeight(h => Math.min(600, h + 80))}
                          className="text-[var(--text-muted)] hover:text-[var(--accent)] text-sm transition-colors px-1"
                          title="Agrandir"
                        >▲</button>
                        <button
                          onClick={() => setSummaryHeight(h => Math.max(100, h - 80))}
                          className="text-[var(--text-muted)] hover:text-[var(--accent)] text-sm transition-colors px-1"
                          title="Réduire"
                        >▼</button>
                        <button
                          onClick={handleGenerateWBSummary}
                          disabled={isGeneratingSummary}
                          className="text-[var(--text-muted)] hover:text-[var(--accent)] text-xs transition-colors"
                          title="Régénérer le résumé"
                        >
                          {isGeneratingSummary ? '⏳' : '🔄'}
                        </button>
                        <button
                          onClick={() => setShowSummaryPopup(false)}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg leading-none transition-colors"
                          title="Fermer"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div className="px-6 pb-3 flex-1 min-h-0">
                      <textarea
                        className="w-full h-full p-3 text-sm text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded-lg border border-[var(--border-subtle)] resize-none leading-relaxed"
                        value={textSummary}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTextSummary(val);
                          if (selectedEntry) {
                            updateWorldBuildingEntry(selectedEntry.id, { textSummary: val });
                            setEntries(prev => prev.map(en => en.id === selectedEntry.id ? { ...en, textSummary: val } : en));
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* Draggable Divider */}
              {!feedbackFullscreen && !editorFullscreen && isDragging && (
                <div className="fixed inset-0 z-50" style={{ cursor: wbLayoutMode === 'horizontal' ? 'col-resize' : 'row-resize' }} />
              )}
              {showFeedbackPanel && !feedbackFullscreen && !editorFullscreen && (
              <div
                style={{
                  ...(wbLayoutMode === 'horizontal'
                    ? { width: '6px', height: '100%', cursor: 'col-resize' }
                    : { height: '6px', width: '100%', cursor: 'row-resize' }
                  ),
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
              )}

              {/* AI Feedback section */}
              {showFeedbackPanel && !editorFullscreen && (
              <div className="min-h-0 overflow-hidden flex flex-col" style={{
                ...(feedbackFullscreen
                  ? { width: '100%', height: '100%' }
                  : wbLayoutMode === 'horizontal'
                    ? { width: `${100 - editorHeight}%` }
                    : { height: `${100 - editorHeight}%`, width: '100%' }
                )
              }}>
                <div className="px-6 py-3 flex-shrink-0 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setFeedbackFullscreen(f => !f)}
                        className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm"
                        title={feedbackFullscreen ? 'Réduire' : 'Plein écran'}
                      >
                        {feedbackFullscreen ? '⊟' : '⊞'}
                      </button>
                      <label className="text-[var(--accent)] text-sm font-bold tracking-widest uppercase flex items-center gap-2">
                      <span className="text-lg">✦</span> Avis IA
                      {feedbackHistory.length > 0 && (
                        <span className="text-[var(--text-secondary)] text-sm font-normal normal-case tracking-normal">({feedbackHistory.length})</span>
                      )}
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="input-writer px-2 py-2 rounded-lg text-[var(--text-secondary)] text-sm"
                        value={selectedReviewer}
                        onChange={(e) => setSelectedReviewer(e.target.value)}
                      >
                        <option value="">Consultant générique</option>
                        {reviewers.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => { setViewingFeedbackId(null); setAiFeedback(''); handleGetFeedback(); }}
                        disabled={loadingFeedback || loadingAutofill || !htmlToPlainText(editContent).trim()}
                        className="px-4 py-2.5 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-sm font-medium rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {loadingFeedback ? 'Analyse en cours…' : 'Demander un avis'}
                      </button>
                      <button
                        onClick={() => { setViewingFeedbackId(null); setAiFeedback(''); handleWBReadersPanel(); }}
                        disabled={loadingFeedback || loadingAutofill || !htmlToPlainText(editContent).trim()}
                        className="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        title="5 lecteurs aléatoires donnent leur avis"
                      >
                        👥 Lecteurs
                      </button>
                      <button
                        onClick={() => { if (favoritePanel.length > 0) { setViewingFeedbackId(null); setAiFeedback(''); handleWBCustomPanel(); } else { setShowPanelConfig(true); } }}
                        disabled={loadingFeedback || loadingAutofill || !htmlToPlainText(editContent).trim()}
                        className="px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-sm font-medium rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed border border-amber-500/30"
                        title={favoritePanel.length > 0 ? `Mon panel : ${favoritePanel.length} auteurs` : 'Configurer mon panel'}
                      >
                        ⭐ Panel ({favoritePanel.length})
                      </button>
                      <button
                        className="py-2.5 px-3 rounded-lg text-sm font-medium transition-all border border-amber-500/30 text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/15"
                        onClick={() => setShowPanelConfig(true)}
                        title="Modifier la composition du panel"
                      >
                        ✏️ Modifier panel
                      </button>
                      {aiFeedback.trim() && favoritePanel.length > 0 && (
                        <button
                          className="px-4 py-2.5 rounded-lg text-sm font-medium transition-all border border-purple-500/50 text-purple-400 hover:bg-purple-500/15 disabled:opacity-30 disabled:cursor-not-allowed"
                          onClick={() => { setViewingFeedbackId(null); handleWBPanelAnalyzeFeedback(); }}
                          disabled={loadingFeedback || loadingAutofill || !htmlToPlainText(editContent).trim()}
                          title="Votre panel analyse les retours et propose des modifications"
                        >
                          🔍 Analyser retours
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Feedback history strip */}
                  {feedbackHistory.length > 0 && (
                    <div className="flex-shrink-0 flex overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] gap-0">
                      {feedbackHistory.map((fb) => {
                        const isActive = viewingFeedbackId === fb.id;
                        const date = new Date(fb.createdAt);
                        return (
                          <div
                            key={fb.id}
                            className={`px-3 py-2 cursor-pointer border-r border-[var(--border-subtle)] transition-all group flex-shrink-0 ${
                              isActive
                                ? 'bg-[var(--accent-glow)] border-b-2 border-b-[var(--accent)]'
                                : 'hover:bg-[var(--bg-surface)] border-b-2 border-b-transparent'
                            }`}
                            onClick={() => {
                              setViewingFeedbackId(fb.id);
                              setAiFeedback(fb.feedback);
                              setChatOpen(false); setChatMessages([]); setChatContext(null);
                            }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`text-sm font-semibold truncate max-w-[140px] ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                                {fb.reviewer}
                              </span>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!confirm('Supprimer cet avis ?')) return;
                                  await deleteWBFeedback(fb.id);
                                  const remaining = feedbackHistory.filter(f => f.id !== fb.id);
                                  setFeedbackHistory(remaining);
                                  if (viewingFeedbackId === fb.id) {
                                    // Was viewing the deleted one: switch to most recent remaining or clear
                                    if (remaining.length > 0) {
                                      const latest = remaining[remaining.length - 1];
                                      setViewingFeedbackId(latest.id);
                                      setAiFeedback(latest.feedback);
                                    } else {
                                      setViewingFeedbackId(null);
                                      setAiFeedback('');
                                    }
                                    setChatOpen(false); setChatMessages([]); setChatContext(null);
                                  }
                                }}
                                className="text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm transition-opacity flex-shrink-0"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="text-xs text-[var(--text-secondary)] mt-0.5 whitespace-nowrap">
                              {date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                              {' · '}
                              {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Feedback content */}
                  <div className="critique-area flex-1 overflow-y-auto">
                   <div className="critique-area-bg px-6 py-4">
                    {(aiFeedback || loadingFeedback) ? (
                      <div className="p-5 border border-white/10 rounded-xl">
                        <div className="critique-content space-y-1">
                          {renderMarkdownContent(aiFeedback, renderFeedbackLine)}
                          {loadingFeedback && <span className="loading-cursor text-[var(--accent)] text-lg">▊</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="p-5 border border-dashed border-white/10 rounded-xl text-center">
                        <p className="text-[var(--text-muted)] text-sm">Cliquez sur « Demander un avis » pour obtenir un retour IA sur cet élément</p>
                        <p className="text-[var(--text-muted)]/60 text-xs mt-1">L&apos;IA analysera la cohérence, l&apos;originalité et proposera des améliorations</p>
                      </div>
                    )}

                    {/* Chat button */}
                    {aiFeedback && !loadingFeedback && (
                      <div className="mt-4 pt-4 border-t border-white/10">
                        {!chatOpen ? (
                          <button
                            onClick={() => {
                              const fb = aiFeedback;
                              const fbEntry = viewingFeedbackId ? feedbackHistory.find(f => f.id === viewingFeedbackId) : null;
                              const reviewer = fbEntry?.reviewer;
                              const chatSrcId = viewingFeedbackId || fbEntry?.id || `chat-wb-${selectedEntry?.id || 'none'}`;
                              if (reviewer === 'Mon panel' || reviewer === 'Analyse des retours') {
                                startChat(fb, undefined, favoritePanel, chatSrcId);
                              } else if (reviewer === 'Panel de lecteurs') {
                                startChat(fb, undefined, undefined, chatSrcId);
                              } else if (reviewer && reviewers.find(r => r.name === reviewer || r.id === reviewer)) {
                                const r = reviewers.find(rv => rv.name === reviewer || rv.id === reviewer);
                                startChat(fb, r?.id, undefined, chatSrcId);
                              } else {
                                startChat(fb, undefined, undefined, chatSrcId);
                              }
                            }}
                            className="w-full py-3 px-4 rounded-xl text-sm font-medium transition-all border border-sky-500/40 text-sky-400 hover:bg-sky-500/15 flex items-center justify-center gap-2"
                          >
                            💬 Discuter
                          </button>
                        ) : (
                          <button
                            onClick={() => { setChatOpen(false); setChatMessages([]); setChatContext(null); }}
                            className="w-full py-2 px-4 rounded-xl text-xs font-medium transition-all text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                          >
                            ✕ Fermer le chat
                          </button>
                        )}
                      </div>
                    )}

                    {/* Chat messages */}
                    {chatOpen && chatContext && (
                      <div className="mt-3 space-y-3">
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                              msg.role === 'user'
                                ? 'bg-sky-500/15 text-sky-200 border border-sky-500/20'
                                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-white/5'
                            }`}>
                              <div className="critique-content">
                                {renderMarkdownContent(msg.content, renderFeedbackLine)}
                              </div>
                            </div>
                          </div>
                        ))}
                        {chatLoading && chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'user' && (
                          <div className="flex justify-start">
                            <div className="bg-[var(--bg-surface)] border border-white/5 rounded-2xl px-4 py-3">
                              <span className="loading-cursor text-[var(--accent)] text-lg">▊</span>
                            </div>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                    )}
                   </div>

                  {/* Chat input */}
                  {chatOpen && chatContext && (
                    <div className="flex-shrink-0 border-t border-[var(--border-subtle)] px-4 py-3 bg-[var(--bg-secondary)]">
                      {(chatSummaries.length > 0 || isSummarizing) && (
                        <div className="text-xs text-[var(--text-muted)] mb-1.5 flex items-center gap-1.5">
                          {isSummarizing ? (
                            <><span className="inline-block w-3 h-3 border-2 border-[var(--accent)]/40 border-t-[var(--accent)] rounded-full animate-spin" /> Résumé en cours…</>
                          ) : (
                            <><span>📝</span> {chatSummaries.length} résumé{chatSummaries.length > 1 ? 's' : ''} · {chatMessages.length} messages</>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2 items-end">
                        <textarea
                          value={chatInput}
                          onChange={e => { setChatInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                          placeholder="Posez une question, demandez une réécriture…"
                          className="input-writer flex-1 px-4 py-2.5 text-sm rounded-xl text-[var(--text-primary)] resize-none overflow-y-auto"
                          disabled={chatLoading}
                          rows={2}
                          style={{ minHeight: '52px', maxHeight: '160px' }}
                        />
                        <button
                          onClick={sendChatMessage}
                          disabled={chatLoading || !chatInput.trim()}
                          className="px-4 py-2.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 text-sm font-medium rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {chatLoading ? '…' : '↑'}
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
              )}
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

      {/* Panel config modal */}
      {showPanelConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPanelConfig(false)}>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-2xl shadow-2xl w-[36rem] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <h3 className="text-[var(--text-primary)] font-semibold text-base">⭐ Configurer mon panel d&apos;auteurs</h3>
              <button onClick={() => setShowPanelConfig(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg transition-colors">✕</button>
            </div>
            <div className="px-6 py-2 text-[var(--text-secondary)] text-sm">
              Choisissez vos auteurs favoris. Ils donneront un avis collégial sous forme de dialogue.
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {reviewers.map(r => {
                const isSelected = favoritePanel.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => togglePanelMember(r.id)}
                    className={`w-full px-4 py-3 text-left text-sm rounded-xl transition-all flex items-center gap-3 ${
                      isSelected
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] border border-transparent'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 text-xs ${
                      isSelected ? 'bg-amber-500 border-amber-500 text-black' : 'border-[var(--border-medium)]'
                    }`}>
                      {isSelected ? '✓' : ''}
                    </span>
                    <span>{r.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[var(--text-muted)] text-sm">{favoritePanel.length} auteur{favoritePanel.length !== 1 ? 's' : ''} sélectionné{favoritePanel.length !== 1 ? 's' : ''}</span>
              <button
                onClick={() => setShowPanelConfig(false)}
                className="btn-accent px-6 py-2 rounded-lg text-sm"
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Panel */}
      {showVersionPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowVersionPanel(false)}>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-2xl shadow-2xl w-[48rem] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <h3 className="text-[var(--text-primary)] font-semibold text-base">📚 Historique des versions</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { saveSnapshot('Sauvegarde manuelle'); }}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 transition-all"
                >
                  💾 Sauvegarder maintenant
                </button>
                <button onClick={() => setShowVersionPanel(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg transition-colors">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {versions.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-[var(--text-muted)] text-sm mb-1">Aucune version sauvegardée</p>
                  <p className="text-[var(--text-muted)]/60 text-xs">Les versions sont créées automatiquement avant chaque réécriture IA, ou manuellement</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {versions.map((v) => {
                    const date = new Date(v.createdAt);
                    const plainPreview = (() => {
                      if (typeof document === 'undefined') return v.content.replace(/<[^>]*>/g, '').slice(0, 150);
                      const div = document.createElement('div');
                      div.innerHTML = v.content;
                      return (div.innerText || div.textContent || '').slice(0, 150);
                    })();
                    return (
                      <div key={v.id} className="p-4 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--accent)]/30 transition-all group">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[var(--text-primary)] text-sm font-semibold">{v.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--text-muted)] text-xs">
                              {date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                              {' · '}
                              {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <button
                              onClick={() => restoreVersion(v)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] transition-all opacity-0 group-hover:opacity-100"
                            >
                              Restaurer
                            </button>
                            <button
                              onClick={() => handleDeleteVersion(v.id)}
                              className="text-[var(--text-muted)] hover:text-red-400 text-sm transition-colors opacity-0 group-hover:opacity-100"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <p className="text-[var(--text-muted)] text-xs leading-relaxed line-clamp-2">{plainPreview}…</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[var(--text-muted)] text-xs">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
              <button onClick={() => setShowVersionPanel(false)} className="btn-accent px-4 py-1.5 rounded-lg text-sm">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Rewrite Modal */}
      {showRewriteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { if (!rewriteLoading) setShowRewriteModal(false); }}>
          <div className="bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-2xl shadow-2xl w-[64rem] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <h3 className="text-[var(--text-primary)] font-semibold text-base">✍️ Réécriture par IA</h3>
              <button onClick={() => { if (!rewriteLoading) setShowRewriteModal(false); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg transition-colors">✕</button>
            </div>
            <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
              <label className="text-[var(--text-secondary)] text-sm font-medium mb-2 block">Instructions (optionnel)</label>
              <textarea
                value={rewriteInstructions}
                onChange={e => setRewriteInstructions(e.target.value)}
                placeholder="Ex: Rends la description plus immersive, ajoute des détails sensoriels…"
                className="input-writer w-full px-4 py-3 text-sm rounded-xl text-[var(--text-primary)] resize-none"
                rows={2}
                disabled={rewriteLoading}
              />
              <div className="flex items-center gap-3 mt-3">
                <span className="text-[var(--text-muted)] text-xs">Auteur :</span>
                <span className="text-[var(--accent)] text-sm font-medium">
                  {selectedReviewer ? (reviewers.find(r => r.id === selectedReviewer)?.name || 'Consultant') : 'Consultant générique'}
                </span>
                <button
                  onClick={handleRewrite}
                  disabled={rewriteLoading || !htmlToPlainText(editContent).trim()}
                  className="ml-auto px-5 py-2.5 bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 text-sm font-medium rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {rewriteLoading ? (
                    <span className="flex items-center gap-2"><span className="inline-block w-3 h-3 border-2 border-purple-400/40 border-t-purple-400 rounded-full animate-spin" /> Réécriture en cours…</span>
                  ) : (
                    '✍️ Lancer la réécriture'
                  )}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[200px]">
              {rewriteResult ? (
                <div className="prose prose-invert max-w-none">
                  <div className="text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-wrap">{rewriteResult}</div>
                  {rewriteLoading && <span className="loading-cursor text-purple-400 text-lg">▊</span>}
                </div>
              ) : !rewriteLoading ? (
                <div className="text-center py-10">
                  <p className="text-[var(--text-muted)] text-sm">La version réécrite apparaîtra ici</p>
                  <p className="text-[var(--text-muted)]/60 text-xs mt-1">Votre texte actuel sera sauvegardé avant toute application</p>
                </div>
              ) : null}
            </div>
            {rewriteResult && !rewriteLoading && (
              <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
                <span className="text-[var(--text-muted)] text-xs">La version actuelle sera sauvegardée automatiquement avant application</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowRewriteModal(false)}
                    className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm rounded-lg transition-all"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={() => applyRewrite(rewriteResult)}
                    className="px-5 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-sm font-medium rounded-xl transition-all"
                  >
                    ✅ Appliquer cette version
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
