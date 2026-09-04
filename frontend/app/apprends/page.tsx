'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import Link from 'next/link';
import {
  ClassroomExercise,
  getClassroomExercises,
  createClassroomExercise,
  updateClassroomExercise,
  appendClassroomComment,
  deleteClassroomExercise,
  getLastClassroomExerciseId,
  saveLastClassroomExerciseId,
  ClassroomExperienceLevel,
  getClassroomExperienceLevel,
  saveClassroomExperienceLevel,
} from '../lib/db';
import RichEditor, { EditorToolbar } from '../components/RichEditor';
import type { Editor } from '@tiptap/react';

const API_URL = 'http://localhost:8000';

type Student = { id: string; name: string; age: number; background: string };

const EXPERIENCE_LEVELS: { value: ClassroomExperienceLevel; label: string }[] = [
  { value: 'grand_debutant', label: 'Grand débutant' },
  { value: 'debutant', label: 'Débutant' },
  { value: 'intermediaire', label: 'Intermédiaire' },
  { value: 'avance', label: 'Avancé' },
  { value: 'ecrivain_publie', label: 'Écrivain publié' },
];

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

function extractField(markdown: string, label: string): string | null {
  const match = markdown.match(new RegExp(`\\*\\*${label}\\s*:\\*\\*\\s*(.+)`, 'i'));
  return match ? match[1].trim() : null;
}

function getExerciseBody(markdown: string): string {
  return markdown
    .split('\n')
    .filter(line => !/^(##\s+|\*\*(Type|Genre|Objectif pédagogique)\s*:\*\*)/i.test(line.trim()))
    .join('\n')
    .replace(/^\s*\n/, '');
}

export default function ApprendsPage() {
  const [exercises, setExercises] = useState<ClassroomExercise[]>([]);
  const [selected, setSelected] = useState<ClassroomExercise | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [teacherName, setTeacherName] = useState('Le Professeur');
  const [experienceLevel, setExperienceLevel] = useState<ClassroomExperienceLevel>('grand_debutant');

  const [content, setContent] = useState('');
  const editorRef = useRef<Editor | null>(null);

  const [isGeneratingExercise, setIsGeneratingExercise] = useState(false);
  const [isLoadingPeers, setIsLoadingPeers] = useState(false);
  const [isLoadingTeacher, setIsLoadingTeacher] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [showClass, setShowClass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exerciseProposals, setExerciseProposals] = useState<string[]>([]);
  const [openLessonIndex, setOpenLessonIndex] = useState<number | null>(null);
  const [lessonTexts, setLessonTexts] = useState<Record<number, string>>({});
  const [loadingLessonIndex, setLoadingLessonIndex] = useState<number | null>(null);
  const [showLesson, setShowLesson] = useState(false);
  const [isLoadingSelectedLesson, setIsLoadingSelectedLesson] = useState(false);
  const [exerciseAuthors, setExerciseAuthors] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingAuthorJudgment, setIsLoadingAuthorJudgment] = useState(false);
  const [feedbackTab, setFeedbackTab] = useState<'latest' | 'history'>('latest');
  const [expandedCommentVersions, setExpandedCommentVersions] = useState<Set<string>>(new Set());
  const [editorWidth, setEditorWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(272);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [list, savedExperienceLevel] = await Promise.all([
        getClassroomExercises(),
        getClassroomExperienceLevel(),
      ]);
      setExercises(list);
      setExperienceLevel(savedExperienceLevel);
      if (list.length > 0) {
        // Resume the exercise the student was last working on, not just the newest one
        const lastId = await getLastClassroomExerciseId();
        const toResume = (lastId && list.find(e => e.id === lastId)) || list[0];
        selectExercise(toResume);
      }
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
    setShowLesson(false);
    setFeedbackTab('latest');
    setExpandedCommentVersions(new Set());
    saveLastClassroomExerciseId(ex.id).catch(() => {});
  };

  // The teacher's progress record: synthesis of +/- from every exercise finished so far
  const getPastSyntheses = (excludeId?: string) =>
    exercises
      .filter(e => e.synthesis && e.id !== excludeId)
      .map(e => ({ title: e.title, synthesis: e.synthesis }));

  const handleNewExercise = async () => {
    setIsGeneratingExercise(true);
    setError(null);
    setExerciseProposals([]);
    setExerciseAuthors([]);
    setOpenLessonIndex(null);
    setLessonTexts({});
    try {
      const res = await fetch(`${API_URL}/classroom/exercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previous_exercise_titles: exercises.map(e => e.title),
          past_syntheses: getPastSyntheses(),
          experience_level: experienceLevel,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setExerciseProposals(data.exercises || []);
      setExerciseAuthors(data.authors || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Impossible de générer des exercices.");
    } finally {
      setIsGeneratingExercise(false);
    }
  };

  const chooseExerciseProposal = async (markdown: string, author?: { id: string; name: string }) => {
    const title = extractTitle(markdown);
    const created = await createClassroomExercise(title, markdown, author?.id || '', author?.name || '');
    setExercises(prev => [created, ...prev]);
    selectExercise(created);
    setExerciseProposals([]);
  };

  const fetchLesson = async (index: number, proposal: string) => {
    if (lessonTexts[index]) {
      setOpenLessonIndex(prev => prev === index ? null : index);
      return;
    }
    setOpenLessonIndex(index);
    setLoadingLessonIndex(index);
    try {
      await streamInto(
        `${API_URL}/classroom/lesson`,
        { exercise_prompt: proposal, experience_level: experienceLevel },
        (text) => setLessonTexts(prev => ({ ...prev, [index]: text }))
      );
    } catch (e: unknown) {
      setLessonTexts(prev => ({ ...prev, [index]: e instanceof Error ? `⚠️ ${e.message}` : '⚠️ Impossible de générer le cours.' }));
    } finally {
      setLoadingLessonIndex(null);
    }
  };

  const fetchSelectedLesson = async () => {
    if (!selected) return;
    if (selected.lesson) {
      setShowLesson(s => !s);
      return;
    }
    setShowLesson(true);
    setIsLoadingSelectedLesson(true);
    try {
      const full = await streamInto(
        `${API_URL}/classroom/lesson`,
        { exercise_prompt: selected.promptMarkdown, experience_level: experienceLevel },
        (text) => setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, lesson: text } : e))
      );
      await updateClassroomExercise(selected.id, { lesson: full });
      setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, lesson: full } : e));
      setSelected(prev => prev ? { ...prev, lesson: full } : prev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Impossible de générer le cours.");
      setShowLesson(false);
    } finally {
      setIsLoadingSelectedLesson(false);
    }
  };

  const fetchAuthorJudgment = async () => {
    if (!selected || !selected.authorId) return;
    setIsLoadingAuthorJudgment(true);
    setError(null);
    try {
      const plainText = htmlToPlainText(content);
      const full = await streamInto(
        `${API_URL}/classroom/author-judgment`,
        {
          text: plainText,
          exercise_prompt: selected.promptMarkdown,
          author_id: selected.authorId,
          peer_comments: selected.peerComments || null,
          teacher_critique: selected.teacherCritique || null,
          experience_level: experienceLevel,
        },
        (text) => setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, authorJudgment: text } : e))
      );
      await updateClassroomExercise(selected.id, { authorJudgment: full });
      const historyEntry = await appendClassroomComment(selected.id, { source: 'author', content: full, textSnapshot: plainText });
      if (historyEntry) {
        setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, commentHistory: [...e.commentHistory, historyEntry] } : e));
        setSelected(prev => prev ? { ...prev, commentHistory: [...prev.commentHistory, historyEntry] } : prev);
      }
      setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, authorJudgment: full } : e));
      setSelected(prev => prev ? { ...prev, authorJudgment: full } : prev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "L'auteur n'a pas pu juger le texte.");
    } finally {
      setIsLoadingAuthorJudgment(false);
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
        { text: plainText, exercise_prompt: selected.promptMarkdown, num_students: 5, experience_level: experienceLevel },
        (text) => setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, peerComments: text } : e))
      );
      await updateClassroomExercise(selected.id, { peerComments: full, peerReviewTextSnapshot: plainText, status: 'reviewed' });
      const historyEntry = await appendClassroomComment(selected.id, { source: 'peers', content: full, textSnapshot: plainText });
      if (historyEntry) {
        setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, commentHistory: [...e.commentHistory, historyEntry] } : e));
        setSelected(prev => prev ? { ...prev, commentHistory: [...prev.commentHistory, historyEntry] } : prev);
      }
      setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, peerComments: full, peerReviewTextSnapshot: plainText, status: 'reviewed' } : e));
      setSelected(prev => prev ? { ...prev, peerComments: full, peerReviewTextSnapshot: plainText, status: 'reviewed' } : prev);
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
      // The peer comments may refer to an earlier draft if the student kept editing since then
      const textChangedSincePeerReview = !!selected.peerReviewTextSnapshot && plainText !== selected.peerReviewTextSnapshot;
      const full = await streamInto(
        `${API_URL}/classroom/teacher-critique`,
        {
          text: plainText,
          exercise_prompt: selected.promptMarkdown,
          peer_comments: selected.peerComments || null,
          on_demand: onDemand,
          past_syntheses: getPastSyntheses(selected.id),
          text_changed_since_peer_review: textChangedSincePeerReview,
          experience_level: experienceLevel,
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
            body: JSON.stringify({ exercise_prompt: selected.promptMarkdown, critique: full, experience_level: experienceLevel }),
          });
          const synthData = await synthRes.json();
          if (synthData.synthesis) synthesis = synthData.synthesis;
        } catch {
          // La synthèse est un bonus : on n'interrompt pas le flux si elle échoue.
        }
      }
      await updateClassroomExercise(selected.id, { teacherCritique: full, status, synthesis });
      const historyEntry = await appendClassroomComment(selected.id, { source: 'teacher', content: full, textSnapshot: plainText });
      if (historyEntry) {
        setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, commentHistory: [...e.commentHistory, historyEntry] } : e));
        setSelected(prev => prev ? { ...prev, commentHistory: [...prev.commentHistory, historyEntry] } : prev);
      }
      setExercises(prev => prev.map(e => e.id === selected.id ? { ...e, teacherCritique: full, status, synthesis } : e));
      setSelected(prev => prev ? { ...prev, teacherCritique: full, status, synthesis } : prev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Le professeur n'a pas pu répondre.");
    } finally {
      setIsLoadingTeacher(false);
    }
  };

  const wordCount = htmlToPlainText(content).trim().split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (event: MouseEvent) => {
      if (!mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      const percentage = ((event.clientX - rect.left) / rect.width) * 100;
      setEditorWidth(Math.min(85, Math.max(15, percentage)));
    };
    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('resizing-h');
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('resizing-h');
    };
  }, [isDragging]);

  useEffect(() => {
    if (!isSidebarDragging) return;
    const handleMouseMove = (event: MouseEvent) => {
      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      setSidebarWidth(Math.min(420, Math.max(220, event.clientX - rect.left)));
    };
    const handleMouseUp = () => setIsSidebarDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('resizing-h');
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('resizing-h');
    };
  }, [isSidebarDragging]);

  return (
    <div ref={layoutRef} className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <div className="flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col overflow-hidden" style={{ width: `${sidebarWidth}px` }}>
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h1 className="font-display gradient-text font-bold text-base tracking-tight">🎓 J&apos;apprends</h1>
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--accent-3)] text-xs transition-colors" title="Retour à l'accueil">
            ← Accueil
          </Link>
        </div>

        <div className="px-4 pt-4 pb-3">
          <label className="block mb-3">
            <span className="block text-xs font-semibold tracking-widest uppercase text-[var(--text-muted)] mb-1.5">
              Votre niveau
            </span>
            <select
              value={experienceLevel}
              onChange={(e) => {
                const level = e.target.value as ClassroomExperienceLevel;
                setExperienceLevel(level);
                saveClassroomExperienceLevel(level).catch(() => {});
              }}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            >
              {EXPERIENCE_LEVELS.map(level => (
                <option key={level.value} value={level.value}>{level.label}</option>
              ))}
            </select>
          </label>
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
                <div className="text-sm text-[var(--text-primary)] leading-snug break-words" title={ex.title}>{ex.title}</div>
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

        {selected?.authorName && (
          <div className="border-t border-[var(--border-subtle)] px-4 py-3">
            <h2 className="text-[var(--text-muted)] text-xs font-semibold tracking-widest uppercase mb-2">
              Auteur invité
            </h2>
            <div className="flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-lg bg-[var(--bg-surface)] w-fit">
              <span className="w-5 h-5 flex-shrink-0 rounded-full bg-[var(--accent-3)]/15 text-[var(--accent-3)] text-[10px] font-semibold flex items-center justify-center">
                🖋️
              </span>
              <span className="text-xs text-[var(--text-secondary)]">{selected.authorName}</span>
            </div>
          </div>
        )}

        {students.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] px-4 py-3">
            <button
              onClick={() => setShowClass(open => !open)}
              className="w-full flex items-center justify-between text-[var(--text-muted)] hover:text-[var(--accent)] text-xs font-semibold tracking-widest uppercase transition-colors"
              aria-expanded={showClass}
            >
              <span>La classe ({students.length} élèves)</span>
              <span aria-hidden>{showClass ? '▲' : '▼'}</span>
            </button>
            {showClass && (
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1 mt-2">
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
            )}
          </div>
        )}
      </div>

      {isSidebarDragging && (
        <div className="fixed inset-0 z-50" style={{ cursor: 'col-resize' }} />
      )}

      <div
        className="flex-shrink-0"
        style={{
          width: '6px',
          height: '100%',
          cursor: 'col-resize',
          backgroundColor: isSidebarDragging ? 'var(--accent)' : 'var(--border-medium)',
          position: 'relative',
          zIndex: 10,
          transition: 'background-color 0.15s',
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsSidebarDragging(true);
        }}
        onMouseEnter={(event) => {
          if (!isSidebarDragging) event.currentTarget.style.backgroundColor = 'var(--accent)';
        }}
        onMouseLeave={(event) => {
          if (!isSidebarDragging) event.currentTarget.style.backgroundColor = 'var(--border-medium)';
        }}
        aria-label="Redimensionner la colonne de navigation"
      />

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
          <>
          <div className="flex-shrink-0 min-h-16 px-6 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-medium)] flex items-center gap-2" role="tablist" aria-label="Atelier">
            <button
              onClick={() => setShowLesson(false)}
              className={`min-w-28 px-5 py-2.5 rounded-md text-base font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                !showLesson
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[#172027] shadow-sm'
                  : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]'
              }`}
              aria-selected={!showLesson}
              role="tab"
            >
              Exos
            </button>
            <button
              onClick={() => { if (!showLesson || !selected.lesson) fetchSelectedLesson(); }}
              disabled={isLoadingSelectedLesson}
              className={`min-w-28 px-5 py-2.5 rounded-md text-base font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-3)] disabled:opacity-50 ${
                showLesson
                  ? 'border-[var(--accent-3)] bg-[var(--accent-3)] text-[#172027] shadow-sm'
                  : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent-3)] hover:bg-[var(--accent-3)]/15'
              }`}
              aria-selected={showLesson}
              role="tab"
            >
              {isLoadingSelectedLesson ? 'Cours...' : 'Cours'}
            </button>
          </div>
          <div ref={mainContentRef} className="flex-1 flex overflow-hidden">
            {/* Writing column */}
            <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: `${editorWidth}%` }}>
              <div className="px-6 py-4 border-b border-[var(--border-subtle)] overflow-y-auto max-h-64">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-xl font-semibold text-[var(--text-primary)] leading-snug">
                      {extractTitle(selected.promptMarkdown)}
                    </h1>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {extractField(selected.promptMarkdown, 'Type') && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-semibold uppercase tracking-wide">
                          {extractField(selected.promptMarkdown, 'Type')}
                        </span>
                      )}
                      {extractField(selected.promptMarkdown, 'Genre') && (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--accent-3)]/15 text-[var(--accent-3)] text-[10px] font-semibold uppercase tracking-wide">
                          {extractField(selected.promptMarkdown, 'Genre')}
                        </span>
                      )}
                    </div>
                    {extractField(selected.promptMarkdown, 'Objectif pédagogique') && (
                      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                        {extractField(selected.promptMarkdown, 'Objectif pédagogique')}
                      </p>
                    )}
                    {!showLesson && (
                      <div className="mt-4">{renderMarkdown(getExerciseBody(selected.promptMarkdown))}</div>
                    )}
                  </div>
                </div>
                {showLesson && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]" role="tabpanel">
                    {isLoadingSelectedLesson && !selected.lesson ? (
                      <p className="text-xs text-[var(--text-muted)] loading-cursor">Le prof prépare le cours…</p>
                    ) : (
                      renderMarkdown(selected.lesson || '')
                    )}
                  </div>
                )}
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
                  className={`px-4 py-2.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--accent)]/15 text-[var(--text-primary)] text-sm font-semibold border border-[var(--border-medium)] hover:border-[var(--accent)]/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed ${isLoadingPeers ? 'cursor-wait' : ''}`}
                >
                  {isLoadingPeers ? '⏳ Les élèves lisent…' : '🧑‍🎓 Avis des camarades'}
                </button>
                <button
                  onClick={() => askTeacher(true)}
                  disabled={isLoadingTeacher || !htmlToPlainText(content).trim()}
                  className={`px-4 py-2.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--accent-3)]/15 text-[var(--text-primary)] text-sm font-semibold border border-[var(--border-medium)] hover:border-[var(--accent-3)]/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-3)] disabled:opacity-50 disabled:cursor-not-allowed ${isLoadingTeacher ? 'cursor-wait' : ''}`}
                >
                  🧑‍🏫 Demander de l&apos;aide au prof
                </button>
                <button
                  onClick={() => askTeacher(false)}
                  disabled={isLoadingTeacher || !htmlToPlainText(content).trim()}
                  className={`px-4 py-2.5 rounded-lg bg-[var(--accent)] text-[#181326] text-sm font-bold border border-[var(--accent)] hover:bg-[#d0c4ff] transition-all shadow-[0_4px_16px_rgba(185,167,255,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed ${isLoadingTeacher ? 'cursor-wait' : ''}`}
                >
                  {isLoadingTeacher ? '⏳ Correction en cours…' : '✅ Terminer (avis du prof)'}
                </button>
                {selected.authorId && (
                  <button
                    onClick={fetchAuthorJudgment}
                    disabled={isLoadingAuthorJudgment || !htmlToPlainText(content).trim()}
                    title={`${selected.authorName} juge votre texte, avec sa vraie personnalité et son style`}
                    className={`px-4 py-2 rounded-lg bg-[var(--accent-3)]/10 hover:bg-[var(--accent-3)]/20 text-[var(--accent-3)] text-sm font-medium border border-[var(--accent-3)]/30 transition-all ${isLoadingAuthorJudgment ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {isLoadingAuthorJudgment ? '⏳ …' : `🖋️ Avis de ${selected.authorName}`}
                  </button>
                )}
              </div>
              {error && (
                <div className="px-6 pb-4 text-sm text-red-400">{error}</div>
              )}
            </div>

            {isDragging && (
              <div className="fixed inset-0 z-50" style={{ cursor: 'col-resize' }} />
            )}

            <div
              className="flex-shrink-0"
              style={{
                width: '12px',
                height: '100%',
                cursor: 'col-resize',
                backgroundColor: isDragging ? 'var(--accent)' : 'var(--border-medium)',
                position: 'relative',
                zIndex: 10,
                transition: 'background-color 0.15s',
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setIsDragging(true);
              }}
              onMouseEnter={(event) => {
                if (!isDragging) event.currentTarget.style.backgroundColor = 'var(--accent)';
              }}
              onMouseLeave={(event) => {
                if (!isDragging) event.currentTarget.style.backgroundColor = 'var(--border-medium)';
              }}
              aria-label="Redimensionner les zones d'écriture et de retours"
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: '4px',
                  height: '48px',
                  transform: 'translate(-50%, -50%)',
                  borderLeft: '2px dotted var(--text-muted)',
                  borderRight: '2px dotted var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
            </div>

            {/* Feedback column */}
            <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: `${100 - editorWidth}%` }}>
              <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--border-medium)] bg-[var(--bg-secondary)]" role="tablist" aria-label="Retours">
                <button
                  onClick={() => setFeedbackTab('latest')}
                  className={`min-w-28 px-5 py-2.5 rounded-md text-base font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${feedbackTab === 'latest' ? 'border-[var(--accent)] bg-[var(--accent)] text-[#172027] shadow-sm' : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]'}`}
                  role="tab"
                  aria-selected={feedbackTab === 'latest'}
                >
                  Derniers avis
                </button>
                <button
                  onClick={() => setFeedbackTab('history')}
                  className={`min-w-28 px-5 py-2.5 rounded-md text-base font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-3)] ${feedbackTab === 'history' ? 'border-[var(--accent-3)] bg-[var(--accent-3)] text-[#172027] shadow-sm' : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent-3)] hover:bg-[var(--accent-3)]/15'}`}
                  role="tab"
                  aria-selected={feedbackTab === 'history'}
                >
                  Historique ({selected.commentHistory.length})
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
                {feedbackTab === 'history' ? (
                  selected.commentHistory.length > 0 ? (
                    [...selected.commentHistory].reverse().map(comment => (
                      <div key={comment.id} className="border-b border-[var(--border-subtle)] pb-5 last:border-0">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <h2 className={`text-xs font-semibold tracking-widest uppercase ${comment.source === 'teacher' ? 'text-[var(--accent)]' : comment.source === 'author' ? 'text-[var(--accent-3)]' : 'text-[var(--text-primary)]'}`}>
                            {comment.source === 'teacher' ? `Avis de ${teacherName}` : comment.source === 'author' ? `Avis de ${selected.authorName || 'l’auteur'}` : 'Avis des camarades'}
                          </h2>
                          <time className="text-xs text-[var(--text-muted)]" dateTime={new Date(comment.createdAt).toISOString()}>
                            {new Date(comment.createdAt).toLocaleDateString('fr-FR')}
                          </time>
                        </div>
                        <div className="critique-content">{renderMarkdown(comment.content)}</div>
                        <button
                          type="button"
                          onClick={() => setExpandedCommentVersions(previous => {
                            const next = new Set(previous);
                            if (next.has(comment.id)) next.delete(comment.id);
                            else next.add(comment.id);
                            return next;
                          })}
                          className={`mt-3 inline-flex max-w-full items-center rounded-md border px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-3)] ${expandedCommentVersions.has(comment.id) ? 'border-[var(--accent-3)] bg-[var(--accent-3)] text-[#172027]' : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent-3)] hover:bg-[var(--accent-3)]/15'}`}
                          aria-expanded={expandedCommentVersions.has(comment.id)}
                        >
                          {expandedCommentVersions.has(comment.id) ? 'Masquer la version commentée' : 'Voir la version commentée'}
                        </button>
                        {expandedCommentVersions.has(comment.id) && (
                          <div className="mt-3 rounded-md border border-[var(--border-medium)] bg-[var(--bg-surface)] p-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                              Version envoyée
                            </div>
                            {comment.textSnapshot ? (
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
                                {comment.textSnapshot}
                              </p>
                            ) : (
                              <p className="text-sm italic text-[var(--text-muted)]">
                                Cette ancienne entrée ne contient pas encore la version du texte commenté.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--text-muted)] text-center mt-10">
                      Aucun ancien commentaire pour cet exercice.
                    </p>
                  )
                ) : (
                  <>
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
                {selected.authorJudgment && (
                  <div>
                    <h2 className="text-[var(--accent-3)] text-xs font-semibold tracking-widest uppercase mb-2">
                      🖋️ Jugement de {selected.authorName}
                    </h2>
                    <div className="critique-content">{renderMarkdown(selected.authorJudgment)}</div>
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
                {!selected.peerComments && !selected.teacherCritique && !selected.authorJudgment && (
                  <p className="text-sm text-[var(--text-muted)] text-center mt-10">
                    Écrivez votre texte puis demandez l&apos;avis de vos camarades ou du professeur.
                  </p>
                )}
                  </>
                )}
              </div>
            </div>
          </div>
          </>
        )}
      </div>

      {/* Exercise proposals: pick one of 3 varied exercises */}
      {exerciseProposals.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setExerciseProposals([])}>
          <div
            className="bg-[var(--bg-elevated)] border border-[var(--border-medium)] rounded-2xl shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <h3 className="font-display gradient-text font-bold text-base">🎓 {teacherName} vous propose 3 exercices</h3>
              <button onClick={() => setExerciseProposals([])} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg transition-colors">✕</button>
            </div>
            <div className="exercise-proposals-grid flex-1 overflow-y-auto p-5">
              {exerciseProposals.map((proposal, i) => (
                <div key={i} className="card-modern rounded-lg p-4 flex min-h-[22rem] flex-col overflow-hidden">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {extractField(proposal, 'Type') && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-semibold uppercase tracking-wide">
                        {extractField(proposal, 'Type')}
                      </span>
                    )}
                    {extractField(proposal, 'Genre') && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent-3)]/15 text-[var(--accent-3)] text-[10px] font-semibold uppercase tracking-wide">
                        {extractField(proposal, 'Genre')}
                      </span>
                    )}
                    {exerciseAuthors[i] && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent-2)]/15 text-[var(--accent-2)] text-[10px] font-semibold">
                        🖋️ Jugé par {exerciseAuthors[i].name}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1 text-sm">
                    {renderMarkdown(proposal)}
                    {openLessonIndex === i && (
                      <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                        {loadingLessonIndex === i && !lessonTexts[i] ? (
                          <p className="text-xs text-[var(--text-muted)] loading-cursor">Le prof prépare le cours…</p>
                        ) : (
                          renderMarkdown(lessonTexts[i] || '')
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 mt-4 flex-shrink-0">
                    <button
                      onClick={() => fetchLesson(i, proposal)}
                      className="px-3 py-2 rounded-md text-sm font-semibold border border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent-3)]/50 hover:text-[var(--accent-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-3)] transition-all"
                    >
                      {loadingLessonIndex === i ? '⏳' : openLessonIndex === i ? '📚 Masquer' : '📚 Le cours'}
                    </button>
                    <button
                      onClick={() => chooseExerciseProposal(proposal, exerciseAuthors[i])}
                      className="ml-auto px-4 py-2 rounded-md bg-[var(--accent)] text-[#181326] text-sm font-bold hover:bg-[#d0c4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] transition-colors"
                    >
                      Choisir cet exercice
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-[var(--border-subtle)] flex justify-end">
              <button
                onClick={handleNewExercise}
                disabled={isGeneratingExercise}
                className="text-[var(--text-muted)] hover:text-[var(--accent)] text-xs font-medium transition-colors disabled:opacity-40"
              >
                {isGeneratingExercise ? '⏳ Le prof réfléchit…' : '🔄 Proposer 3 autres exercices'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
