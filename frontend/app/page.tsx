import Link from 'next/link';
import { Brand, Icon } from './components/Design';

const CHOICES = [
  { href: '/ecris', icon: 'pen' as const, theme: 'lilac', number: '01', title: "J’écris", subtitle: 'Donnez vie à vos idées', description: 'Un espace à vous pour vos ouvrages, vos chapitres et les univers que vous imaginez.', features: ['Éditeur de texte', 'Création d’univers', 'Regards d’auteurs'], action: 'Ouvrir mon espace' },
  { href: '/apprends', icon: 'book' as const, theme: 'sage', number: '02', title: "J’apprends", subtitle: 'Faites grandir votre plume', description: 'Des exercices créatifs, des conseils et des échanges pour trouver votre propre voix.', features: ['Exercices guidés', 'Cours personnalisés', 'Retours constructifs'], action: 'Rejoindre l’atelier' },
];

export default function Home() {
  return (
    <div className="home-page">
      <a className="skip-link" href="#espaces">Choisir mon espace</a>
      <header className="home-header">
        <Brand />
        <nav className="home-nav" aria-label="Navigation principale">
          <Link href="/ecris">J&apos;écris</Link>
          <Link href="/apprends">J&apos;apprends</Link>
        </nav>
        <span className="ai-badge"><Icon name="sparkles" /> Un peu d’IA, beaucoup de vous</span>
      </header>

      <main className="home-main">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="hero-copy">
            <span className="eyebrow"><span /> VOTRE ATELIER D’ÉCRITURE</span>
            <h1 id="home-title">Les belles histoires<br />commencent <em>ici.</em></h1>
            <p>Une idée, une envie, quelques mots…<br />Offrez à votre imagination l’espace de s’exprimer.</p>
            <div className="hero-actions">
              <Link href="/ecris" className="home-primary">À vos plumes <Icon name="arrow" /></Link>
              <Link href="/apprends" className="home-secondary">Explorer l’atelier <span aria-hidden="true">↗</span></Link>
            </div>
            <div className="hero-footnote"><Icon name="leaf" /> À votre rythme. À votre façon.</div>
          </div>

          <div className="writing-scene" aria-hidden="true">
            <div className="scene-orbit orbit-one" /><div className="scene-orbit orbit-two" />
            <span className="scene-star star-one">✧</span><span className="scene-star star-two">✦</span>
            <div className="notebook-back" />
            <div className="notebook">
              <div className="notebook-top"><span>LES IDÉES PRENNENT VIE</span><Icon name="sparkles" /></div>
              <div className="notebook-content">
                <span className="notebook-chapter">CHAPITRE PREMIER</span>
                <p>Tout commence<br />par <em>un mot.</em></p>
                <div className="ink-lines"><i /><i /><i /></div>
                <svg className="ink-flourish" width="160" height="40" viewBox="0 0 160 40" fill="none"><path d="M4 25C35 2 52 8 42 23c-9 14-20 5-6 0 22-8 27 14 47 1 8-6 10-4 9 2 14-8 25-4 37-8 10-3 15-6 25-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </div>
              <div className="notebook-bottom"><span>VOTRE PROCHAINE HISTOIRE</span><span>01</span></div>
              <div className="page-bookmark" />
            </div>
            <div className="scene-note"><span className="scene-note-icon"><Icon name="pen" /></span><div>Un mot après l’autre.<small>Et l’imagination fait le reste.</small></div></div>
            <div className="scene-label">Laissez une place à l’inspiration <span>↗</span></div>
          </div>
        </section>

        <section className="spaces-section" id="espaces" aria-labelledby="spaces-title">
          <div className="spaces-heading"><h2 id="spaces-title">Aujourd’hui, je prends le temps de…</h2><span>DEUX ESPACES, MILLE POSSIBILITÉS</span></div>
          <div className="spaces-grid">
            {CHOICES.map(choice => (
              <Link key={choice.href} href={choice.href} className={`space-card ${choice.theme}`}>
                <div className="space-card-top"><span className="space-icon"><Icon name={choice.icon} /></span><span className="space-number">{choice.number} / EXPLORER</span><Icon name="arrow" className="space-arrow" /></div>
                <div className="space-title"><h3>{choice.title}</h3><span>{choice.subtitle}</span></div>
                <p>{choice.description}</p>
                <div className="space-features">{choice.features.map(feature => <span key={feature}>{feature}</span>)}</div>
                <div className="space-card-footer">{choice.action}<span aria-hidden="true">↗</span></div>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="home-footer"><span>Un espace pour créer. Une envie de progresser.</span><span>Fait pour les amoureux des mots <span className="footer-flower" aria-hidden="true">✳</span></span></footer>
    </div>
  );
}
