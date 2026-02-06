'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Book, Chapter,
  getBooks, createBook, deleteBook,
  getChaptersByBook, createChapter, deleteChapter, saveChapterContent
} from './lib/db';

type Reviewer = { id: string; name: string };

export default function Home() {
  // Data
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  
  // Editor
  const [text, setText] = useState('');
  const [selectedReviewer, setSelectedReviewer] = useState<string>("stephen_king");
  const [critique, setCritique] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // UI
  const [showSidebar, setShowSidebar] = useState(true);
  const [newBookName, setNewBookName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [rightTab, setRightTab] = useState<'critique' | 'profil'>('critique');
  const [writerProfile, setWriterProfile] = useState('');

  // Load books on mount
  useEffect(() => {
    loadBooks();
    loadReviewers();
    const savedProfile = localStorage.getItem('writerProfile');
    if (savedProfile) setWriterProfile(savedProfile);
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

  // Load chapters when book selected
  useEffect(() => {
    if (selectedBook) {
      loadChapters(selectedBook.id);
    } else {
      setChapters([]);
      setSelectedChapter(null);
    }
  }, [selectedBook]);

  // Load chapter content when selected
  useEffect(() => {
    if (selectedChapter) {
      setText(selectedChapter.content);
    } else {
      setText('');
    }
    setCritique('');
  }, [selectedChapter]);

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
    if (!text) return;

    setLoading(true);
    setError(null);
    setCritique('');

    try {
      const response = await fetch('http://localhost:8000/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reviewer: selectedReviewer, writer_profile: writerProfile || null }),
      });

      if (!response.ok) throw new Error(`Erreur ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("Pas de stream disponible");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setCritique(prev => prev + chunk);
      }
    } catch (e: any) {
      setError(e.message || "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  };

  const toggleBold = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = text.substring(start, end);
    
    if (selectedText) {
      const before = text.substring(0, start);
      const after = text.substring(end);
      const newText = `${before}**${selectedText}**${after}`;
      setText(newText);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + 2, end + 2);
      }, 0);
    }
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
        className="absolute top-1/2 -translate-y-1/2 z-10 w-6 h-12 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 rounded-r flex items-center justify-center"
        style={{ left: showSidebar ? '256px' : '0' }}
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
                title="Gras (sélectionnez du texte)"
              >
                B
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
              
              <span className="text-zinc-500 text-xs ml-2">{text.length} car.</span>
            </div>
          </div>

          {/* Textarea */}
          {selectedChapter ? (
            <textarea
              ref={textareaRef}
              className="flex-1 min-h-0 p-6 bg-zinc-900 text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none leading-relaxed"
              style={{ fontSize: `${fontSize}px` }}
              placeholder="Commencez à écrire..."
              value={text}
              onChange={(e) => setText(e.target.value)}
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
            </button>
            <button
              onClick={() => setRightTab('profil')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                rightTab === 'profil'
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              🎭 Profil écrivain
            </button>
          </div>

          {/* Tab Content */}
          {rightTab === 'critique' ? (
            <div className="flex-1 p-6 overflow-y-auto">
              {error && (
                <div className="p-4 bg-red-900/30 border border-red-800 rounded-md text-red-400 mb-4">
                  {error}
                </div>
              )}

              {!critique && !loading && !error && (
                <div className="h-full flex items-center justify-center text-zinc-600">
                  <p>La critique apparaîtra ici</p>
                </div>
              )}

              {(critique || loading) && (
                <div className="text-gray-300 leading-relaxed text-base font-light">
                  {critique.split('\n').map((line, i) => {
                    const trimmed = line.trim();
                    
                    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
                      return <hr key={i} className="border-zinc-700 my-4" />;
                    }
                    
                    const prevLine = critique.split('\n')[i - 1]?.trim();
                    const isAfterSeparator = !prevLine || prevLine === '---' || prevLine === '***' || prevLine === '___' || prevLine === '';
                    const looksLikeTitle = trimmed.length > 0 && trimmed.length < 120 && !trimmed.endsWith('.') && !trimmed.startsWith('-') && !trimmed.startsWith('*') && !trimmed.match(/^\d+\./);
                    const isTitle = isAfterSeparator && looksLikeTitle && i > 0;
                    const isFirstLine = i === 0 && trimmed.length > 0;
                    
                    if (isFirstLine || isTitle) {
                      const cleanTitle = trimmed.replace(/^\*\*(.+)\*\*$/, '$1');
                      return (
                        <div key={i} className="mt-5 mb-2 first:mt-0">
                          <span className="font-bold text-amber-400 text-lg">{cleanTitle}</span>
                        </div>
                      );
                    }
                    
                    return (
                      <div key={i} className={trimmed === '' ? 'h-3' : ''}>
                        {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                          part.startsWith('**') && part.endsWith('**')
                            ? <strong key={j} className="font-semibold text-gray-100">{part.slice(2, -2)}</strong>
                            : <span key={j}>{part}</span>
                        )}
                      </div>
                    );
                  })}
                  {loading && <span className="animate-pulse text-blue-400">▊</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-6 overflow-y-auto">
              <div className="mb-4">
                <h3 className="text-amber-400 font-semibold text-base mb-1">🎭 Votre profil d'écrivain</h3>
                <p className="text-zinc-500 text-sm mb-4">
                  Décrivez-vous : genre littéraire, niveau d'expérience, objectifs, points forts, faiblesses connues… Le critique adaptera ses conseils en conséquence.
                </p>
              </div>
              <textarea
                className="flex-1 min-h-[200px] p-4 bg-zinc-900 text-zinc-200 placeholder-zinc-600 rounded-lg border border-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none leading-relaxed text-sm"
                placeholder={"Ex: Je suis un auteur débutant en fantasy. J'écris un roman de dark fantasy inspiré par Joe Abercrombie et Robin Hobb. Mes points forts sont les dialogues, mes faiblesses les descriptions et le worldbuilding. Je souhaite progresser sur le rythme et la tension narrative."}
                value={writerProfile}
                onChange={(e) => {
                  setWriterProfile(e.target.value);
                  localStorage.setItem('writerProfile', e.target.value);
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