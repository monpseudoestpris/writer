import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  content: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Book {
  id: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
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
}

let dbInstance: IDBPDatabase<WriterDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<WriterDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<WriterDB>('writer-db', 1, {
    upgrade(db) {
      // Books store
      const bookStore = db.createObjectStore('books', { keyPath: 'id' });
      bookStore.createIndex('by-title', 'title');

      // Chapters store
      const chapterStore = db.createObjectStore('chapters', { keyPath: 'id' });
      chapterStore.createIndex('by-book', 'bookId');
      chapterStore.createIndex('by-order', ['bookId', 'order']);
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

export async function updateBook(id: string, updates: Partial<Pick<Book, 'title' | 'description'>>): Promise<void> {
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

export async function updateChapter(id: string, updates: Partial<Pick<Chapter, 'title' | 'content' | 'order'>>): Promise<void> {
  const db = await getDB();
  const chapter = await db.get('chapters', id);
  if (chapter) {
    await db.put('chapters', { ...chapter, ...updates, updatedAt: new Date() });
  }
}

export async function deleteChapter(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('chapters', id);
}

export async function saveChapterContent(id: string, content: string): Promise<void> {
  await updateChapter(id, { content });
}
