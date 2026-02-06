'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import {
  Book, Chapter, CritiqueEntry,
  getBooks, createBook, deleteBook,
  getChaptersByBook, createChapter, deleteChapter, saveChapterContent,
  getWriterProfile, saveWriterProfile,
  updateBook, updateChapter,
  saveCritique, getCritiquesByChapter, updateCritiqueSummary, deleteCritique
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
      return <strong key={i} className="font-semibold text-zinc-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i} className="italic text-amber-200/80">{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-zinc-800 text-amber-300 px-1.5 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
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
        <h2 key={i} className="text-xl font-bold text-amber-400 mb-4 mt-6 first:mt-0 pb-2 border-b border-zinc-800">
          {renderInline(content)}
        </h2>
      );
    }
    return (
      <h3 key={i} className="text-base font-bold text-amber-300 mt-6 mb-3 flex items-center gap-2">
        <span className="w-1 h-5 bg-amber-500 rounded-full inline-block flex-shrink-0" />
        {renderInline(content)}
      </h3>
    );
  }

  // Standalone bold line (acts as a sub-heading): **Some title**
  if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) {
    const inner = trimmed.replace(/^\*\*/, '').replace(/\*\*:?\s*$/, '');
    return (
      <h4 key={i} className="text-sm font-bold text-amber-200 mt-5 mb-2">
        {inner}
      </h4>
    );
  }

  // Numbered heading: "1. **Title**" or "1. Title" (bold = sub-heading style)
  const numberedBoldMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*\s*$/);
  if (numberedBoldMatch) {
    return (
      <h4 key={i} className="text-sm font-bold text-amber-200 mt-5 mb-2 flex items-center gap-2">
        <span className="text-amber-500">{numberedBoldMatch[1]}.</span>
        {numberedBoldMatch[2]}
      </h4>
    );
  }

  // Blockquote: > text
  if (trimmed.startsWith('> ') || trimmed === '>') {
    const content = trimmed.startsWith('> ') ? trimmed.slice(2) : '';
    return (
      <blockquote key={i} className="border-l-2 border-amber-600/40 pl-4 py-1 my-2 bg-amber-950/20 rounded-r-md text-zinc-300 italic text-sm leading-relaxed">
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
      <div key={i} className="flex gap-2 my-1 ml-2 text-sm leading-relaxed text-zinc-300">
        <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>
        <span>{renderInline(content)}</span>
      </div>
    );
  }

  // Numbered list: 1. text (not already caught as numbered heading)
  const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
  if (numberedMatch) {
    return (
      <div key={i} className="flex gap-2 my-1.5 ml-1">
        <span className="text-amber-500 font-bold text-sm w-6 flex-shrink-0 text-right">{numberedMatch[1]}.</span>
        <span className="text-zinc-200 text-sm leading-relaxed">{renderInline(numberedMatch[2])}</span>
      </div>
    );
  }

  // Regular paragraph
  return (
    <p key={i} className="text-zinc-300 text-sm leading-relaxed my-1.5">
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
  const [newBookName, setNewBookName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [rightTab, setRightTab] = useState<'critique' | 'profil' | 'contexte'>('critique');
  const [writerProfile, setWriterProfile] = useState('');

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
    <div className="h-screen flex overflow-hidden bg-zinc-900">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-64 flex-shrink-0 bg-zinc-800 border-r border-zinc-700 flex flex-col">
          {/* Books Header */}
          <div className="p-3 border-b border-zinc-700">
            <h2 className="text-zinc-300 font-semibold text-sm mb-2">📚 Ouvrages</h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Nouvel ouvrage..."
                value={newBookName}
                onChange={(e) => setNewBookName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateBook()}
                className="flex-1 px-2 py-1.5 bg-zinc-700 text-zinc-200 text-sm rounded border border-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleCreateBook}
                className="px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
              >
                +
              </button>
            </div>
          </div>

          {/* Books List */}
          <div className="flex-1 overflow-y-auto">
            {books.map(book => (
              <div key={book.id}>
                <div
                  className={`px-3 py-2 cursor-pointer flex items-center justify-between group ${
                    selectedBook?.id === book.id ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'
                  }`}
                  onClick={() => setSelectedBook(book)}
                >
                  <span className="text-zinc-300 text-sm truncate">📖 {book.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteBook(book.id); }}
                    className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs"
                  >
                    ✕
                  </button>
                </div>
                
                {/* Chapters */}
                {selectedBook?.id === book.id && (
                  <div className="bg-zinc-900/50">
                    {chapters.map(chapter => (
                      <div
                        key={chapter.id}
                        className={`pl-6 pr-3 py-1.5 cursor-pointer flex items-center justify-between group ${
                          selectedChapter?.id === chapter.id ? 'bg-blue-600/30 text-blue-300' : 'text-zinc-400 hover:bg-zinc-700/50'
                        }`}
                        onClick={() => setSelectedChapter(chapter)}
                      >
                        <span className="text-sm truncate">📄 {chapter.title}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteChapter(chapter.id); }}
                          className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    
                    {/* New Chapter */}
                    <div className="pl-6 pr-3 py-2">
                      <div className="flex gap-1">
                        <input
                          type="text"
                          placeholder="Nouveau chapitre..."
                          value={newChapterName}
                          onChange={(e) => setNewChapterName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateChapter()}
                          className="flex-1 px-2 py-1 bg-zinc-700 text-zinc-300 text-xs rounded border border-zinc-600 focus:outline-none"
                        />
                        <button
                          onClick={handleCreateChapter}
                          className="px-2 py-1 bg-zinc-600 hover:bg-zinc-500 text-zinc-300 text-xs rounded"
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
        </div>
      )}

      {/* Toggle Sidebar */}
      <button
        onClick={() => setShowSidebar(!showSidebar)}
        className="flex-shrink-0 w-6 h-full bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 flex items-center justify-center border-r border-zinc-700 transition-colors"
      >
        {showSidebar ? '◀' : '▶'}
      </button>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Left - Editor */}
        <div className="w-1/2 flex flex-col border-r border-zinc-700">
          {/* Toolbar */}
          <div className="flex-shrink-0 px-4 py-2 bg-zinc-800 border-b border-zinc-700 flex items-center gap-4">
            <span className="text-zinc-400 text-sm font-medium">
              {selectedChapter ? `✍️ ${selectedChapter.title}` : '✍️ Éditeur'}
            </span>
            
            {saving && <span className="text-zinc-500 text-xs">💾 Sauvegarde...</span>}
            
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={toggleBold}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-bold rounded transition-colors"
                title="Gras (Ctrl+B)"
              >
                B
              </button>
              <button
                onClick={toggleItalic}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm italic rounded transition-colors"
                title="Italique (Ctrl+I)"
              >
                I
              </button>
              <button
                onClick={toggleUnderline}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm underline rounded transition-colors"
                title="Souligné (Ctrl+U)"
              >
                U
              </button>
              
              <div className="flex items-center gap-1 text-zinc-400 text-sm">
                <button
                  onClick={() => setFontSize(f => Math.max(12, f - 2))}
                  className="w-7 h-7 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
                >
                  −
                </button>
                <span className="w-8 text-center text-zinc-300">{fontSize}</span>
                <button
                  onClick={() => setFontSize(f => Math.min(32, f + 2))}
                  className="w-7 h-7 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
                >
                  +
                </button>
              </div>
              
              <span className="text-zinc-500 text-xs ml-2">{htmlToPlainText(text).length} car.</span>
            </div>
          </div>

          {/* Editor */}
          {selectedChapter ? (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="flex-1 min-h-0 p-6 bg-zinc-900 text-zinc-100 focus:outline-none overflow-y-auto leading-relaxed"
              style={{ fontSize: `${fontSize}px` }}
              onInput={() => {
                if (editorRef.current) {
                  setText(editorRef.current.innerHTML);
                }
              }}
              data-placeholder="Commencez à écrire..."
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-500">
              <div className="text-center">
                <p className="text-lg mb-2">Sélectionnez un chapitre</p>
                <p className="text-sm">ou créez un nouvel ouvrage dans la barre latérale</p>
              </div>
            </div>
          )}

          {/* Bottom Bar */}
          <div className="flex-shrink-0 px-4 py-3 bg-zinc-800 border-t border-zinc-700 flex items-center gap-3">
            <select
              className="px-3 py-2 rounded-md bg-zinc-700 text-zinc-200 text-sm border border-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedReviewer}
              onChange={(e) => setSelectedReviewer(e.target.value)}
            >
              {reviewers.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleReview}
              disabled={loading || !text}
            >
              {loading ? '⏳ Analyse en cours...' : '📝 Obtenir une critique'}
            </button>
          </div>
        </div>

        {/* Right - Critique / Profil */}
        <div className="w-1/2 flex flex-col bg-black">
          {/* Tabs */}
          <div className="flex-shrink-0 flex border-b border-zinc-800 bg-zinc-900">
            <button
              onClick={() => setRightTab('critique')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                rightTab === 'critique'
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              💬 Critique
              {pastCritiques.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-zinc-700 text-zinc-400 rounded-full">{pastCritiques.length}</span>
              )}
            </button>
            <button
              onClick={() => setRightTab('contexte')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                rightTab === 'contexte'
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              📋 Contexte
            </button>
            <button
              onClick={() => setRightTab('profil')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                rightTab === 'profil'
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              🎭 Profil
            </button>
          </div>

          {/* Tab Content */}
          {rightTab === 'critique' ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {error && (
                <div className="flex-shrink-0 p-4 bg-red-900/30 border-b border-red-800 text-red-400">
                  {error}
                </div>
              )}

              {/* Progression indicator */}
              {pastCritiques.length > 0 && !loading && (
                <div className="flex-shrink-0 px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-zinc-400 text-xs">
                    📊 {pastCritiques.length} critique{pastCritiques.length > 1 ? 's' : ''}
                  </span>
                  {textAtLastCritique !== null && text !== textAtLastCritique ? (
                    <span className="text-green-400 text-xs">✏️ Texte modifié — progression évaluée</span>
                  ) : textAtLastCritique !== null ? (
                    <span className="text-zinc-500 text-xs">📌 Texte non modifié</span>
                  ) : null}
                </div>
              )}

              {/* Main critique area */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* Current critique or streaming */}
                {(critique || loading) && !viewingCritiqueId && (
                  <div className="critique-content">
                    {critique.split('\n').map((line, i) => renderCritiqueLine(line, i))}
                    {loading && <span className="animate-pulse text-amber-400 text-lg">▊</span>}
                  </div>
                )}

                {/* Viewing a past critique */}
                {viewingCritiqueId && (() => {
                  const pc = pastCritiques.find(c => c.id === viewingCritiqueId);
                  if (!pc) return null;
                  const idx = pastCritiques.indexOf(pc);
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <button
                          onClick={() => { setViewingCritiqueId(null); setViewingSummary(false); }}
                          className="text-amber-400 hover:text-amber-300 text-sm flex items-center gap-1 transition-colors"
                        >
                          ← Retour
                        </button>
                        <span className="text-zinc-500 text-xs">
                          Critique #{idx + 1} — {pc.reviewer} — {new Date(pc.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={() => setViewingSummary(false)}
                          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                            !viewingSummary
                              ? 'bg-amber-600 text-white'
                              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          📄 Critique complète
                        </button>
                        <button
                          onClick={() => setViewingSummary(true)}
                          disabled={!pc.summary}
                          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                            viewingSummary
                              ? 'bg-amber-600 text-white'
                              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed'
                          }`}
                        >
                          📋 Résumé
                        </button>
                      </div>
                      {viewingSummary && pc.summary ? (
                        <div className="critique-content p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
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
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-3">
                    <span className="text-4xl opacity-40">📝</span>
                    <p className="text-sm">Sélectionnez un critique et lancez l&apos;analyse</p>
                  </div>
                )}

                {/* No current critique but has history */}
                {!critique && !loading && !viewingCritiqueId && pastCritiques.length > 0 && !error && (
                  <div className="text-center text-zinc-500 py-8">
                    <p className="text-sm mb-2">Pas de critique en cours</p>
                    <p className="text-xs">Consultez l&apos;historique ci-dessous ou lancez une nouvelle analyse</p>
                  </div>
                )}
              </div>

              {/* Past critiques list (always visible at bottom if any) */}
              {pastCritiques.length > 0 && !loading && (
                <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900/80 max-h-[40%] overflow-y-auto">
                  <div className="px-4 py-2 sticky top-0 bg-zinc-900 border-b border-zinc-800/50 z-10">
                    <span className="text-zinc-400 text-xs font-medium">📜 Historique</span>
                  </div>
                  {[...pastCritiques].reverse().map((pc, idx) => {
                    const critiqueNum = pastCritiques.length - idx;
                    const isViewing = viewingCritiqueId === pc.id;
                    return (
                      <div
                        key={pc.id}
                        className={`w-full text-left px-4 py-3 border-b border-zinc-800/30 transition-colors ${
                          isViewing ? 'bg-amber-900/20 border-l-2 border-l-amber-500' : 'hover:bg-zinc-800/50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <button
                            onClick={() => { setViewingCritiqueId(isViewing ? null : pc.id); setViewingSummary(false); }}
                            className="flex-1 text-left"
                          >
                            <span className={`text-sm font-medium ${isViewing ? 'text-amber-400' : 'text-zinc-300'}`}>
                              #{critiqueNum} — {pc.reviewer}
                            </span>
                          </button>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-zinc-600 text-xs">
                              {new Date(pc.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Supprimer cette critique ?')) {
                                  deleteCritique(pc.id).then(() => {
                                    setPastCritiques(prev => prev.filter(c => c.id !== pc.id));
                                    if (viewingCritiqueId === pc.id) setViewingCritiqueId(null);
                                  });
                                }
                              }}
                              className="text-zinc-600 hover:text-red-400 transition-colors px-1"
                              title="Supprimer cette critique"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={() => { setViewingCritiqueId(isViewing ? null : pc.id); setViewingSummary(false); }}
                            className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
                          >
                            {isViewing ? '▲ Masquer la critique' : '▶ Voir la critique'}
                          </button>
                          {pc.summary && (
                            <>
                              <span className="text-zinc-700">·</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedSummaries(prev => {
                                    const next = new Set(prev);
                                    if (next.has(pc.id)) next.delete(pc.id);
                                    else next.add(pc.id);
                                    return next;
                                  });
                                }}
                                className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
                              >
                                {expandedSummaries.has(pc.id) ? '▲ Masquer le résumé' : '📋 Résumé'}
                              </button>
                            </>
                          )}
                        </div>
                        {expandedSummaries.has(pc.id) && pc.summary && (
                          <div className="mt-2 p-3 bg-zinc-800/60 border border-zinc-700/50 rounded-lg critique-content">
                            {pc.summary.split('\n').map((line, i) => renderCritiqueLine(line, i))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : rightTab === 'contexte' ? (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto gap-6">
              {/* Book Summary */}
              <div>
                <h3 className="text-amber-400 font-semibold text-base mb-1">📖 Résumé de l&apos;ouvrage</h3>
                <p className="text-zinc-500 text-sm mb-3">
                  De quoi parle votre livre ? Thème, genre, ambiance, intrigue principale…
                </p>
                <textarea
                  className="w-full min-h-[100px] p-3 bg-zinc-900 text-zinc-200 placeholder-zinc-600 rounded-lg border border-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none leading-relaxed text-sm disabled:opacity-40"
                  placeholder="Ex: Un thriller psychologique se déroulant dans un village isolé des Pyrénées. Le protagoniste, un ancien flic, enquête sur la disparition de sa fille…"
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
                {!selectedBook && <p className="text-zinc-600 text-xs mt-1">Sélectionnez un ouvrage pour écrire son résumé</p>}
              </div>

              {/* Chapter Summary */}
              <div>
                <h3 className="text-amber-400 font-semibold text-base mb-1">📄 Résumé du chapitre</h3>
                <p className="text-zinc-500 text-sm mb-3">
                  Que voulez-vous accomplir dans ce chapitre ? Scènes clés, objectifs narratifs…
                </p>
                <textarea
                  className="w-full min-h-[100px] p-3 bg-zinc-900 text-zinc-200 placeholder-zinc-600 rounded-lg border border-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none leading-relaxed text-sm disabled:opacity-40"
                  placeholder="Ex: Introduction du personnage principal. On découvre sa routine, ses obsessions. Première scène de tension avec le voisin mystérieux…"
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
                {!selectedChapter && <p className="text-zinc-600 text-xs mt-1">Sélectionnez un chapitre pour écrire son résumé</p>}
              </div>

              {/* Context status */}
              <div className="mt-auto p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                <p className="text-zinc-400 text-xs font-medium mb-2">🎯 Contexte envoyé au critique :</p>
                <div className="space-y-1">
                  <p className="text-xs flex items-center gap-2">
                    <span className={writerProfile ? 'text-green-400' : 'text-zinc-600'}>{writerProfile ? '✓' : '✗'}</span>
                    <span className={writerProfile ? 'text-zinc-300' : 'text-zinc-600'}>Profil écrivain</span>
                  </p>
                  <p className="text-xs flex items-center gap-2">
                    <span className={bookSummary ? 'text-green-400' : 'text-zinc-600'}>{bookSummary ? '✓' : '✗'}</span>
                    <span className={bookSummary ? 'text-zinc-300' : 'text-zinc-600'}>Résumé ouvrage</span>
                  </p>
                  <p className="text-xs flex items-center gap-2">
                    <span className={chapterSummary ? 'text-green-400' : 'text-zinc-600'}>{chapterSummary ? '✓' : '✗'}</span>
                    <span className={chapterSummary ? 'text-zinc-300' : 'text-zinc-600'}>Résumé chapitre</span>
                  </p>
                  <p className="text-xs flex items-center gap-2">
                    <span className={pastCritiques.length > 0 && textAtLastCritique !== null && text !== textAtLastCritique ? 'text-green-400' : 'text-zinc-600'}>
                      {pastCritiques.length > 0 && textAtLastCritique !== null && text !== textAtLastCritique ? '✓' : '✗'}
                    </span>
                    <span className={pastCritiques.length > 0 ? 'text-zinc-300' : 'text-zinc-600'}>
                      Historique critiques ({pastCritiques.length})
                      {pastCritiques.length > 0 && textAtLastCritique !== null && text === textAtLastCritique && ' — texte non modifié'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto">
              <div className="mb-4">
                <h3 className="text-amber-400 font-semibold text-base mb-1">🎭 Votre profil d&apos;écrivain</h3>
                <p className="text-zinc-500 text-sm mb-4">
                  Décrivez-vous : genre littéraire, niveau d&apos;expérience, objectifs, points forts, faiblesses connues… Le critique adaptera ses conseils en conséquence.
                </p>
              </div>
              <textarea
                className="flex-1 min-h-[200px] p-4 bg-zinc-900 text-zinc-200 placeholder-zinc-600 rounded-lg border border-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none leading-relaxed text-sm"
                placeholder={"Ex: Je suis un auteur débutant en fantasy. J'écris un roman de dark fantasy inspiré par Joe Abercrombie et Robin Hobb. Mes points forts sont les dialogues, mes faiblesses les descriptions et le worldbuilding. Je souhaite progresser sur le rythme et la tension narrative."}
                value={writerProfile}
                onChange={(e) => {
                  setWriterProfile(e.target.value);
                  saveWriterProfile(e.target.value);
                }}
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-zinc-600 text-xs">{writerProfile.length} caractères</span>
                {writerProfile && (
                  <span className="text-green-500 text-xs">✓ Profil actif — sera pris en compte lors des critiques</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}