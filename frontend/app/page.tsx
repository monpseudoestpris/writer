'use client';

import Link from 'next/link';

const CHOICES = [
  {
    href: '/ecris',
    icon: '✍️',
    title: "J'écris",
    description:
      "Rédigez vos livres et chapitres, construisez votre univers, et recevez les critiques de vos auteurs préférés.",
    gradient: 'from-fuchsia-500/25 via-violet-500/15 to-transparent',
    ring: 'group-hover:shadow-[0_25px_60px_-15px_rgba(236,72,153,0.35)]',
  },
  {
    href: '/apprends',
    icon: '🎓',
    title: "J'apprends",
    description:
      "Rejoignez un atelier d'écriture créative : exercices du professeur, avis de vos camarades de classe, et critique finale.",
    gradient: 'from-cyan-500/25 via-violet-500/15 to-transparent',
    ring: 'group-hover:shadow-[0_25px_60px_-15px_rgba(34,211,238,0.35)]',
  },
];

export default function Home() {
  return (
    <div className="relative h-screen flex flex-col items-center justify-center overflow-hidden bg-[var(--bg-primary)] px-6">
      {/* Animated ambient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-40 left-1/4 h-[30rem] w-[30rem] rounded-full bg-[var(--accent)]/25 blur-[100px]"
          style={{ animation: 'floatBlob 14s ease-in-out infinite' }}
        />
        <div
          className="absolute top-1/3 -right-32 h-[26rem] w-[26rem] rounded-full bg-[var(--accent-2)]/20 blur-[100px]"
          style={{ animation: 'floatBlob 18s ease-in-out infinite reverse' }}
        />
        <div
          className="absolute bottom-[-8rem] left-1/3 h-[24rem] w-[24rem] rounded-full bg-[var(--accent-3)]/15 blur-[100px]"
          style={{ animation: 'floatBlob 16s ease-in-out infinite' }}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025] mix-blend-overlay"
        style={{ backgroundImage: 'url(/paper.png)', backgroundSize: 'auto' }}
      />

      <div className="relative z-10 flex flex-col items-center critique-content">
        <div className="text-center mb-12">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--border-medium)] bg-white/[0.04] text-xs font-semibold tracking-[0.25em] uppercase text-[var(--text-secondary)] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-3)] animate-pulse" />
            Propulsé par l&apos;IA
          </span>
          <h1 className="font-display font-bold text-6xl sm:text-7xl gradient-text tracking-tight mb-4 leading-tight">
            Writer
          </h1>
          <p className="text-[var(--text-secondary)] text-lg sm:text-xl font-medium">
            Que voulez-vous faire aujourd&apos;hui&nbsp;?
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-3xl">
          {CHOICES.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={`group relative flex flex-col items-center text-center gap-4 p-9 rounded-3xl border border-[var(--border-subtle)] bg-gradient-to-br ${c.gradient} bg-[var(--bg-secondary)]/70 backdrop-blur-sm hover:border-[var(--accent)]/50 hover:-translate-y-1.5 transition-all duration-300 ${c.ring} overflow-hidden`}
            >
              <span className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/[0.06] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.06] text-3xl border border-white/10 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                {c.icon}
              </span>
              <h2 className="relative font-display font-bold text-2xl text-[var(--text-primary)] group-hover:gradient-text transition-colors">
                {c.title}
              </h2>
              <p className="relative text-sm text-[var(--text-secondary)] leading-relaxed">
                {c.description}
              </p>
              <span className="relative mt-1 inline-flex items-center gap-1.5 text-[var(--accent-3)] text-xs font-bold tracking-wide opacity-0 group-hover:opacity-100 transition-all group-hover:gap-2.5">
                Entrer <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-12 text-[var(--text-muted)] text-xs tracking-wide">
          Pensé pour les auteurs, les curieux et les élèves qui veulent progresser.
        </p>
      </div>
    </div>
  );
}
