'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import Link from 'next/link';
import {
  ClassroomExercise,
  getClassroomExercises,
  createClassroomExercise,
  updateClassroomExercise,
  deleteClassroomExercise,
} from '../lib/db';
import RichEditor, { EditorToolbar } from '../components/RichEditor';
import type { Editor } from '@tiptap/react';

const API_URL = 'http://localhost:8000';

type Student = { id: string; name: string; age: number; background: string };

// Extract plain text from HTML (for sending to API)
const htmlToPlainText = (html: string): string => {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '');
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
};

// Very small inline markdown renderer: **bold**, *italic*
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-[var(--text-primary)]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i} className="italic text-[var(--accent)]/80">{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

// Lightweight markdown block renderer, enough for exercises / peer comments / teacher critique
function renderMarkdown(text: string): ReactNode[] {
  if (!text) return [];
  const lines = text.split('\n');
  return lines.map((rawLine, i) => {
    const line = rawLine.trim();
    if (line === '') return <div key={i} className="h-2" />;
    if (/^[-*_]{3,}$/.test(line)) return <hr key={i} className="border-[var(--border-subtle)] my-4" />;

    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      if (level <= 2) {
        return (
          <h2 key={i} className="text-lg font-semibold text-[var(--text-primary)] mb-3 mt-4 first:mt-0 pb-2 border-b border-[var(--border-subtle)]">
            {renderInline(heading[2])}
          </h2>
        );
      }
      return (
        <h3 key={i} className="text-[15px] font-semibold text-[var(--accent)] mt-4 mb-2">
          {renderInline(heading[2])}
        </h3>
      );
    }

    if (line.startsWith('> ')) {
      return (
        <blockquote key={i} className="border-l-2 border-[var(--accent)]/30 pl-4 py-1.5 my-2 bg-[var(--accent-soft)] rounded-r-lg text-[var(--text-secondary)] italic text-sm">
          {renderInline(line.slice(2))}
        </blockquote>
      );
    }

    if (line.startsWith('- ') || line.startsWith('• ')) {
      return (
        <div key={i} className="flex gap-2 my-1 ml-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          <span className="text-[var(--accent)] mt-0.5 flex-shrink-0">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }

    // A speaker line like "**Kevin** : ..." gets a bit more emphasis
    const speaker = line.match(/^\*\*([^*]+)\*\*\s*:\s*(.*)/);
    if (speaker) {
      return (
        <p key={i} className="text-sm leading-relaxed my-2">
          <span className="font-semibold text-[var(--accent)]">{speaker[1]}</span>
          <span className="text-[var(--text-secondary)]"> : {renderInline(speaker[2])}</span>
        </p>
      );
    }

    return (
      <p key={i} className="text-[var(--text-secondary)] text-sm leading-relaxed my-1.5">
        {renderInline(rawLine)}
      </p>
    );
  });
}

function extractTitle(markdown: string): string {
  const match = markdown.match(/^##\s+(.+)/m);
  return match ? match[1].trim() : 'Exercice';
}

export default function ApprendsPage() {
  const [exercises, setExercises] = useState<ClassroomExercise[]>([]);
  const [selected, setSelected] = useState<ClassroomExercise | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [teacherName, setTeacherName] = useState('Le Professeur');

  const [content, setContent] = useState('');
  const editorRef = useRef<Editor | null>(null);

  const [isGeneratingExercise, setIsGeneratingExercise] = useState(false);
  const [isLoadingPeers, setIsLoadingPeers] = useState(false);
  const [isLoadingTeacher, setIsLoadingTeacher] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const list = await getClassroomExercises();
      setExercises(list);
      if (list.length > 0) selectExercise(list[0]);
    })();

    fetch(`${API_URL}/classroom/students`)
      .then(res => res.json())
      .then(data => {
        setStudents(data.students || []);
        if (data.teacher?.name) setTeacherName(data.teacher.name);
      })
      .catch(() => {});
  }, []);

  const selectExercise = (ex: ClassroomExercise) => {
    setSelected(ex);
    setContent(ex.content || '');
    setError(null);
  };

  // The teacher's progress record: synthesis of +/- from every exercise finished so far
  const getPastSyntheses = (excludeId?: string) =>
    exercises
      .filter(e => e.synthesis && e.id !== excludeId)
      .map(e => ({ title: e.title, synthesis: e.synthesis }));

  const handleNewExercise = async () => {
    setIsGeneratingExercise(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/classroom/exercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previous_exercise_titles: exercises.map(e => e.title),
          past_syntheses: getPastSyntheses(),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const title = extractTitle(data.exercise);
      const created = await createClassroomExercise(title, data.exercise);
      setExercises(prev => [created, ...prev]);
      selectExercise(created);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Impossible de générer un exercice.");
    } finally {
      setIsGeneratingExercise(false);
    }
  };

  const handleDeleteExercise = async (id: string) => {
    await deleteClassroomExercise(id);
    setExercises(prev => prev.filter(e => e.id !== id));
    if (selected?.id === id) {
      const remaining = exercises.filter(e => e.id !== id);
      if (remaining.length > 0) selectExercise(remaining[0]);
      else { setSelected(null); setContent(''); }
    }
  };

  const persistContent = async (html: string) => {
    setContent(html);
    if (selected) {
      await updateClassroomExercise(selected.id, { content: html });
      setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, content: html } : e));
    }
  };

  const streamInto = async (
    url: string,
    body: object,
    onChunk: (fullText: string) => void
  ): Promise<string> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Erreur ${response.status}`);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) throw new Error('Pas de flux disponible');
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      onChunk(full);
    }
    return full;
  };

  const handlePeerReview = async () => {
    if (!selected) return;
    const plainText = htmlToPlainText(content);
    if (!plainText.trim()) return;

    setIsLoadingPeers(true);
    setError(null);
    try {
      const full = await streamInto(
        `${API_URL}/classroom/peer-review`,
        { text: plainText, exercise_prompt: selected.promptMarkdown, num_students: 5 },
        (text) => setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, peerComments: text } : e))
      );
      await updateClassroomExercise(selected.id, { peerComments: full, status: 'reviewed' });
      setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, peerComments: full, status: 'reviewed' } : e));
      setSelected(prev => prev ? { ...prev, peerComments: full, status: 'reviewed' } : prev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Les camarades n'ont pas pu commenter.");
    } finally {
      setIsLoadingPeers(false);
    }
  };

  const askTeacher = async (onDemand: boolean) => {
    if (!selected) return;
    const plainText = htmlToPlainText(content);
    if (!plainText.trim()) return;

    setIsLoadingTeacher(true);
    setError(null);
    try {
      const full = await streamInto(
        `${API_URL}/classroom/teacher-critique`,
        {
          text: plainText,
          exercise_prompt: selected.promptMarkdown,
          peer_comments: selected.peerComments || null,
          on_demand: onDemand,
          past_syntheses: getPastSyntheses(selected.id),
        },
        (text) => setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, teacherCritique: text } : e))
      );
      const status = onDemand ? selected.status : 'completed';
      let synthesis = selected.synthesis;
      if (!onDemand) {
        try {
          const synthRes = await fetch(`${API_URL}/classroom/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exercise_prompt: selected.promptMarkdown, critique: full }),
          });
          const synthData = await synthRes.json();
          if (synthData.synthesis) synthesis = synthData.synthesis;
        } catch {
          // La synthèse est un bonus : on n'interrompt pas le flux si elle échoue.
        }
      }
      await updateClassroomExercise(selected.id, { teacherCritique: full, status, synthesis });
      setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, teacherCritique: full, status, synthesis } : e));
      setSelected(prev => prev ? { ...prev, teacherCritique: full, status, synthesis } : prev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Le professeur n'a pas pu répondre.");
    } finally {
      setIsLoadingTeacher(false);
    }
  };

  const wordCount = htmlToPlainText(content).trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <div className="w-[17rem] flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h1 className="text-[var(--accent)] font-semibold text-sm tracking-widest uppercase">🎓 J&apos;apprends</h1>
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--accent)] text-xs transition-colors" title="Retour à l'accueil">
            ← Accueil
          </Link>
        </div>

        <div className="px-4 pt-4 pb-3">
          <button
            onClick={handleNewExercise}
            disabled={isGeneratingExercise}
            className={`w-full px-3 py-2 rounded-lg bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-sm font-medium transition-all ${isGeneratingExercise ? 'opacity-50 cursor-wait' : ''}`}
          >
            {isGeneratingExercise ? '⏳ Le prof réfléchit…' : '+ Nouvel exercice'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          {exercises.map(ex => (
            <div
              key={ex.id}
              onClick={() => selectExercise(ex)}
              className={`group px-3 py-2.5 rounded-lg cursor-pointer transition-all flex items-start justify-between gap-2 ${selected?.id === ex.id ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30' : 'hover:bg-[var(--bg-surface)] border border-transparent'}`}
            >
              <div className="min-w-0">
                <div className="text-sm text-[var(--text-primary)] truncate">{ex.title}</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  {ex.status === 'completed' ? '✅ Terminé' : ex.status === 'reviewed' ? '🧑‍🎓 Commenté' : '📝 Brouillon'}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteExercise(ex.id); }}
                className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-400 text-xs transition-all flex-shrink-0"
                title="Supprimer"
              >
                ✕
              </button>
            </div>
          ))}
          {exercises.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] px-3 py-4 text-center">
              Aucun exercice pour l&apos;instant. Cliquez sur « Nouvel exercice » pour commencer.
            </p>
          )}
        </div>

        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <button
            onClick={() => setShowRecord(s => !s)}
            className="w-full flex items-center justify-between text-[var(--text-muted)] hover:text-[var(--accent)] text-xs font-semibold tracking-widest uppercase transition-colors"
          >
            <span>📘 Carnet de suivi ({exercises.filter(e => e.synthesis).length})</span>
            <span>{showRecord ? '▲' : '▼'}</span>
          </button>
          {showRecord && (
            <div className="mt-2 space-y-3 max-h-56 overflow-y-auto pr-1">
              {exercises.filter(e => e.synthesis).length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  Aucun bilan pour l&apos;instant. Il apparaîtra ici à la fin de chaque exercice terminé.
                </p>
              )}
              {exercises.filter(e => e.synthesis).map(e => (
                <div key={e.id} className="text-xs">
                  <div className="text-[var(--text-primary)] font-medium mb-1 truncate">{e.title}</div>
                  <div className="text-[11px] leading-snug">{renderMarkdown(e.synthesis)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {students.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] px-4 py-3">
            <h2 className="text-[var(--text-muted)] text-xs font-semibold tracking-widest uppercase mb-2">
              La classe ({students.length} élèves)
            </h2>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
              {students.map(s => (
                <div
                  key={s.id}
                  title={s.background}
                  className="flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-lg bg-[var(--bg-surface)] cursor-default"
                >
                  <span className="w-5 h-5 flex-shrink-0 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-semibold flex items-center justify-center">
                    {s.name.charAt(0)}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] truncate">{s.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <p className="text-4xl mb-4">🎓</p>
              <p className="text-[var(--text-secondary)]">
                Bienvenue dans l&apos;atelier de {teacherName}. Créez un nouvel exercice pour commencer.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Writing column */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-[var(--border-subtle)]">
              <div className="px-6 py-4 border-b border-[var(--border-subtle)] overflow-y-auto max-h-64">
                {renderMarkdown(selected.promptMarkdown)}
              </div>

              <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                {editorRef.current && (
                  <EditorToolbar editor={editorRef.current} wordCount={`${wordCount} mots`} />
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                <RichEditor
                  content={content}
                  onUpdate={persistContent}
                  editorRef={editorRef}
                  placeholder="Écrivez votre réponse à l'exercice…"
                  wrapperClassName="editor-area min-h-full"
                  className="px-8 py-6 focus:outline-none min-h-full"
                />
              </div>

              <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex flex-wrap gap-2">
                <button
                  onClick={handlePeerReview}
                  disabled={isLoadingPeers || !htmlToPlainText(content).trim()}
                  className={`px-4 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--accent)]/10 text-[var(--text-primary)] text-sm font-medium border border-[var(--border-subtle)] transition-all ${isLoadingPeers ? 'opacity-50 cursor-wait' : ''}`}
                >
                  {isLoadingPeers ? '⏳ Les élèves lisent…' : '🧑‍🎓 Avis des camarades'}
                </button>
                <button
                  onClick={() => askTeacher(true)}
                  disabled={isLoadingTeacher || !htmlToPlainText(content).trim()}
                  className={`px-4 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--accent)]/10 text-[var(--text-primary)] text-sm font-medium border border-[var(--border-subtle)] transition-all ${isLoadingTeacher ? 'opacity-50 cursor-wait' : ''}`}
                >
                  🧑‍🏫 Demander de l&apos;aide au prof
                </button>
                <button
                  onClick={() => askTeacher(false)}
                  disabled={isLoadingTeacher || !htmlToPlainText(content).trim()}
                  className={`px-4 py-2 rounded-lg bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] text-sm font-medium border border-[var(--accent)]/30 transition-all ${isLoadingTeacher ? 'opacity-50 cursor-wait' : ''}`}
                >
                  {isLoadingTeacher ? '⏳ Correction en cours…' : '✅ Terminer (avis du prof)'}
                </button>
              </div>
              {error && (
                <div className="px-6 pb-4 text-sm text-red-400">{error}</div>
              )}
            </div>

            {/* Feedback column */}
            <div className="w-[26rem] flex-shrink-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
                {selected.peerComments && (
                  <div>
                    <h2 className="text-[var(--text-muted)] text-xs font-semibold tracking-widest uppercase mb-2">
                      Avis des camarades
                    </h2>
                    <div className="critique-content">{renderMarkdown(selected.peerComments)}</div>
                  </div>
                )}
                {selected.teacherCritique && (
                  <div>
                    <h2 className="text-[var(--accent)] text-xs font-semibold tracking-widest uppercase mb-2">
                      Avis de {teacherName}
                    </h2>
                    <div className="critique-content">{renderMarkdown(selected.teacherCritique)}</div>
                  </div>
                )}
                {selected.synthesis && (
                  <div>
                    <h2 className="text-[var(--accent)] text-xs font-semibold tracking-widest uppercase mb-2">
                      📘 Ajouté au carnet de suivi
                    </h2>
                    <div className="critique-content rounded-lg border border-[var(--accent)]/20 bg-[var(--accent-soft)] p-3">
                      {renderMarkdown(selected.synthesis)}
                    </div>
                  </div>
                )}
                {!selected.peerComments && !selected.teacherCritique && (
                  <p className="text-sm text-[var(--text-muted)] text-center mt-10">
                    Écrivez votre texte puis demandez l&apos;avis de vos camarades ou du professeur.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
