import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/modules/auth';
import { recordWebsiteEvent, flushWebsiteTraffic, setTrafficPage, touchWebsiteSession } from '../../services/websiteTraffic';
import type { TrafficPage } from '../../utils/websiteTraffic';

let lastView = '', lastAt = 0;
export default function WebsiteTrafficTracker({ guestVisible }: { guestVisible: boolean }) {
  const location = useLocation(), { user, loading } = useAuthStore();
  useEffect(() => {
    const routePages: Record<string, TrafficPage> = { '/': user ? 'member_home' : 'guest_landing', '/events': 'events', '/shop': 'shop', '/profile': 'profile', '/reload': 'reload' };
    const allowed = !loading && (!user || ['guest', 'member', 'vip'].includes(user.role))
      && (!!user || guestVisible) && !!routePages[location.pathname];
    const currentPage = allowed ? routePages[location.pathname] : null;
    setTrafficPage(currentPage); if (!currentPage) return;
    const key = `${location.key}:${currentPage}`;
    let visibleMs = 0, previousTick = performance.now(), engaged = false, ticks = 0;
    const view = () => {
      if (document.visibilityState !== 'visible' || lastView === key) return;
      // StrictMode remount uses the same navigation key. A genuine reload resets this module.
      if (lastView !== key || Date.now() - lastAt > 1000) {
        lastView = key; lastAt = Date.now(); recordWebsiteEvent('page_view');
      }
    };
    view();
    const timer = window.setInterval(() => {
      view(); const now = performance.now();
      if (document.visibilityState === 'visible') visibleMs += Math.min(now - previousTick, 1500);
      previousTick = now;
      if (visibleMs >= 10000 && !engaged) { engaged = true; recordWebsiteEvent('engaged_visit'); }
      if (++ticks % 5 === 0) void flushWebsiteTraffic();
    }, 1000);
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      if (link.protocol === 'tel:') recordWebsiteEvent('phone_click');
      else if (['wa.me', 'api.whatsapp.com'].includes(link.hostname)) recordWebsiteEvent('whatsapp_click');
    };
    const hidden = () => { previousTick = performance.now(); if (document.visibilityState === 'hidden') void flushWebsiteTraffic(); };
    document.addEventListener('click', click); document.addEventListener('visibilitychange', hidden);
    document.addEventListener('pointerdown', touchWebsiteSession, { passive: true });
    document.addEventListener('keydown', touchWebsiteSession, { passive: true });
    document.addEventListener('scroll', touchWebsiteSession, { passive: true, capture: true });
    window.addEventListener('online', flushWebsiteTraffic);
    return () => { clearInterval(timer); setTrafficPage(null); document.removeEventListener('click', click);
      document.removeEventListener('pointerdown', touchWebsiteSession); document.removeEventListener('keydown', touchWebsiteSession);
      document.removeEventListener('scroll', touchWebsiteSession, true);
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('online', flushWebsiteTraffic); };
  }, [location.pathname, location.key, loading, user?.id, user?.role, guestVisible]);
  return null;
}
