import { useEffect, useRef, useState } from 'react';
import { MenuOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { GuestPageConfig } from '../../../config/guestPage';
import { guestContactUrl, currentGuestMembership } from '../../../config/guestPage';
import GuestMembership from '../../../components/common/GuestMembership';
import './guest-lounge.css';

const PHOTO = '/lounge/';
const rooms = [
  { key: 'quiet', photo: 'quiet-lounge.png' },
  { key: 'table', photo: 'social-table.png' },
  { key: 'window', photo: 'window-lounge.png' },
] as const;

function BrandLogo({ url, name }: { url?: string; name: string }) {
  const [loaded, setLoaded] = useState<string>();
  const fallback = '/icons/app-logo-192.png';
  useEffect(() => {
    if (!url) return;
    let active = true;
    const image = new Image();
    // Keep the bundled brand visible while a configured remote logo loads.
    image.onload = () => { if (active) setLoaded(url); };
    image.src = url;
    return () => { active = false; };
  }, [url]);
  return <img className="guest-brand-logo" src={url && loaded === url ? url : fallback} alt={name}
    width="150" height="78" onError={() => setLoaded(undefined)} />;
}

export default function GuestLoungePage({ config, logoUrl, onRegister, onLogin }: {
  config: GuestPageConfig; logoUrl?: string; onRegister: () => void; onLogin: () => void;
}) {
  const { t, i18n } = useTranslation();
  const copy = (key: string) => t(`guestLounge.${key}`);
  const [menuOpen, setMenuOpen] = useState(false), [room, setRoom] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const selected = rooms[room];
  useEffect(() => {
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('guest-revealed'); observer.unobserve(entry.target); }
    }, { threshold: 0.12 });
    root.current?.querySelectorAll('[data-guest-reveal]').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    if (menuOpen) document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);
  const contact = guestContactUrl(config);
  const membership = currentGuestMembership(config);
  return <div className="guest-lounge" ref={root}>
    <a className="guest-skip" href="#guest-main">{copy('skip')}</a>
    <header className="guest-header guest-gutter">
      <a href="#home" aria-label={config.loungeName} className="guest-brand"><BrandLogo url={logoUrl} name={config.loungeName} /></a>
      <button className="guest-menu-toggle" type="button" aria-label={copy(menuOpen ? 'closeMenu' : 'openMenu')}
        aria-expanded={menuOpen} aria-controls="guest-navigation" onClick={() => setMenuOpen(v => !v)}>
        {menuOpen ? <CloseOutlined /> : <MenuOutlined />}
      </button>
      <nav id="guest-navigation" aria-label={copy('navigation')} className={`guest-navigation${menuOpen ? ' guest-navigation-open' : ''}`}>
        <a href="#lounge" onClick={() => setMenuOpen(false)}>{copy('lounge')}</a>
        <a href="#visit" onClick={() => setMenuOpen(false)}>{copy('visit')}</a>
        <a href="#trust" onClick={() => setMenuOpen(false)}>{copy('membership')}</a>
        <a href="#faq" onClick={() => setMenuOpen(false)}>{copy('faqNav')}</a>
        <button type="button" className="guest-text-button" onClick={() => { setMenuOpen(false); onLogin(); }}>{copy('signIn')}</button>
        <button type="button" className="guest-language" aria-label={copy('language')}
          onClick={() => void i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en-US' : 'zh-CN')}>
          {i18n.language.startsWith('zh') ? 'English' : '中文'}
        </button>
      </nav>
    </header>
    <main id="guest-main">
      <section id="home" className="guest-hero">
        <picture className="guest-hero-picture">
          <source media="(max-width: 640px)" srcSet={PHOTO + 'stone-wall-seating.png'} />
          <img src={PHOTO + 'lounge-hero.png'} alt={copy('heroAlt')} width="1360" height="1020" fetchPriority="high" />
        </picture>
        <div className="guest-hero-scrim" />
        <div className="guest-hero-copy guest-gutter">
          <h1>{copy('heroTitle')}</h1>
          <p>{copy('heroBody')}</p>
          <a className="guest-cta" href={contact} target="_blank" rel="noopener noreferrer">{copy('planVisit')}</a>
        </div>
      </section>
      <section id="lounge" className="guest-about guest-gutter guest-section">
        <img data-guest-reveal src={PHOTO + 'window-lounge.png'} alt={copy('windowAlt')} width="807" height="1020" loading="lazy" />
        <div className="guest-about-copy">
          <h2 data-guest-reveal>{copy('aboutTitle')}</h2>
          <p data-guest-reveal>{copy('aboutBody')}</p>
          <p data-guest-reveal>{copy('aboutSecond')}</p>
          <a href="#corners" data-guest-reveal>{copy('explore')}</a>
        </div>
      </section>
      <section id="corners" className="guest-corners guest-gutter guest-section">
        <h2 data-guest-reveal>{copy('cornersTitle')}</h2>
        <div className="guest-corner-layout">
          <figure data-guest-reveal>
            <img key={selected.key} src={PHOTO + selected.photo} alt={copy(`rooms.${selected.key}.alt`)} width="1360" height="1020" loading="lazy" />
            <figcaption aria-live="polite">{copy(`rooms.${selected.key}.description`)}</figcaption>
          </figure>
          <div className="guest-room-choices" role="group" aria-label={copy('chooseCorner')}>
            {rooms.map((item, index) => <button data-guest-reveal key={item.key} type="button" aria-pressed={room === index}
              onClick={() => setRoom(index)}><span>{copy(`rooms.${item.key}.title`)}</span><span>{copy(`rooms.${item.key}.hint`)}</span></button>)}
          </div>
        </div>
        <div className="guest-triptych">
          <figure data-guest-reveal><img src={PHOTO + 'caramel-seating.png'} alt={copy('caramelAlt')} width="1360" height="1020" loading="lazy" /><figcaption>{copy('caramelCaption')}</figcaption></figure>
          <figure data-guest-reveal><img src={PHOTO + 'drinks-corner.png'} alt={copy('drinksAlt')} width="1360" height="944" loading="lazy" /><figcaption>{copy('drinksCaption')}</figcaption></figure>
          <figure data-guest-reveal><img src={PHOTO + 'screening-corner.png'} alt={copy('screenAlt')} width="765" height="1020" loading="lazy" /><figcaption>{copy('screenCaption')}</figcaption></figure>
        </div>
      </section>
      <section id="visit" className="guest-visit guest-gutter guest-section">
        <div className="guest-visit-title"><h2 data-guest-reveal>{copy('visitTitle')}</h2><p data-guest-reveal>{config.loungeName}</p></div>
        <div className="guest-visit-details" data-guest-reveal>
          <dl><div><dt>{copy('address')}</dt><dd><address>{config.address}</address></dd></div>
            <div><dt>{copy('hours')}</dt><dd>{t('guestPublic.visitHours', { hours: `${config.opensAt}–${config.closesAt}` })}</dd></div>
            <div><dt>{copy('contact')}</dt><dd><a href={`tel:+${config.phone}`}>+{config.phone}</a></dd></div></dl>
          <div className="guest-visit-actions"><a className="guest-cta" href={contact} target="_blank" rel="noopener noreferrer">{copy('planVisit')}</a>
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(config.address)}`} target="_blank" rel="noopener noreferrer">{copy('directions')}</a></div>
        </div>
      </section>
      <section id="faq" className="guest-faq guest-gutter guest-section">
        <h2 data-guest-reveal>{copy('faqTitle')}</h2>
        <div className="guest-faq-list">
          <details className="guest-faq-item" data-guest-reveal>
            <summary>{copy('faq.membershipQ')}</summary>
            <p>{t('guestLounge.faq.membershipA', { price: membership?.annualPrice ?? 299, credit: membership?.credit ?? 100, cigars: membership?.cigarsPerYear ?? 25 })}</p>
          </details>
          <details className="guest-faq-item" data-guest-reveal>
            <summary>{copy('faq.hoursQ')}</summary>
            <p>{t('guestLounge.faq.hoursA', { hours: `${config.opensAt}–${config.closesAt}` })}</p>
          </details>
          <details className="guest-faq-item" data-guest-reveal>
            <summary>{copy('faq.locationQ')}</summary>
            <p>{copy('faq.locationA')}</p>
          </details>
          <details className="guest-faq-item" data-guest-reveal>
            <summary>{copy('faq.nonSmokersQ')}</summary>
            <p>{copy('faq.nonSmokersA')}</p>
          </details>
        </div>
      </section>
      <div className="guest-gutter guest-section guest-membership-wrap" data-guest-reveal><GuestMembership config={config} onRegister={onRegister} /></div>
    </main>
    <footer className="guest-footer guest-gutter">
      <a href="#home" aria-label={config.loungeName}><BrandLogo url={logoUrl} name={config.loungeName} /></a>
      <p>{copy('footer')}</p><a href={contact} target="_blank" rel="noopener noreferrer">{copy('planVisit')}</a>
<p className="guest-copyright">© {new Date().getFullYear()} Macanudo Socials</p>
    </footer>
  </div>;
}
