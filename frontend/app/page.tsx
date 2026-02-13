'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import {
  Book, Chapter, CritiqueEntry,
  getBooks, createBook, deleteBook,
  getChaptersByBook, createChapter, deleteChapter, saveChapterContent,
  getWriterProfile, saveWriterProfile,
  updateBook, updateChapter,
  saveCritique, getCritiquesByChapter, updateCritiqueSummary, deleteCritique,
  exportDatabase, downloadExport, importDatabase, WriterExport,
  getFavoritePanel, saveFavoritePanel
} from './lib/db';
import WorldBuilding from './components/WorldBuilding';
import RichEditor, { EditorToolbar } from './components/RichEditor';
import type { Editor } from '@tiptap/react';

type Reviewer = { id: string; name: string };

// Normalize HTML from contentEditable: flatten to clean inline HTML with uniform <br><br> paragraph breaks
const sanitizeEditorHtml = (html: string): string => {
  if (!html || !html.trim()) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  const BLOCK = new Set(['p','div','h1','h2','h3','h4','h5','h6','blockquote','li','ul','ol','pre','section','article','table','tr','td','th','header','footer','figure','address']);
  const INLINE = new Set(['b','strong','i','em','u','span','a','sub','sup','mark','small','del','s','ins','code']);

  let out = '';
  let atBreak = true; // true = we're at a line break point (no need to add another)

  const addBreak = () => {
    if (!atBreak && out.length > 0) {
      out += '<br><br>';
      atBreak = true;
    }
  };

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      // Text node: collapse whitespace, skip pure-whitespace nodes
      const t = (node.textContent || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
      if (t.trim()) {
        // Add a space before if needed (after inline content, before more text)
        if (!atBreak && out.length > 0 && t.startsWith(' ')) out += ' ';
        out += t.trim();
        if (t.endsWith(' ')) out += ' ';
        atBreak = false;
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Skip invisible elements
    if (['style','script','meta','link','head'].includes(tag)) return;

    if (tag === 'br') {
      out += '<br>';
      atBreak = true;
      return;
    }

    const isBlock = BLOCK.has(tag);
    if (isBlock) addBreak();

    if (INLINE.has(tag) || tag === 'font') {
      // Preserve inline tags with safe attributes, recurse into children
      const keepAttrs = ['style','class','href'];
      const attrs = Array.from(el.attributes)
        .filter(a => keepAttrs.includes(a.name))
        .map(a => `${a.name}="${a.value}"`)
        .join(' ');
      const open = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
      out += open;
      for (const c of Array.from(el.childNodes)) walk(c);
      out += `</${tag}>`;
    } else {
      // Block or unknown element: just recurse into children
      for (const c of Array.from(el.childNodes)) walk(c);
    }

    if (isBlock) addBreak();
  };

  for (const child of Array.from(tmp.childNodes)) walk(child);

  // Collapse 3+ <br> into exactly <br><br>
  out = out.replace(/(<br\s*\/?>[\s]*){3,}/gi, '<br><br>');
  // Remove &nbsp;
  out = out.replace(/&nbsp;/g, ' ');
  // Trim leading/trailing <br> and whitespace
  out = out.replace(/^(\s*<br\s*\/?>[\s]*)+/i, '');
  out = out.replace(/([\s]*<br\s*\/?>[\s]*)+$/i, '');
  // Remove empty inline tags
  out = out.replace(/<(b|strong|i|em|u|span|font)[^>]*>\s*<\/\1>/gi, '');
  return out.trim();
};

// Extract plain text from HTML (for sending to API)
const htmlToPlainText = (html: string): string => {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
};

// Inline markdown renderer: **bold**, *italic*, `code`
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

// Render full markdown content with table support
function renderMarkdownContent(text: string, lineRenderer: (line: string, i: number) => ReactNode): ReactNode[] {
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Detect table: line contains | and is not just a horizontal rule
    if (/\|/.test(line) && !/^[-*_]{3,}$/.test(line.trim())) {
      // Collect consecutive table lines
      const tableLines: string[] = [];
      while (i < lines.length && /\|/.test(lines[i]) && !/^[-*_]{3,}$/.test(lines[i].trim())) {
        tableLines.push(lines[i]);
        i++;
      }
      // Only render as table if we have header + separator + at least one row (3+ lines)
      if (tableLines.length >= 3 && tableLines.some(l => /^\|?\s*[-:]+[-|:\s]*\|?\s*$/.test(l))) {
        elements.push(renderMarkdownTable(tableLines, i));
      } else {
        // Not a real table, render lines normally
        tableLines.forEach((tl, ti) => elements.push(lineRenderer(tl, i - tableLines.length + ti)));
      }
    } else {
      elements.push(lineRenderer(line, i));
      i++;
    }
  }

  return elements;
}

// Parse a single line of critique markdown into a React element
function renderCritiqueLine(line: string, i: number): ReactNode {
  let trimmed = line.trim();

  // Normalize all heading edge cases from LLM output:
  // **### Title** → ### Title
  // ### **### Title** → ### Title  (doubled markers)
  // ###**Title** → ### Title
  // **## Title** → ## Title
  trimmed = trimmed
    .replace(/^\*\*(#{1,5})\s+(.+?)\*\*\s*$/, '$1 $2')        // **### Title** → ### Title
    .replace(/^(#{1,5})\s*\*\*(#{1,5})\s+(.+?)\*\*/, '$1 $3')  // ### **### Title** → ### Title
    .replace(/^(#{1,5})\s+(#{1,5})\s+/, '$1 ')                   // ### ### Title → ### Title
    .replace(/^(#{1,5})(\*\*)/, '$1 $2')                         // ###**Title → ### **Title

  // Empty line = spacing
  if (trimmed === '') {
    return <div key={i} className="h-2" />;
  }

  // Horizontal rules: ---, ***, ___
  if (/^[-*_]{3,}$/.test(trimmed)) {
    return <hr key={i} className="border-zinc-700/50 my-5" />;
  }

  // Headings: # to #####
  const headingMatch = trimmed.match(/^(#{1,5})\s+(.+)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    // Strip trailing ###, leading ###, stray # inside, and wrapping **
    const content = headingMatch[2]
      .replace(/\s*#+\s*$/, '')           // trailing ###
      .replace(/^#+\s*/, '')              // leading ### inside content
      .replace(/^\*\*(.+?)\*\*$/, '$1');  // unwrap bold if whole title is bold
    if (level <= 2) {
      return (
        <h2 key={i} className="text-lg font-semibold text-[var(--text-primary)] mb-4 mt-6 first:mt-0 pb-2 border-b border-[var(--border-subtle)] tracking-tight">
          {renderInline(content)}
        </h2>
      );
    }
    return (
      <h3 key={i} className="text-[15px] font-semibold text-[var(--accent)] mt-6 mb-3 flex items-center gap-2">
        <span className="w-0.5 h-4 bg-[var(--accent)] rounded-full inline-block flex-shrink-0 opacity-60" />
        {renderInline(content)}
      </h3>
    );
  }

  // Standalone bold line (acts as a sub-heading): **Some title**
  if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) {
    const inner = trimmed.replace(/^\*\*/, '').replace(/\*\*:?\s*$/, '');
    return (
      <h4 key={i} className="text-sm font-semibold text-[var(--text-primary)] mt-5 mb-2">
        {inner}
      </h4>
    );
  }

  // Numbered heading: "1. **Title**" or "1. Title" (bold = sub-heading style)
  const numberedBoldMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*\s*$/);
  if (numberedBoldMatch) {
    return (
      <h4 key={i} className="text-sm font-semibold text-[var(--accent)] mt-5 mb-2 flex items-center gap-2">
        <span className="text-[var(--accent)]/60">{numberedBoldMatch[1]}.</span>
        {numberedBoldMatch[2]}
      </h4>
    );
  }

  // Blockquote: > text
  if (trimmed.startsWith('> ') || trimmed === '>') {
    const content = trimmed.startsWith('> ') ? trimmed.slice(2) : '';
    return (
      <blockquote key={i} className="border-l-2 border-[var(--accent)]/30 pl-4 py-2 my-2 bg-[var(--accent-soft)] rounded-r-lg text-[var(--text-secondary)] italic text-sm leading-relaxed">
        {renderInline(content)}
      </blockquote>
    );
  }

  // Bullet list: - or • or *  (but not ** which is bold)
  if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || /^\*\s+[^*]/.test(trimmed)) {
    const content = trimmed.startsWith('- ') || trimmed.startsWith('• ')
      ? trimmed.slice(2)
      : trimmed.slice(trimmed.indexOf(' ') + 1);
    return (
      <div key={i} className="flex gap-2 my-1.5 ml-2 text-sm leading-relaxed text-[var(--text-secondary)]">
        <span className="text-[var(--accent)] mt-0.5 flex-shrink-0">•</span>
        <span>{renderInline(content)}</span>
      </div>
    );
  }

  // Numbered list: 1. text (not already caught as numbered heading)
  const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
  if (numberedMatch) {
    return (
      <div key={i} className="flex gap-2 my-1.5 ml-1">
        <span className="text-[var(--accent)] font-medium text-sm w-6 flex-shrink-0 text-right">{numberedMatch[1]}.</span>
        <span className="text-[var(--text-secondary)] text-sm leading-relaxed">{renderInline(numberedMatch[2])}</span>
      </div>
    );
  }

  // Regular paragraph
  return (
    <p key={i} className="text-[var(--text-secondary)] text-sm leading-relaxed my-1.5">
      {renderInline(line)}
    </p>
  );
}

export default function Home() {
  // Data
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  
  // Editor
  const [text, setText] = useState('');
  const [selectedReviewer, setSelectedReviewer] = useState<string>("prof_ecriture");
  const [critique, setCritique] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // UI
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [critiqueFullscreen, setCritiqueFullscreen] = useState(false);
  const [editorWidth, setEditorWidth] = useState(50); // percentage for both axes
  const [isDragging, setIsDragging] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'horizontal' | 'vertical'>('horizontal');
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [newBookName, setNewBookName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [rightTab, setRightTab] = useState<'critique' | 'profil' | 'contexte'>('critique');
  const [writerProfile, setWriterProfile] = useState('');
  const [sidebarView, setSidebarView] = useState<'chapters' | 'worldbuilding'>('chapters');

  // Drag to resize panels
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      const pct = layoutMode === 'horizontal'
        ? ((e.clientX - rect.left) / rect.width) * 100
        : ((e.clientY - rect.top) / rect.height) * 100;
      setEditorWidth(Math.min(85, Math.max(15, pct)));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add(layoutMode === 'horizontal' ? 'resizing-h' : 'resizing-v');
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('resizing-h', 'resizing-v');
    };
  }, [isDragging, layoutMode]);

  // Summaries
  const [bookSummary, setBookSummary] = useState('');
  const [chapterSummary, setChapterSummary] = useState('');
  const bookSummaryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chapterSummaryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [showSummaryPopup, setShowSummaryPopup] = useState(false);
  const [summaryHeight, setSummaryHeight] = useState(250);

  // Critique history
  const [pastCritiques, setPastCritiques] = useState<CritiqueEntry[]>([]);
  const [textAtLastCritique, setTextAtLastCritique] = useState<string | null>(null);
  const [viewingCritiqueId, setViewingCritiqueId] = useState<string | null>(null);
  const [viewingSummary, setViewingSummary] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());

  // Custom panel
  const [favoritePanel, setFavoritePanel] = useState<string[]>([]);
  const [showPanelConfig, setShowPanelConfig] = useState(false);

  // Focus mode: F11 toggles all panels off for distraction-free writing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        setShowSidebar(prev => !prev);
        setShowRightPanel(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load books on mount
  useEffect(() => {
    loadBooks();
    loadReviewers();
    getWriterProfile().then(p => { if (p) setWriterProfile(p); });
    getFavoritePanel().then(p => { if (p.length) setFavoritePanel(p); });
  }, []);

  const loadReviewers = async () => {
    try {
      const res = await fetch('http://localhost:8000/reviewers');
      if (res.ok) {
        const data = await res.json();
        setReviewers(data);
      }
    } catch (e) {
      console.error("Erreur chargement critiques", e);
    }
  };

  // Load chapters when book selected + load book summary
  useEffect(() => {
    if (selectedBook) {
      loadChapters(selectedBook.id);
      setBookSummary(selectedBook.summary || '');
      setSidebarView('chapters');
    } else {
      setChapters([]);
      setSelectedChapter(null);
      setBookSummary('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBook?.id]);

  // Load chapter content + summary + critiques when chapter ID changes
  const selectedChapterId = selectedChapter?.id;
  useEffect(() => {
    // Flush any pending save for the previous chapter
    flushSave.current();

    if (selectedChapter && selectedChapterId) {
      setText(selectedChapter.content || '');
      setChapterSummary(selectedChapter.summary || '');
      setCritique('');
      setViewingCritiqueId(null);
      // Load critique history
      getCritiquesByChapter(selectedChapterId).then(critiques => {
        setPastCritiques(critiques);
        if (critiques.length > 0) {
          setTextAtLastCritique(critiques[critiques.length - 1].textSnapshot);
        } else {
          setTextAtLastCritique(null);
        }
      });
    } else if (!selectedChapterId) {
      setText('');
      setChapterSummary('');
      setPastCritiques([]);
      setTextAtLastCritique(null);
      setCritique('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapterId]);

  // Immediate save helper (flushes pending debounce)
  const flushSave = useRef<() => void>(() => {});
  useEffect(() => {
    flushSave.current = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (selectedChapter && editorRef.current) {
        const currentContent = editorRef.current.getHTML();
        if (currentContent !== selectedChapter.content) {
          saveChapterContent(selectedChapter.id, currentContent);
        }
      }
    };
  });

  // Save on tab close / hide
  useEffect(() => {
    const handleBeforeUnload = () => flushSave.current();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushSave.current();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Auto-save with debounce
  useEffect(() => {
    if (selectedChapter && text !== selectedChapter.content) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      
      saveTimeoutRef.current = setTimeout(async () => {
        setSaving(true);
        await saveChapterContent(selectedChapter.id, text);
        setSelectedChapter(prev => prev ? { ...prev, content: text } : null);
        setSaving(false);
      }, 1000);
    }

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [text, selectedChapter]);

  const loadBooks = async () => {
    const allBooks = await getBooks();
    setBooks(allBooks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  };

  const loadChapters = async (bookId: string) => {
    const bookChapters = await getChaptersByBook(bookId);
    setChapters(bookChapters);
  };

  const handleCreateBook = async () => {
    if (!newBookName.trim()) return;
    const book = await createBook(newBookName.trim());
    setBooks(prev => [book, ...prev]);
    setNewBookName('');
    setSelectedBook(book);
  };

  const handleDeleteBook = async (bookId: string) => {
    if (!confirm('Supprimer cet ouvrage et tous ses chapitres ?')) return;
    await deleteBook(bookId);
    if (selectedBook?.id === bookId) {
      setSelectedBook(null);
      setSelectedChapter(null);
    }
    loadBooks();
  };

  const handleCreateChapter = async () => {
    if (!selectedBook || !newChapterName.trim()) return;
    const chapter = await createChapter(selectedBook.id, newChapterName.trim());
    setChapters(prev => [...prev, chapter]);
    setNewChapterName('');
    setSelectedChapter(chapter);
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!confirm('Supprimer ce chapitre ?')) return;
    await deleteChapter(chapterId);
    if (selectedChapter?.id === chapterId) {
      setSelectedChapter(null);
    }
    if (selectedBook) loadChapters(selectedBook.id);
  };

  // Generate text summary via AI
  const handleGenerateChapterSummary = async () => {
    const plainText = htmlToPlainText(text);
    if (!plainText.trim() || !selectedChapter) return;
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
        setChapterSummary(data.summary);
        await updateChapter(selectedChapter.id, { summary: data.summary });
        setShowSummaryPopup(true);
      }
    } catch (e: unknown) {
      console.error('Erreur génération résumé:', e);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleReview = async () => {
    const plainText = htmlToPlainText(text);
    if (!plainText.trim()) return;

    setLoading(true);
    setError(null);
    setViewingCritiqueId(null);

    // Prepend text summary to critique if available
    const summaryHeader = chapterSummary
      ? `**📋 Résumé du texte :**\n${chapterSummary}\n\n---\n\n`
      : '';
    setCritique(summaryHeader);

    // Always send previous critiques (summarized by backend via mistral-small)
    const textChanged = textAtLastCritique !== null && text !== textAtLastCritique;
    const previousCritiquesToSend = pastCritiques.length > 0
      ? pastCritiques.slice(-5).map(c => ({ reviewer: c.reviewer, critique: c.critique }))
      : null;

    try {
      const response = await fetch('http://localhost:8000/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: plainText,
          reviewer: selectedReviewer,
          writer_profile: writerProfile || null,
          book_summary: bookSummary || null,
          chapter_summary: chapterSummary || null,
          previous_critiques: previousCritiquesToSend,
          text_changed: textChanged,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("Pas de stream disponible");

      let fullCritique = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullCritique += chunk;
        setCritique(prev => prev + chunk);
      }

      // Save critique to IndexedDB
      if (selectedChapter && fullCritique) {
        const entry = await saveCritique(selectedChapter.id, selectedReviewer, fullCritique, text);
        setPastCritiques(prev => [...prev, entry]);
        setTextAtLastCritique(text);

        // Generate summary in background via mistral-small
        fetch('http://localhost:8000/summarize-critique', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ critique: fullCritique }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.summary) {
              updateCritiqueSummary(entry.id, data.summary);
              setPastCritiques(prev =>
                prev.map(c => c.id === entry.id ? { ...c, summary: data.summary } : c)
              );
            }
          })
          .catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Une erreur est survenue.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDialogue = async () => {
    const plainText = htmlToPlainText(text);
    if (!plainText.trim()) return;

    setLoading(true);
    setError(null);
    setViewingCritiqueId(null);
    setRightTab('critique');

    // Prepend text summary to critique if available
    const summaryHeader = chapterSummary
      ? `**📋 Résumé du texte :**\n${chapterSummary}\n\n---\n\n`
      : '';
    setCritique(summaryHeader);

    try {
      const response = await fetch('http://localhost:8000/review-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: plainText,
          writer_profile: writerProfile || null,
          book_summary: bookSummary || null,
          chapter_summary: chapterSummary || null,
          num_authors: 3,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Pas de stream disponible");

      let fullCritique = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullCritique += chunk;
        setCritique(prev => prev + chunk);
      }

      // Save as "dialogue" critique
      if (selectedChapter && fullCritique) {
        const entry = await saveCritique(selectedChapter.id, 'dialogue_random', fullCritique, text);
        setPastCritiques(prev => [...prev, entry]);

        // Generate summary in background via mistral-small
        fetch('http://localhost:8000/summarize-critique', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ critique: fullCritique }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.summary) {
              updateCritiqueSummary(entry.id, data.summary);
              setPastCritiques(prev =>
                prev.map(c => c.id === entry.id ? { ...c, summary: data.summary } : c)
              );
            }
          })
          .catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Une erreur est survenue.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReadersPanel = async () => {
    const plainText = htmlToPlainText(text);
    if (!plainText.trim()) return;

    setLoading(true);
    setError(null);
    setViewingCritiqueId(null);
    setRightTab('critique');

    const summaryHeader = chapterSummary
      ? `**📋 Résumé du texte :**\n${chapterSummary}\n\n---\n\n`
      : '';
    setCritique(summaryHeader);

    try {
      const response = await fetch('http://localhost:8000/review-readers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: plainText,
          writer_profile: writerProfile || null,
          book_summary: bookSummary || null,
          chapter_summary: chapterSummary || null,
          num_readers: 5,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Pas de stream disponible");

      let fullCritique = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullCritique += chunk;
        setCritique(prev => prev + chunk);
      }

      if (selectedChapter && fullCritique) {
        const entry = await saveCritique(selectedChapter.id, 'panel_lecteurs', fullCritique, text);
        setPastCritiques(prev => [...prev, entry]);

        fetch('http://localhost:8000/summarize-critique', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ critique: fullCritique }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.summary) {
              updateCritiqueSummary(entry.id, data.summary);
              setPastCritiques(prev =>
                prev.map(c => c.id === entry.id ? { ...c, summary: data.summary } : c)
              );
            }
          })
          .catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Une erreur est survenue.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomPanel = async () => {
    const plainText = htmlToPlainText(text);
    if (!plainText.trim() || favoritePanel.length === 0) return;

    setLoading(true);
    setError(null);
    setViewingCritiqueId(null);
    setRightTab('critique');

    const summaryHeader = chapterSummary
      ? `**📋 Résumé du texte :**\n${chapterSummary}\n\n---\n\n`
      : '';
    setCritique(summaryHeader);

    try {
      const response = await fetch('http://localhost:8000/review-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: plainText,
          reviewer_ids: favoritePanel,
          writer_profile: writerProfile || null,
          book_summary: bookSummary || null,
          chapter_summary: chapterSummary || null,
        }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Pas de stream disponible");

      let fullCritique = summaryHeader;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullCritique += chunk;
        setCritique(prev => prev + chunk);
      }

      if (selectedChapter && fullCritique) {
        const entry = await saveCritique(selectedChapter.id, 'mon_panel', fullCritique, text);
        setPastCritiques(prev => [...prev, entry]);

        fetch('http://localhost:8000/summarize-critique', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ critique: fullCritique }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.summary) {
              updateCritiqueSummary(entry.id, data.summary);
              setPastCritiques(prev =>
                prev.map(c => c.id === entry.id ? { ...c, summary: data.summary } : c)
              );
            }
          })
          .catch(() => {});
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Une erreur est survenue.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const togglePanelMember = async (id: string) => {
    const updated = favoritePanel.includes(id)
      ? favoritePanel.filter(r => r !== id)
      : [...favoritePanel, id];
    setFavoritePanel(updated);
    await saveFavoritePanel(updated);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <div style={{ width: showSidebar ? '17rem' : '0px', transition: 'width 200ms ease' }} className="flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col overflow-hidden">
        <div className="w-[17rem] h-full flex flex-col">
          {/* Logo */}
          <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
            <h1 className="text-[var(--accent)] font-semibold text-sm tracking-widest uppercase">Writer</h1>
          </div>

          {/* Books Header */}
          <div className="px-4 pt-4 pb-3">
            <h2 className="text-[var(--accent)] font-semibold text-sm tracking-widest uppercase mb-3">Ouvrages</h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nouvel ouvrage…"
                value={newBookName}
                onChange={(e) => setNewBookName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateBook()}
                className="input-writer flex-1 px-3 py-1.5 text-[var(--text-primary)] text-sm rounded-lg"
              />
              <button
                onClick={handleCreateBook}
                className="px-2.5 py-1.5 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-sm rounded-lg transition-all"
              >
                +
              </button>
            </div>
          </div>

          {/* Books List */}
          <div className="flex-1 overflow-y-auto px-2">
            {books.map(book => (
              <div key={book.id}>
                <div
                  className={`sidebar-item px-3 py-2 cursor-pointer flex items-center justify-between group rounded-lg mx-0 my-0.5 ${
                    selectedBook?.id === book.id ? 'active' : ''
                  }`}
                  onClick={() => setSelectedBook(book)}
                >
                  <span className={`text-sm truncate ${selectedBook?.id === book.id ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                    {book.title}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteBook(book.id); }}
                    className="text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                  >
                    ✕
                  </button>
                </div>
                
                {/* Chapters */}
                {selectedBook?.id === book.id && (
                  <div className="ml-3 pl-3 border-l border-[var(--border-subtle)]">
                    {/* View toggle: Chapters / World Building */}
                    <div className="flex gap-1 my-2">
                      <button
                        onClick={() => setSidebarView('chapters')}
                        className={`flex-1 px-2 py-2 text-xs font-semibold tracking-wide uppercase rounded-md transition-all ${
                          sidebarView === 'chapters'
                            ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-bold'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                        }`}
                      >
                        Chapitres
                      </button>
                      <button
                        onClick={() => { setSidebarView('worldbuilding'); setSelectedChapter(null); }}
                        className={`flex-1 px-2 py-2 text-xs font-semibold tracking-wide uppercase rounded-md transition-all ${
                          sidebarView === 'worldbuilding'
                            ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-bold'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                        }`}
                      >
                        🌍 Univers
                      </button>
                    </div>

                    {sidebarView === 'chapters' && (
                      <>
                    {chapters.map(chapter => (
                      <div
                        key={chapter.id}
                        className={`sidebar-item px-3 py-1.5 cursor-pointer flex items-center justify-between group rounded-md my-0.5 ${
                          selectedChapter?.id === chapter.id ? 'active' : ''
                        }`}
                        onClick={() => setSelectedChapter(chapter)}
                      >
                        <span className={`text-sm truncate ${selectedChapter?.id === chapter.id ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                          {chapter.title}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteChapter(chapter.id); }}
                          className="text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    
                    {/* New Chapter */}
                    <div className="py-2 pr-1">
                      <div className="flex gap-1">
                        <input
                          type="text"
                          placeholder="Nouveau chapitre…"
                          value={newChapterName}
                          onChange={(e) => setNewChapterName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateChapter()}
                          className="input-writer flex-1 px-2 py-1 text-[var(--text-secondary)] text-xs rounded-md"
                        />
                        <button
                          onClick={handleCreateChapter}
                          className="px-2 py-1 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-xs rounded-md transition-all"
                        >
                          +
                        </button>
                      </div>
                    </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Export / Import */}
          <div className="p-3 border-t border-[var(--border-subtle)] flex gap-2">
            <button
              onClick={async () => {
                try {
                  const data = await exportDatabase();
                  downloadExport(data);
                } catch (e) {
                  alert('Erreur lors de l\'export : ' + (e as Error).message);
                }
              }}
              className="flex-1 px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-all flex items-center justify-center gap-1.5"
            >
              ↓ Export
            </button>
            <label className="flex-1 px-2 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-all flex items-center justify-center gap-1.5 cursor-pointer">
              ↑ Import
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const data: WriterExport = JSON.parse(text);
                    if (!confirm(`Importer cette sauvegarde ?\n\nCela remplacera TOUTES les données actuelles par :\n- ${data.books?.length ?? 0} ouvrage(s)\n- ${data.chapters?.length ?? 0} chapitre(s)\n- ${(data.critiques?.length ?? 0)} critique(s)\n\nSauvegarde du ${data.exportedAt ? new Date(data.exportedAt).toLocaleDateString('fr-FR') : '?'}`)) {
                      e.target.value = '';
                      return;
                    }
                    const result = await importDatabase(data);
                    alert(`Import réussi !\n${result.books} ouvrage(s), ${result.chapters} chapitre(s), ${result.critiques} critique(s)`);
                    const freshBooks = await getBooks();
                    setBooks(freshBooks);
                    setSelectedBook(null);
                    setSelectedChapter(null);
                    setChapters([]);
                  } catch (err) {
                    alert('Erreur lors de l\'import : ' + (err as Error).message);
                  }
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Toggle Sidebar */}
      <button
        onClick={() => setShowSidebar(!showSidebar)}
        className="flex-shrink-0 w-5 h-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center justify-center border-r border-[var(--border-subtle)] transition-all text-xs"
        title={showSidebar ? 'Masquer la barre latérale (F11)' : 'Afficher la barre latérale (F11)'}
      >
        {showSidebar ? '‹' : '›'}
      </button>

      {/* Main Content */}
      {sidebarView === 'worldbuilding' && selectedBook ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <WorldBuilding bookId={selectedBook.id} bookSummary={bookSummary} reviewers={reviewers} />
        </div>
      ) : (
      <div className={`flex-1 flex ${layoutMode === 'vertical' ? 'flex-col' : ''}`} ref={mainContentRef}>
        {/* Editor Panel */}
        {!critiqueFullscreen && (
        <div className="flex flex-col" data-editor-panel style={{
          ...(layoutMode === 'horizontal'
            ? { width: showRightPanel ? `${editorWidth}%` : '100%' }
            : { height: showRightPanel ? `${editorWidth}%` : '100%', width: '100%' }
          )
        }}>
          {/* Toolbar */}
          <div className="flex-shrink-0 px-5 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] flex items-center gap-4">
            <span className="text-[var(--text-primary)] text-sm font-semibold tracking-tight">
              {selectedChapter ? selectedChapter.title : 'Éditeur'}
            </span>
            
            {saving && <span className="text-[var(--accent)]/50 text-xs">Sauvegarde…</span>}
            
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={() => setShowRightPanel(p => !p)}
                className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm px-1.5"
                title={showRightPanel ? 'Masquer le panneau critique' : 'Afficher le panneau critique'}
              >
                {showRightPanel ? '⟫' : '⟪'}
              </button>
              <button
                onClick={() => setLayoutMode(m => m === 'horizontal' ? 'vertical' : 'horizontal')}
                className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm px-1.5"
                title={layoutMode === 'horizontal' ? 'Passer en mode haut/bas' : 'Passer en mode gauche/droite'}
              >
                {layoutMode === 'horizontal' ? '⬒' : '⬓'}
              </button>

              <div className="w-px h-6 bg-[var(--border-subtle)] mx-1" />
              {editorRef.current && (
                <EditorToolbar
                  editor={editorRef.current}
                  wordCount={(() => { const t = htmlToPlainText(text); const w = t.trim() ? t.trim().split(/\s+/).length : 0; return `${w} mot${w > 1 ? 's' : ''} · ${t.length} car.`; })()}
                  onGenerateSummary={selectedChapter ? handleGenerateChapterSummary : undefined}
                  isGeneratingSummary={isGeneratingSummary}
                  hasSummary={!!chapterSummary}
                  onShowSummary={() => setShowSummaryPopup(p => !p)}
                />
              )}
            </div>
          </div>

          {/* Editor */}
          {selectedChapter ? (
            <RichEditor
              content={text}
              onUpdate={(html) => setText(html)}
              placeholder="Commencez à écrire…"
              wrapperClassName="editor-area flex-1 min-h-0 overflow-y-auto"
              className="px-10 py-8 focus:outline-none min-h-full"
              style={{ fontSize: '18px' }}
              editorRef={editorRef}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-[var(--text-muted)] text-lg font-light mb-1">Aucun chapitre sélectionné</p>
                <p className="text-[var(--text-muted)]/60 text-sm">Créez un ouvrage et un chapitre pour commencer</p>
              </div>
            </div>
          )}

          {/* Summary popup - resizable */}
          {showSummaryPopup && chapterSummary && (
            <div className="flex-shrink-0 border-t border-[var(--accent)]/30 bg-[var(--bg-surface)] flex flex-col" style={{ height: summaryHeight }}>
              <div className="px-6 py-2 flex items-center justify-between flex-shrink-0">
                <span className="text-[var(--accent)] text-xs font-bold tracking-widest uppercase">📋 Résumé auto-généré</span>
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
                    onClick={handleGenerateChapterSummary}
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
                  value={chapterSummary}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChapterSummary(val);
                    if (chapterSummaryTimeoutRef.current) clearTimeout(chapterSummaryTimeoutRef.current);
                    chapterSummaryTimeoutRef.current = setTimeout(() => {
                      if (selectedChapter) updateChapter(selectedChapter.id, { summary: val });
                    }, 1000);
                  }}
                />
              </div>
            </div>
          )}

          {/* Bottom Bar */}
          <div className="flex-shrink-0 px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] flex items-center gap-3">
            <select
              className="input-writer px-3 py-2 rounded-lg text-[var(--text-secondary)] text-sm"
              value={selectedReviewer}
              onChange={(e) => setSelectedReviewer(e.target.value)}
            >
              {reviewers.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button
              className="btn-accent flex-1 py-2.5 rounded-lg text-sm"
              onClick={handleReview}
              disabled={loading || !text}
            >
              {loading ? 'Analyse en cours…' : 'Obtenir une critique'}
            </button>
            <button
              className="py-2.5 px-4 rounded-lg text-sm font-medium transition-all border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/15"
              onClick={handleDialogue}
              disabled={loading || !text}
              title="3 auteurs au hasard débattent de votre texte"
            >
              {loading ? '…' : '🎲 Random'}
            </button>
            <button
              className="py-2.5 px-4 rounded-lg text-sm font-medium transition-all border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/15"
              onClick={handleReadersPanel}
              disabled={loading || !text}
              title="5 lecteurs aléatoires donnent leur avis"
            >
              {loading ? '…' : '👥 Lecteurs'}
            </button>
            <button
              className="py-2.5 px-4 rounded-lg text-sm font-medium transition-all border border-amber-500/50 text-amber-400 hover:bg-amber-500/15"
              onClick={favoritePanel.length > 0 ? handleCustomPanel : () => setShowPanelConfig(true)}
              disabled={loading || !text}
              title={favoritePanel.length > 0 ? `Mon panel : ${favoritePanel.length} auteurs` : 'Configurer mon panel'}
            >
              {loading ? '…' : `⭐ Panel (${favoritePanel.length})`}
            </button>
            <button
              className="py-2.5 px-3 rounded-lg text-sm font-medium transition-all border border-amber-500/30 text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/15"
              onClick={() => setShowPanelConfig(true)}
              title="Modifier la composition du panel"
            >
              ✏️ Modifier panel
            </button>
          </div>
        </div>
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

        {/* Full-screen overlay during drag to capture all mouse events */}
        {isDragging && (
          <div className="fixed inset-0 z-50" style={{ cursor: layoutMode === 'horizontal' ? 'col-resize' : 'row-resize' }} />
        )}

        {/* Draggable Divider */}
        {showRightPanel && !critiqueFullscreen && (
          <div
            style={{
              ...(layoutMode === 'horizontal'
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

        {/* Critique Panel */}
        {showRightPanel && (
        <div className="flex flex-col bg-[var(--bg-primary)]" style={{
          ...(critiqueFullscreen
            ? { width: '100%', height: '100%' }
            : layoutMode === 'horizontal'
              ? { width: `${100 - editorWidth}%` }
              : { height: `${100 - editorWidth}%`, width: '100%' }
          )
        }}>
          {/* Tabs */}
          <div className="flex-shrink-0 flex border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
            <button
              onClick={() => setCritiqueFullscreen(f => !f)}
              className="px-3 py-3 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-sm"
              title={critiqueFullscreen ? 'Réduire le panneau' : 'Plein écran'}
            >
              {critiqueFullscreen ? '⊟' : '⊞'}
            </button>
            <button
              onClick={() => setRightTab('critique')}
              className={`tab-btn px-5 py-3 text-sm font-medium ${
                rightTab === 'critique'
                  ? 'active text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Critique
              {pastCritiques.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-[var(--accent)]/10 text-[var(--accent)] rounded-full">{pastCritiques.length}</span>
              )}
            </button>
            <button
              onClick={() => setRightTab('contexte')}
              className={`tab-btn px-5 py-3 text-sm font-medium ${
                rightTab === 'contexte'
                  ? 'active text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Contexte
            </button>
            <button
              onClick={() => setRightTab('profil')}
              className={`tab-btn px-5 py-3 text-sm font-medium ${
                rightTab === 'profil'
                  ? 'active text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Profil
            </button>
          </div>

          {/* Tab Content */}
          {rightTab === 'critique' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {error && (
                <div className="flex-shrink-0 px-5 py-3 bg-red-500/5 border-b border-red-500/10 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Progression indicator */}
              {pastCritiques.length > 0 && !loading && (
                <div className="flex-shrink-0 px-5 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
                  <span className="text-[var(--text-muted)] text-xs">
                    {pastCritiques.length} critique{pastCritiques.length > 1 ? 's' : ''}
                  </span>
                  {textAtLastCritique !== null && text !== textAtLastCritique ? (
                    <span className="text-emerald-400/80 text-xs">Texte modifié — progression évaluée</span>
                  ) : textAtLastCritique !== null ? (
                    <span className="text-[var(--text-muted)] text-xs">Texte non modifié</span>
                  ) : null}
                </div>
              )}

              {/* Main critique area */}
              <div className="critique-area flex-1 overflow-y-auto">
               <div className="critique-area-bg px-6 py-6">
                {/* Current critique or streaming */}
                {(critique || loading) && !viewingCritiqueId && (
                  <div className="critique-content">
                    {renderMarkdownContent(critique, renderCritiqueLine)}
                    {loading && <span className="loading-cursor text-[var(--accent)] text-lg">▊</span>}
                  </div>
                )}

                {/* Viewing a past critique */}
                {viewingCritiqueId && (() => {
                  const pc = pastCritiques.find(c => c.id === viewingCritiqueId);
                  if (!pc) return null;
                  const idx = pastCritiques.indexOf(pc);
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-5">
                        <button
                          onClick={() => { setViewingCritiqueId(null); setViewingSummary(false); }}
                          className="text-[var(--accent)] hover:text-[var(--accent)]/80 text-sm flex items-center gap-1.5 transition-colors"
                        >
                          ← Retour
                        </button>
                        <span className="text-[var(--text-muted)] text-xs">
                          #{idx + 1} — {pc.reviewer} — {new Date(pc.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex gap-2 mb-5">
                        <button
                          onClick={() => setViewingSummary(false)}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                            !viewingSummary
                              ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium'
                              : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                          }`}
                        >
                          Critique complète
                        </button>
                        <button
                          onClick={() => setViewingSummary(true)}
                          disabled={!pc.summary}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                            viewingSummary
                              ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium'
                              : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30 disabled:cursor-not-allowed'
                          }`}
                        >
                          Résumé
                        </button>
                      </div>
                      {viewingSummary && pc.summary ? (
                        <div className="critique-content p-5 border border-white/10 rounded-xl">
                          {renderMarkdownContent(pc.summary, renderCritiqueLine)}
                        </div>
                      ) : (
                        <div className="critique-content">
                          {renderMarkdownContent(pc.critique, renderCritiqueLine)}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Empty state */}
                {!critique && !loading && !viewingCritiqueId && pastCritiques.length === 0 && !error && (
                  <div className="h-full flex flex-col items-center justify-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[var(--accent)]/5 flex items-center justify-center">
                      <span className="text-[var(--accent)]/40 text-xl">✦</span>
                    </div>
                    <p className="text-[var(--text-muted)] text-sm">Sélectionnez un critique et lancez l&apos;analyse</p>
                  </div>
                )}

                {/* No current critique but has history */}
                {!critique && !loading && !viewingCritiqueId && pastCritiques.length > 0 && !error && (
                  <div className="text-center py-10">
                    <p className="text-[var(--text-muted)] text-sm mb-1">Pas de critique en cours</p>
                    <p className="text-[var(--text-muted)]/60 text-xs">Consultez l&apos;historique ou lancez une nouvelle analyse</p>
                  </div>
                )}
               </div>
              </div>

              {/* Past critiques dropdown */}
              {pastCritiques.length > 0 && !loading && (
                <div className="flex-shrink-0 border-t border-[var(--border-subtle)] px-5 py-2.5 bg-[var(--bg-secondary)] flex items-center gap-2">
                  <span className="text-[var(--accent)] text-sm font-semibold tracking-widest uppercase flex-shrink-0">Historique</span>
                  <select
                    className="input-writer flex-1 px-2 py-1.5 text-sm rounded-lg text-[var(--text-secondary)] truncate"
                    value={viewingCritiqueId || ''}
                    onChange={(e) => {
                      const id = e.target.value;
                      setViewingCritiqueId(id || null);
                      setViewingSummary(false);
                      if (id) {
                        const pc = pastCritiques.find(c => c.id === id);
                        if (pc) setCritique(pc.critique);
                      }
                    }}
                  >
                    <option value="">— Sélectionner —</option>
                    {[...pastCritiques].reverse().map((pc, idx) => {
                      const num = pastCritiques.length - idx;
                      const date = new Date(pc.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                      return (
                        <option key={pc.id} value={pc.id}>
                          #{num} — {pc.reviewer} — {date}
                        </option>
                      );
                    })}
                  </select>
                  {viewingCritiqueId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Supprimer cette critique ?')) {
                          deleteCritique(viewingCritiqueId).then(() => {
                            setPastCritiques(prev => prev.filter(c => c.id !== viewingCritiqueId));
                            setViewingCritiqueId(null);
                            setCritique('');
                          });
                        }
                      }}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors text-sm flex-shrink-0 px-1"
                      title="Supprimer cette critique"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : rightTab === 'contexte' ? (
            <div className="flex-1 flex flex-col px-6 py-6 overflow-y-auto gap-6">
              {/* Book Summary */}
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-1 tracking-tight">Résumé de l&apos;ouvrage</h3>
                <p className="text-[var(--text-muted)] text-xs mb-3">
                  Thème, genre, ambiance, intrigue principale…
                </p>
                <textarea
                  className="input-writer w-full min-h-[100px] p-4 text-[var(--text-secondary)] placeholder-[var(--text-muted)] rounded-xl resize-none leading-relaxed text-sm disabled:opacity-30"
                  placeholder="Ex: Un thriller psychologique se déroulant dans un village isolé des Pyrénées…"
                  value={bookSummary}
                  disabled={!selectedBook}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBookSummary(val);
                    if (bookSummaryTimeoutRef.current) clearTimeout(bookSummaryTimeoutRef.current);
                    bookSummaryTimeoutRef.current = setTimeout(() => {
                      if (selectedBook) updateBook(selectedBook.id, { summary: val });
                    }, 1000);
                  }}
                />
                {!selectedBook && <p className="text-[var(--text-muted)] text-xs mt-1">Sélectionnez un ouvrage</p>}
              </div>

              {/* Chapter Summary */}
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-1 tracking-tight">Résumé du chapitre</h3>
                <p className="text-[var(--text-muted)] text-xs mb-3">
                  Scènes clés, objectifs narratifs…
                </p>
                <textarea
                  className="input-writer w-full min-h-[100px] p-4 text-[var(--text-secondary)] placeholder-[var(--text-muted)] rounded-xl resize-none leading-relaxed text-sm disabled:opacity-30"
                  placeholder="Ex: Introduction du personnage principal. Première scène de tension…"
                  value={chapterSummary}
                  disabled={!selectedChapter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChapterSummary(val);
                    if (chapterSummaryTimeoutRef.current) clearTimeout(chapterSummaryTimeoutRef.current);
                    chapterSummaryTimeoutRef.current = setTimeout(() => {
                      if (selectedChapter) updateChapter(selectedChapter.id, { summary: val });
                    }, 1000);
                  }}
                />
                {!selectedChapter && <p className="text-[var(--text-muted)] text-xs mt-1">Sélectionnez un chapitre</p>}
              </div>

              {/* Context status */}
              <div className="mt-auto p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl">
                <p className="text-[var(--accent)] text-xs font-semibold tracking-widest uppercase mb-3">Contexte actif</p>
                <div className="space-y-2">
                  {[
                    { label: 'Profil écrivain', active: !!writerProfile },
                    { label: 'Résumé ouvrage', active: !!bookSummary },
                    { label: 'Résumé chapitre', active: !!chapterSummary },
                    {
                      label: `Historique (${pastCritiques.length})${pastCritiques.length > 0 && textAtLastCritique !== null && text === textAtLastCritique ? ' — non modifié' : ''}`,
                      active: pastCritiques.length > 0 && textAtLastCritique !== null && text !== textAtLastCritique
                    },
                  ].map((item, i) => (
                    <p key={i} className="text-xs flex items-center gap-2.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${item.active ? 'bg-emerald-400' : 'bg-[var(--text-muted)]/30'}`} />
                      <span className={item.active ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}>{item.label}</span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col px-6 py-6 overflow-y-auto">
              <div className="mb-4">
                <h3 className="text-[var(--text-primary)] font-semibold text-sm mb-1 tracking-tight">Votre profil d&apos;écrivain</h3>
                <p className="text-[var(--text-muted)] text-xs mb-4">
                  Genre littéraire, niveau, objectifs, points forts et faiblesses. Le critique adaptera ses conseils.
                </p>
              </div>
              <textarea
                className="input-writer flex-1 min-h-[200px] p-4 text-[var(--text-secondary)] rounded-xl resize-none leading-relaxed text-sm"
                placeholder={"Ex: Auteur débutant en dark fantasy, inspiré par Joe Abercrombie et Robin Hobb. Points forts : dialogues. Faiblesses : descriptions et worldbuilding."}
                value={writerProfile}
                onChange={(e) => {
                  setWriterProfile(e.target.value);
                  saveWriterProfile(e.target.value);
                }}
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[var(--text-muted)] text-xs tabular-nums">{writerProfile.length} caractères</span>
                {writerProfile && (
                  <span className="text-emerald-400/70 text-xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Profil actif
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      )}
    </div>
  );
}