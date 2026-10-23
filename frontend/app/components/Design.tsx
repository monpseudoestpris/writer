import Link from 'next/link';

export function Icon({ name, className = '' }: { name: 'pen' | 'book' | 'sparkles' | 'arrow' | 'leaf'; className?: string }) {
  const paths = {
    pen: <><path d="m15 5 4 4M4 20l4.5-1L20 7.5a2.8 2.8 0 0 0-4-4L4.5 15 4 20Z" /><path d="m4.5 15 4.5 4M13 20h7" /></>,
    book: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z" /><path d="M12 6v14M6 9h3M15 9h3M6 12h3M15 12h3" /></>,
    sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    leaf: <><path d="M20 3C9 2 3 6 5 14c2 7 15 5 15-11Z" /><path d="M3 21 15 9" /></>,
  };
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Brand() {
  return <Link href="/" className="brand" aria-label="Writer — Accueil"><span className="brand-mark"><Icon name="pen" /></span><span>writer<span className="brand-dot">.</span></span></Link>;
}

export function WorkspaceNav({ active }: { active: 'write' | 'learn' }) {
  return <div className="workspace-nav">
    <Brand />
    <nav className="workspace-switch" aria-label="Espaces de travail">
      <Link href="/ecris" aria-current={active === 'write' ? 'page' : undefined}><Icon name="pen" /> J&apos;écris</Link>
      <Link href="/apprends" aria-current={active === 'learn' ? 'page' : undefined}><Icon name="book" /> J&apos;apprends</Link>
    </nav>
    <p className="workspace-caption">{active === 'write' ? 'Votre espace de création' : 'Un peu de pratique, beaucoup de progrès'}</p>
  </div>;
}
