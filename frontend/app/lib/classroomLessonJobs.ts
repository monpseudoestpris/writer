import { updateClassroomExercise, type ClassroomExperienceLevel } from './db';

export type LessonJob = {
  status: 'running' | 'completed' | 'failed';
  text: string;
  error?: string;
};

const IDLE_TIMEOUT_MS = 180_000;
const ERROR_MARKER = '[[WRITER_LESSON_ERROR]]';
const listeners = new Set<() => void>();
const emptyJobs = new Map<string, LessonJob>();
let jobs = emptyJobs;

export const getLessonJobs = () => jobs;
export const getServerLessonJobs = () => emptyJobs;
export const subscribeLessonJobs = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function updateJob(id: string, job: LessonJob) {
  jobs = new Map(jobs).set(id, job);
  listeners.forEach(listener => listener());
}

export function startLessonJob(id: string, prompt: string, experienceLevel: ClassroomExperienceLevel) {
  if (jobs.get(id)?.status === 'running') return;
  updateJob(id, { status: 'running', text: '' });

  void (async () => {
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { timedOut = true; controller.abort(); }, IDLE_TIMEOUT_MS);
    };

    try {
      resetIdleTimer();
      const response = await fetch('http://localhost:8000/classroom/lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_prompt: prompt, experience_level: experienceLevel }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      if (!response.body) throw new Error('Pas de flux disponible');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdleTimer();
        text += decoder.decode(value, { stream: true });
        if (text.includes(ERROR_MARKER)) throw new Error('Le cours n’a pas pu être généré. Réessayez.');
        updateJob(id, { status: 'running', text });
      }
      text += decoder.decode();
      if (!text.trim()) throw new Error('Le cours généré est vide. Réessayez.');
      await updateClassroomExercise(id, { lesson: text });
      updateJob(id, { status: 'completed', text });
    } catch (error) {
      const message = timedOut
        ? 'La génération du cours ne répond plus. Vous pouvez réessayer.'
        : error instanceof Error ? error.message : 'Impossible de générer le cours.';
      updateJob(id, { status: 'failed', text: '', error: message });
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  })();
}
