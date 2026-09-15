'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontSize } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { useEffect, useRef, useState, useCallback } from 'react';

type SelectionAssistAction = 'synonyms' | 'rephrase' | 'improve';

interface RichEditorProps {
  content: string;
  onUpdate: (html: string) => void;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  style?: React.CSSProperties;
  editorRef?: React.MutableRefObject<ReturnType<typeof useEditor> | null>;
  onSelectionAssist?: (text: string, action: SelectionAssistAction) => Promise<string[]>;
}

export default function RichEditor({ content, onUpdate, placeholder, className, wrapperClassName, style, editorRef, onSelectionAssist }: RichEditorProps) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const isSettingContent = useRef(false);
  const selectionAssistRef = useRef(onSelectionAssist);
  const [selectionMenu, setSelectionMenu] = useState<{ text: string; from: number; to: number; top: number; left: number } | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAssistAction | null>(null);
  const [selectionSuggestions, setSelectionSuggestions] = useState<string[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  selectionAssistRef.current = onSelectionAssist;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        hardBreak: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      Highlight.configure({ multicolor: true }),
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
    onSelectionUpdate: ({ editor: ed }) => {
      if (!selectionAssistRef.current) return;
      const { from, to } = ed.state.selection;
      if (from === to) {
        setSelectionMenu(null);
        return;
      }
      const text = ed.state.doc.textBetween(from, to, ' ').trim();
      if (!text) {
        setSelectionMenu(null);
        return;
      }
      const coords = ed.view.coordsAtPos(from);
      setSelectionError(null);
      setSelectionSuggestions([]);
      setSelectionAction(null);
      setSelectionMenu({ text, from, to, top: Math.max(8, coords.bottom + 8), left: Math.max(8, coords.left) });
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

  const requestSelectionAssist = async (action: SelectionAssistAction) => {
    if (!selectionMenu || !selectionAssistRef.current) return;
    setSelectionAction(action);
    setSelectionError(null);
    try {
      const suggestions = await selectionAssistRef.current(selectionMenu.text, action);
      setSelectionSuggestions(suggestions);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Impossible de proposer une reformulation.');
    } finally {
      setSelectionAction(null);
    }
  };

  const replaceSelection = (suggestion: string) => {
    if (!selectionMenu || !editor) return;
    editor.chain().focus().setTextSelection({ from: selectionMenu.from, to: selectionMenu.to }).insertContent(suggestion).run();
    setSelectionMenu(null);
    setSelectionSuggestions([]);
  };

  return (
    <div className={wrapperClassName || ''}>
      <EditorContent editor={editor} />
      {selectionMenu && (
        <div
          className="fixed z-50 w-72 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 shadow-2xl"
          style={{ top: selectionMenu.top, left: selectionMenu.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="mb-2 truncate text-xs text-[var(--text-muted)]" title={selectionMenu.text}>
            « {selectionMenu.text} »
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['synonyms', 'Synonymes'],
              ['rephrase', 'Reformuler'],
              ['improve', 'Améliorer'],
            ] as [SelectionAssistAction, string][]).map(([action, label]) => (
              <button
                key={action}
                type="button"
                onClick={() => requestSelectionAssist(action)}
                disabled={selectionAction !== null}
                className="rounded-md border border-[var(--border-medium)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-wait disabled:opacity-50"
              >
                {selectionAction === action ? '⏳' : label}
              </button>
            ))}
          </div>
          {selectionError && <p className="mt-2 text-xs text-red-300">{selectionError}</p>}
          {selectionSuggestions.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
              {selectionSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion}-${index}`}
                  type="button"
                  onClick={() => replaceSelection(suggestion)}
                  className="block w-full rounded-md border border-transparent bg-[var(--bg-surface)] px-2.5 py-2 text-left text-sm leading-snug text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
  const changeFontSize = useCallback((delta: number) => {
    if (!editor) return;
    const current = editor.getAttributes('textStyle')?.fontSize;
    const currentNum = current ? parseInt(current) : 18;
    const newSize = Math.min(72, Math.max(8, currentNum + delta));
    editor.chain().focus().setFontSize(`${newSize}px`).run();
  }, [editor]);

  if (!editor) return null;

  const currentFontSize = editor.getAttributes('textStyle')?.fontSize;
  const sizeNum = currentFontSize ? parseInt(currentFontSize) : 18;

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
