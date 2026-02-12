import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  content: string;
  summary: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Book {
  id: string;
  title: string;
  description: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CritiqueEntry {
  id: string;
  chapterId: string;
  reviewer: string;
  critique: string;
  summary: string;
  textSnapshot: string;
  createdAt: Date;
}

export interface WorldBuildingEntry {
  id: string;
  bookId: string;
  category: string;
  title: string;
  content: string;
  aiFeedback: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WBFeedbackEntry {
  id: string;
  wbEntryId: string;
  reviewer: string;
  feedback: string;
  createdAt: Date;
}

export const WB_CATEGORIES = [
  { id: 'monde', label: 'Monde', icon: '🌍' },
  { id: 'personnages', label: 'Personnages', icon: '👤' },
  { id: 'lieux', label: 'Lieux', icon: '📍' },
  { id: 'nature', label: 'Nature', icon: '🌿' },
  { id: 'animaux', label: 'Animaux', icon: '🐾' },
  { id: 'politique', label: 'Politique', icon: '🏛️' },
  { id: 'magie', label: 'Magie', icon: '✨' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'histoire', label: 'Histoire', icon: '📜' },
  { id: 'cultures', label: 'Cultures', icon: '🎭' },
  { id: 'religions', label: 'Religions', icon: '🕯️' },
  { id: 'objets', label: 'Objets', icon: '🗡️' },
  { id: 'langues', label: 'Langues', icon: '💬' },
  { id: 'autre', label: 'Autre', icon: '📝' },
] as const;

interface WriterDB extends DBSchema {
  books: {
    key: string;
    value: Book;
    indexes: { 'by-title': string };
  };
  chapters: {
    key: string;
    value: Chapter;
    indexes: { 'by-book': string; 'by-order': [string, number] };
  };
  settings: {
    key: string;
    value: { key: string; value: string };
  };
  critiques: {
    key: string;
    value: CritiqueEntry;
    indexes: { 'by-chapter': string };
  };
  worldBuilding: {
    key: string;
    value: WorldBuildingEntry;
    indexes: { 'by-book': string; 'by-category': [string, string] };
  };
  wbFeedbacks: {
    key: string;
    value: WBFeedbackEntry;
    indexes: { 'by-entry': string };
  };
}

let dbInstance: IDBPDatabase<WriterDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<WriterDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<WriterDB>('writer-db', 5, {
    upgrade(db, oldVersion) {
      console.log(`[DB] Upgrading from v${oldVersion} to v5`);
      if (oldVersion < 1) {
        // Books store
        const bookStore = db.createObjectStore('books', { keyPath: 'id' });
        bookStore.createIndex('by-title', 'title');

        // Chapters store
        const chapterStore = db.createObjectStore('chapters', { keyPath: 'id' });
        chapterStore.createIndex('by-book', 'bookId');
        chapterStore.createIndex('by-order', ['bookId', 'order']);
      }
      if (oldVersion < 2) {
        // Settings store (for writer profile, etc.)
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (oldVersion < 3) {
        // Critiques store
        const critiqueStore = db.createObjectStore('critiques', { keyPath: 'id' });
        critiqueStore.createIndex('by-chapter', 'chapterId');
      }
      if (oldVersion < 4) {
        // World Building store
        const wbStore = db.createObjectStore('worldBuilding', { keyPath: 'id' });
        wbStore.createIndex('by-book', 'bookId');
        wbStore.createIndex('by-category', ['bookId', 'category']);
      }
      if (oldVersion < 5) {
        // WB Feedbacks store
        const wbfStore = db.createObjectStore('wbFeedbacks', { keyPath: 'id' });
        wbfStore.createIndex('by-entry', 'wbEntryId');
      }
    },
    blocked() {
      console.warn('[DB] Upgrade blocked — close other tabs using this app and refresh.');
      alert('La base de données doit être mise à jour. Fermez les autres onglets de l\'application puis rechargez cette page.');
      dbInstance = null;
    },
    blocking() {
      // This tab is blocking another tab from upgrading
      console.warn('[DB] This tab is blocking a DB upgrade — closing connection.');
      dbInstance?.close();
      dbInstance = null;
    },
    terminated() {
      console.warn('[DB] Connection terminated unexpectedly.');
      dbInstance = null;
    },
  });

  console.log('[DB] Opened successfully at v5');

  return dbInstance;
}

// Books
export async function createBook(title: string, description: string = ''): Promise<Book> {
  const db = await getDB();
  const book: Book = {
    id: crypto.randomUUID(),
    title,
    description,
    summary: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.put('books', book);
  return book;
}

export async function getBooks(): Promise<Book[]> {
  const db = await getDB();
  return db.getAll('books');
}

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

export async function updateBook(id: string, updates: Partial<Pick<Book, 'title' | 'description' | 'summary'>>): Promise<void> {
  const db = await getDB();
  const book = await db.get('books', id);
  if (book) {
    await db.put('books', { ...book, ...updates, updatedAt: new Date() });
  }
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDB();
  // Delete all chapters of this book
  const chapters = await getChaptersByBook(id);
  for (const chapter of chapters) {
    await db.delete('chapters', chapter.id);
  }
  // Delete all world building entries of this book
  await deleteWorldBuildingByBook(id);
  await db.delete('books', id);
}

// Chapters
export async function createChapter(bookId: string, title: string, content: string = ''): Promise<Chapter> {
  const db = await getDB();
  const chapters = await getChaptersByBook(bookId);
  const maxOrder = chapters.length > 0 ? Math.max(...chapters.map(c => c.order)) : -1;
  
  const chapter: Chapter = {
    id: crypto.randomUUID(),
    bookId,
    title,
    content,
    summary: '',
    order: maxOrder + 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.put('chapters', chapter);
  return chapter;
}

export async function getChaptersByBook(bookId: string): Promise<Chapter[]> {
  const db = await getDB();
  const chapters = await db.getAllFromIndex('chapters', 'by-book', bookId);
  return chapters.sort((a, b) => a.order - b.order);
}

export async function getChapter(id: string): Promise<Chapter | undefined> {
  const db = await getDB();
  return db.get('chapters', id);
}

export async function updateChapter(id: string, updates: Partial<Pick<Chapter, 'title' | 'content' | 'summary' | 'order'>>): Promise<void> {
  const db = await getDB();
  const chapter = await db.get('chapters', id);
  if (chapter) {
    await db.put('chapters', { ...chapter, ...updates, updatedAt: new Date() });
  }
}

export async function deleteChapter(id: string): Promise<void> {
  const db = await getDB();
  await deleteCritiquesByChapter(id);
  await db.delete('chapters', id);
}

export async function saveChapterContent(id: string, content: string): Promise<void> {
  await updateChapter(id, { content });
}

// Settings
export async function getWriterProfile(): Promise<string> {
  const db = await getDB();
  const entry = await db.get('settings', 'writerProfile');
  return entry?.value ?? '';
}

export async function saveWriterProfile(profile: string): Promise<void> {
  const db = await getDB();
  await db.put('settings', { key: 'writerProfile', value: profile });
}

// Critiques
export async function saveCritique(chapterId: string, reviewer: string, critique: string, textSnapshot: string): Promise<CritiqueEntry> {
  const db = await getDB();
  const entry: CritiqueEntry = {
    id: crypto.randomUUID(),
    chapterId,
    reviewer,
    critique,
    summary: '',
    textSnapshot,
    createdAt: new Date(),
  };
  await db.put('critiques', entry);
  return entry;
}

export async function updateCritiqueSummary(id: string, summary: string): Promise<void> {
  const db = await getDB();
  const entry = await db.get('critiques', id);
  if (entry) {
    await db.put('critiques', { ...entry, summary });
  }
}

export async function getCritiquesByChapter(chapterId: string): Promise<CritiqueEntry[]> {
  const db = await getDB();
  const critiques = await db.getAllFromIndex('critiques', 'by-chapter', chapterId);
  return critiques.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function deleteCritique(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('critiques', id);
}

export async function deleteCritiquesByChapter(chapterId: string): Promise<void> {
  const db = await getDB();
  const critiques = await db.getAllFromIndex('critiques', 'by-chapter', chapterId);
  for (const c of critiques) {
    await db.delete('critiques', c.id);
  }
}

// World Building
export async function createWorldBuildingEntry(
  bookId: string,
  category: string,
  title: string,
  content: string = ''
): Promise<WorldBuildingEntry> {
  const db = await getDB();
  const existing = await getWorldBuildingByBook(bookId);
  const sameCat = existing.filter(e => e.category === category);
  const maxOrder = sameCat.length > 0 ? Math.max(...sameCat.map(e => e.order)) : -1;

  const entry: WorldBuildingEntry = {
    id: crypto.randomUUID(),
    bookId,
    category,
    title,
    content,
    aiFeedback: '',
    order: maxOrder + 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.put('worldBuilding', entry);
  return entry;
}

export async function getWorldBuildingByBook(bookId: string): Promise<WorldBuildingEntry[]> {
  const db = await getDB();
  const entries = await db.getAllFromIndex('worldBuilding', 'by-book', bookId);
  return entries.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.order - b.order;
  });
}

export async function updateWorldBuildingEntry(
  id: string,
  updates: Partial<Pick<WorldBuildingEntry, 'title' | 'content' | 'aiFeedback' | 'order'>>
): Promise<void> {
  const db = await getDB();
  const entry = await db.get('worldBuilding', id);
  if (entry) {
    await db.put('worldBuilding', { ...entry, ...updates, updatedAt: new Date() });
  }
}

export async function deleteWorldBuildingEntry(id: string): Promise<void> {
  const db = await getDB();
  await deleteWBFeedbacksByEntry(id);
  await db.delete('worldBuilding', id);
}

export async function deleteWorldBuildingByBook(bookId: string): Promise<void> {
  const db = await getDB();
  const entries = await db.getAllFromIndex('worldBuilding', 'by-book', bookId);
  for (const e of entries) {
    await deleteWBFeedbacksByEntry(e.id);
    await db.delete('worldBuilding', e.id);
  }
}

// WB Feedbacks
export async function saveWBFeedback(wbEntryId: string, reviewer: string, feedback: string): Promise<WBFeedbackEntry> {
  const db = await getDB();
  const entry: WBFeedbackEntry = {
    id: crypto.randomUUID(),
    wbEntryId,
    reviewer,
    feedback,
    createdAt: new Date(),
  };
  await db.put('wbFeedbacks', entry);
  return entry;
}

export async function getWBFeedbacksByEntry(wbEntryId: string): Promise<WBFeedbackEntry[]> {
  const db = await getDB();
  const feedbacks = await db.getAllFromIndex('wbFeedbacks', 'by-entry', wbEntryId);
  return feedbacks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function deleteWBFeedback(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('wbFeedbacks', id);
}

export async function deleteWBFeedbacksByEntry(wbEntryId: string): Promise<void> {
  const db = await getDB();
  const feedbacks = await db.getAllFromIndex('wbFeedbacks', 'by-entry', wbEntryId);
  for (const f of feedbacks) {
    await db.delete('wbFeedbacks', f.id);
  }
}

// ==========================================
// EXPORT / IMPORT
// ==========================================

export interface WriterExport {
  version: number;
  exportedAt: string;
  books: Book[];
  chapters: Chapter[];
  critiques: CritiqueEntry[];
  worldBuilding: WorldBuildingEntry[];
  wbFeedbacks: WBFeedbackEntry[];
  settings: { key: string; value: string }[];
}

export async function exportDatabase(): Promise<WriterExport> {
  const db = await getDB();
  const [books, chapters, critiques, worldBuilding, wbFeedbacks, settings] = await Promise.all([
    db.getAll('books'),
    db.getAll('chapters'),
    db.getAll('critiques'),
    db.getAll('worldBuilding'),
    db.getAll('wbFeedbacks'),
    db.getAll('settings'),
  ]);
  return {
    version: 5,
    exportedAt: new Date().toISOString(),
    books,
    chapters,
    critiques,
    worldBuilding,
    wbFeedbacks,
    settings,
  };
}

export function downloadExport(data: WriterExport): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `writer-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importDatabase(data: WriterExport): Promise<{ books: number; chapters: number; critiques: number }> {
  if (!data.version || !data.books || !data.chapters) {
    throw new Error('Fichier de sauvegarde invalide.');
  }

  const db = await getDB();

  // Clear existing data
  const tx = db.transaction(['books', 'chapters', 'critiques', 'worldBuilding', 'wbFeedbacks', 'settings'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').clear(),
    tx.objectStore('chapters').clear(),
    tx.objectStore('critiques').clear(),
    tx.objectStore('worldBuilding').clear(),
    tx.objectStore('wbFeedbacks').clear(),
    tx.objectStore('settings').clear(),
  ]);
  await tx.done;

  // Import all records
  const txImport = db.transaction(['books', 'chapters', 'critiques', 'worldBuilding', 'wbFeedbacks', 'settings'], 'readwrite');
  for (const book of data.books) {
    await txImport.objectStore('books').put(book);
  }
  for (const chapter of data.chapters) {
    await txImport.objectStore('chapters').put(chapter);
  }
  for (const critique of (data.critiques || [])) {
    await txImport.objectStore('critiques').put(critique);
  }
  for (const wb of (data.worldBuilding || [])) {
    await txImport.objectStore('worldBuilding').put(wb);
  }
  for (const wbf of (data.wbFeedbacks || [])) {
    await txImport.objectStore('wbFeedbacks').put(wbf);
  }
  for (const setting of (data.settings || [])) {
    await txImport.objectStore('settings').put(setting);
  }
  await txImport.done;

  return {
    books: data.books.length,
    chapters: data.chapters.length,
    critiques: (data.critiques || []).length,
  };
}
