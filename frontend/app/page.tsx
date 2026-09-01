'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-primary)] px-6">
      <div className="text-center mb-12">
        <h1 className="text-[var(--accent)] font-semibold text-sm tracking-[0.3em] uppercase mb-3">Writer</h1>
        <p className="text-[var(--text-secondary)] text-lg">Que voulez-vous faire aujourd&apos;hui ?</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-3xl">
        <Link
          href="/ecris"
          className="group flex flex-col items-center text-center gap-4 p-10 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5 transition-all"
        >
          <span className="text-5xl">✍️</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
            J&apos;écris
          </h2>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            Rédigez vos livres et chapitres, construisez votre univers, et recevez les critiques de vos
            auteurs préférés.
          </p>
        </Link>

        <Link
          href="/apprends"
          className="group flex flex-col items-center text-center gap-4 p-10 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/5 transition-all"
        >
          <span className="text-5xl">🎓</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
            J&apos;apprends
          </h2>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            Rejoignez un atelier d&apos;écriture créative : exercices du professeur, avis de vos camarades de
            classe, et critique finale.
          </p>
        </Link>
      </div>
    </div>
  );
}
