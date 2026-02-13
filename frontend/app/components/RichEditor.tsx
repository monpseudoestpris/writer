'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontSize } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef, useCallback } from 'react';

interface RichEditorProps {
  content: string;
  onUpdate: (html: string) => void;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  style?: React.CSSProperties;
  editorRef?: React.MutableRefObject<ReturnType<typeof useEditor> | null>;
}

export default function RichEditor({ content, onUpdate, placeholder, className, wrapperClassName, style, editorRef }: RichEditorProps) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const isSettingContent = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        hardBreak: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      Placeholder.configure({
        placeholder: placeholder || 'Commencez à écrire…',
      }),
    ],
    content: content || '',
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      if (!isSettingContent.current) {
        onUpdateRef.current(ed.getHTML());
      }
    },
    editorProps: {
      attributes: {
        class: className || '',
        style: style ? Object.entries(style).map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`).join(';') : '',
      },
    },
  });

  // Expose editor via ref
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  // Update content when prop changes (e.g. switching chapters)
  useEffect(() => {
    if (editor && content !== undefined) {
      const currentContent = editor.getHTML();
      // Only update if content actually differs (avoid infinite loops)
      if (currentContent !== content && !(content === '' && currentContent === '<p></p>')) {
        isSettingContent.current = true;
        editor.commands.setContent(content || '', { emitUpdate: false });
        isSettingContent.current = false;
      }
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className={wrapperClassName || ''}>
      <EditorContent editor={editor} />
    </div>
  );
}

// Toolbar component to control the editor
interface EditorToolbarProps {
  editor: ReturnType<typeof useEditor>;
  wordCount: string;
  onGenerateSummary?: () => void;
  isGeneratingSummary?: boolean;
  hasSummary?: boolean;
  onShowSummary?: () => void;
}

export function EditorToolbar({ editor, wordCount, onGenerateSummary, isGeneratingSummary, hasSummary, onShowSummary }: EditorToolbarProps) {
  if (!editor) return null;

  const currentFontSize = editor.getAttributes('textStyle')?.fontSize;
  const sizeNum = currentFontSize ? parseInt(currentFontSize) : 18;

  const changeFontSize = useCallback((delta: number) => {
    const current = editor.getAttributes('textStyle')?.fontSize;
    const currentNum = current ? parseInt(current) : 18;
    const newSize = Math.min(72, Math.max(8, currentNum + delta));
    editor.chain().focus().setFontSize(`${newSize}px`).run();
  }, [editor]);

  const getCurrentStyle = () => {
    if (editor.isActive('heading', { level: 1 })) return 'h1';
    if (editor.isActive('heading', { level: 2 })) return 'h2';
    if (editor.isActive('heading', { level: 3 })) return 'h3';
    if (editor.isActive('blockquote')) return 'blockquote';
    return 'paragraph';
  };

  const setStyle = (style: string) => {
    const chain = editor.chain().focus();
    switch (style) {
      case 'h1': chain.setHeading({ level: 1 }).run(); break;
      case 'h2': chain.setHeading({ level: 2 }).run(); break;
      case 'h3': chain.setHeading({ level: 3 }).run(); break;
      case 'blockquote': chain.toggleBlockquote().run(); break;
      default: chain.setParagraph().run(); break;
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={getCurrentStyle()}
        onChange={(e) => setStyle(e.target.value)}
        className="h-9 px-2 rounded-md bg-[var(--bg-surface)] text-[var(--accent)] text-xs font-medium border border-[var(--border-subtle)] hover:border-[var(--accent)]/40 transition-colors cursor-pointer"
        title="Style de paragraphe"
      >
        <option value="paragraph">Normal</option>
        <option value="h1">Titre 1</option>
        <option value="h2">Titre 2</option>
        <option value="h3">Titre 3</option>
        <option value="blockquote">Citation</option>
      </select>

      <div className="w-px h-6 bg-[var(--border-subtle)]" />

      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`w-9 h-9 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-base font-bold transition-colors border ${editor.isActive('bold') ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border-subtle)]'}`}
        title="Gras (Ctrl+B)"
      >
        B
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`w-9 h-9 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-base italic transition-colors border ${editor.isActive('italic') ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border-subtle)]'}`}
        title="Italique (Ctrl+I)"
      >
        I
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`w-9 h-9 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-base underline transition-colors border ${editor.isActive('underline') ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border-subtle)]'}`}
        title="Souligné (Ctrl+U)"
      >
        U
      </button>

      <div className="w-px h-6 bg-[var(--border-subtle)] mx-1" />

      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`w-9 h-9 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-sm transition-colors border ${editor.isActive('bulletList') ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border-subtle)]'}`}
        title="Liste à puces"
      >
        •≡
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`w-9 h-9 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-sm transition-colors border ${editor.isActive('orderedList') ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border-subtle)]'}`}
        title="Liste numérotée"
      >
        1.
      </button>

      <div className="w-px h-6 bg-[var(--border-subtle)] mx-1" />

      <div className="flex items-center gap-1">
        <button
          onClick={() => changeFontSize(-2)}
          className="w-8 h-8 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-base font-medium transition-colors border border-[var(--border-subtle)]"
          title="Réduire la taille (sélection)"
        >
          −
        </button>
        <span className="w-10 text-center text-[var(--text-muted)] text-xs font-medium tabular-nums">{sizeNum}px</span>
        <button
          onClick={() => changeFontSize(2)}
          className="w-8 h-8 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-base font-medium transition-colors border border-[var(--border-subtle)]"
          title="Augmenter la taille (sélection)"
        >
          +
        </button>
      </div>

      {onGenerateSummary && (
        <>
          <div className="w-px h-6 bg-[var(--border-subtle)] mx-1" />
          <button
            onClick={onGenerateSummary}
            disabled={isGeneratingSummary}
            className={`h-8 px-2.5 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-medium transition-colors border border-[var(--border-subtle)] flex items-center gap-1.5 ${isGeneratingSummary ? 'opacity-50 cursor-wait' : ''}`}
            title="Générer un résumé automatique du texte"
          >
            {isGeneratingSummary ? '⏳' : '📋'} Résumé
          </button>
          {hasSummary && onShowSummary && (
            <button
              onClick={onShowSummary}
              className="h-8 px-2 rounded-md bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-medium transition-colors border border-[var(--accent)]/30"
              title="Afficher / masquer le résumé"
            >
              👁️
            </button>
          )}
        </>
      )}

      <span className="text-[var(--text-muted)] text-xs ml-2 tabular-nums">{wordCount}</span>
    </div>
  );
}
