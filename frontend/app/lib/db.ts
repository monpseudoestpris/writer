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
}

let dbInstance: IDBPDatabase<WriterDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<WriterDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<WriterDB>('writer-db', 3, {
    upgrade(db, oldVersion) {
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
    },
  });

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
