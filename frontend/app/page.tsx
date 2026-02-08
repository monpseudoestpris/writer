'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import {
  Book, Chapter, CritiqueEntry,
  getBooks, createBook, deleteBook,
  getChaptersByBook, createChapter, deleteChapter, saveChapterContent,
  getWriterProfile, saveWriterProfile,
  updateBook, updateChapter,
  saveCritique, getCritiquesByChapter, updateCritiqueSummary, deleteCritique,
  exportDatabase, downloadExport, importDatabase, WriterExport
} from './lib/db';

type Reviewer = { id: string; name: string };

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
  const [fontSize, setFontSize] = useState(18);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // UI
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [editorWidth, setEditorWidth] = useState(50); // percentage
  const [isDragging, setIsDragging] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [newBookName, setNewBookName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [rightTab, setRightTab] = useState<'critique' | 'profil' | 'contexte'>('critique');
  const [writerProfile, setWriterProfile] = useState('');

  // Drag to resize panels
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setEditorWidth(Math.min(85, Math.max(25, pct)));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('resizing-panels');
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('resizing-panels');
    };
  }, [isDragging]);

  // Summaries
  const [bookSummary, setBookSummary] = useState('');
  const [chapterSummary, setChapterSummary] = useState('');
  const bookSummaryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const chapterSummaryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Critique history
  const [pastCritiques, setPastCritiques] = useState<CritiqueEntry[]>([]);
  const [textAtLastCritique, setTextAtLastCritique] = useState<string | null>(null);
  const [viewingCritiqueId, setViewingCritiqueId] = useState<string | null>(null);
  const [viewingSummary, setViewingSummary] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());

  // Load books on mount
  useEffect(() => {
    loadBooks();
    loadReviewers();
    getWriterProfile().then(p => { if (p) setWriterProfile(p); });
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
      setText(selectedChapter.content);
      if (editorRef.current) {
        editorRef.current.innerHTML = selectedChapter.content || '';
      }
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
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
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
        const currentContent = editorRef.current.innerHTML;
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

  const handleReview = async () => {
    const plainText = htmlToPlainText(text);
    if (!plainText.trim()) return;

    setLoading(true);
    setError(null);
    setCritique('');
    setViewingCritiqueId(null);

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

      let fullCritique = '';
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

  const toggleBold = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('bold', false);
  };

  const toggleItalic = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('italic', false);
  };

  const toggleUnderline = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('underline', false);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-60 flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col">
          {/* Logo */}
          <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
            <h1 className="text-[var(--accent)] font-semibold text-sm tracking-widest uppercase">Writer</h1>
          </div>

          {/* Books Header */}
          <div className="px-4 pt-4 pb-3">
            <h2 className="text-[var(--text-muted)] font-medium text-[11px] tracking-widest uppercase mb-3">Ouvrages</h2>
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
                    {chapters.map(chapter => (
                      <div
                        key={chapter.id}
                        className={`sidebar-item px-3 py-1.5 cursor-pointer flex items-center justify-between group rounded-md my-0.5 ${
                          selectedChapter?.id === chapter.id ? 'active' : ''
                        }`}
                        onClick={() => setSelectedChapter(chapter)}
                      >
                        <span className={`text-sm truncate ${selectedChapter?.id === chapter.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
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
      )}

      {/* Toggle Sidebar */}
      <button
        onClick={() => setShowSidebar(!showSidebar)}
        className="flex-shrink-0 w-5 h-full bg-[var(--bg-secondary)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center justify-center border-r border-[var(--border-subtle)] transition-all text-[10px]"
      >
        {showSidebar ? '‹' : '›'}
      </button>

      {/* Main Content */}
      <div className="flex-1 flex" ref={mainContentRef}>
        {/* Left - Editor */}
        <div className="flex flex-col" style={{ width: showRightPanel ? `${editorWidth}%` : '100%' }}>
          {/* Toolbar */}
          <div className="flex-shrink-0 px-5 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] flex items-center gap-4">
            <span className="text-[var(--text-muted)] text-sm font-medium tracking-tight">
              {selectedChapter ? selectedChapter.title : 'Éditeur'}
            </span>
            
            {saving && <span className="text-[var(--accent)]/50 text-xs">Sauvegarde…</span>}
            
            <button
              onClick={() => setShowRightPanel(p => !p)}
              className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors text-xs px-1.5"
              title={showRightPanel ? 'Masquer le panneau critique' : 'Afficher le panneau critique'}
            >
              {showRightPanel ? '⟫' : '⟪'}
            </button>
            
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={toggleBold}
                className="w-8 h-8 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-sm font-bold transition-colors"
                title="Gras (Ctrl+B)"
              >
                B
              </button>
              <button
                onClick={toggleItalic}
                className="w-8 h-8 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-sm italic transition-colors"
                title="Italique (Ctrl+I)"
              >
                I
              </button>
              <button
                onClick={toggleUnderline}
                className="w-8 h-8 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-sm underline transition-colors"
                title="Souligné (Ctrl+U)"
              >
                U
              </button>
              
              <div className="w-px h-5 bg-[var(--border-subtle)] mx-1" />
              
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setFontSize(f => Math.max(12, f - 2))}
                  className="w-7 h-7 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] text-xs transition-colors"
                >
                  −
                </button>
                <span className="w-7 text-center text-[var(--text-muted)] text-xs tabular-nums">{fontSize}</span>
                <button
                  onClick={() => setFontSize(f => Math.min(32, f + 2))}
                  className="w-7 h-7 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] text-xs transition-colors"
                >
                  +
                </button>
              </div>
              
              <span className="text-[var(--text-muted)] text-[11px] ml-2 tabular-nums">{(() => { const t = htmlToPlainText(text); const w = t.trim() ? t.trim().split(/\s+/).length : 0; return `${w} mot${w > 1 ? 's' : ''} · ${t.length} car.`; })()}</span>
            </div>
          </div>

          {/* Editor */}
          {selectedChapter ? (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="editor-area flex-1 min-h-0 px-10 py-8 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none overflow-y-auto"
              style={{ fontSize: `${fontSize}px` }}
              onInput={() => {
                if (editorRef.current) {
                  setText(editorRef.current.innerHTML);
                }
              }}
              data-placeholder="Commencez à écrire…"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-[var(--text-muted)] text-lg font-light mb-1">Aucun chapitre sélectionné</p>
                <p className="text-[var(--text-muted)]/60 text-sm">Créez un ouvrage et un chapitre pour commencer</p>
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
          </div>
        </div>

        {/* Full-screen overlay during drag to capture all mouse events */}
        {isDragging && (
          <div className="fixed inset-0 z-50" style={{ cursor: 'col-resize' }} />
        )}

        {/* Draggable Divider */}
        {showRightPanel && (
          <div
            style={{
              width: '6px',
              flexShrink: 0,
              cursor: 'col-resize',
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

        {/* Right - Critique / Profil */}
        {showRightPanel && (
        <div className="flex flex-col bg-[var(--bg-primary)]" style={{ width: `${100 - editorWidth}%` }}>
          {/* Tabs */}
          <div className="flex-shrink-0 flex border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
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
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-[var(--accent)]/10 text-[var(--accent)] rounded-full">{pastCritiques.length}</span>
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
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {/* Current critique or streaming */}
                {(critique || loading) && !viewingCritiqueId && (
                  <div className="critique-content">
                    {critique.split('\n').map((line, i) => renderCritiqueLine(line, i))}
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
                        <div className="critique-content p-5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl">
                          {pc.summary.split('\n').map((line, i) => renderCritiqueLine(line, i))}
                        </div>
                      ) : (
                        <div className="critique-content">
                          {pc.critique.split('\n').map((line, i) => renderCritiqueLine(line, i))}
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

              {/* Past critiques dropdown */}
              {pastCritiques.length > 0 && !loading && (
                <div className="flex-shrink-0 border-t border-[var(--border-subtle)] px-5 py-2.5 bg-[var(--bg-secondary)] flex items-center gap-2">
                  <span className="text-[var(--text-muted)] text-[11px] tracking-widest uppercase flex-shrink-0">Historique</span>
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
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors text-xs flex-shrink-0 px-1"
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
                <p className="text-[var(--text-muted)] text-[11px] font-medium tracking-widest uppercase mb-3">Contexte actif</p>
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
    </div>
  );
}