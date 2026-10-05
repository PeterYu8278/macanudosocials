import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, getSectionTab, readSettingsNavigation, writeSettingsNavigation } from './settingsNavigation';

describe('system settings navigation', () => {
  it.each(SETTINGS_SECTIONS)('round trips the %s section', section => {
    const tab = getSectionTab(section);
    const path = writeSettingsNavigation(new URL('https://example.com/developer/feature-management?other=keep#settings'), tab, 'email');
    expect(readSettingsNavigation(new URL(path, 'https://example.com').search)).toEqual({ tab, channel: section === 'communication' ? 'email' : 'whatsapp' });
    expect(path).toContain('other=keep');
    expect(path).toContain('#settings');
  });
  it.each([['app', 'app'], ['communications', 'communications'], ['payment', 'payment'], ['env', 'env'], ['whapi', 'communications']])('keeps legacy %s links working', (legacy, tab) => {
    expect(readSettingsNavigation(`?tab=${legacy}`).tab).toBe(tab);
  });
  it('maps the old notifications link to Push', () => {
    expect(readSettingsNavigation('?tab=notifications')).toEqual({ tab: 'communications', channel: 'push' });
  });
  it('uses safe defaults for unknown sections and tabs', () => {
    expect(readSettingsNavigation('?tab=system&section=unknown&channel=unknown')).toEqual({ tab: 'app', channel: 'whatsapp' });
    expect(readSettingsNavigation('?tab=unknown').tab).toBe('frontend');
  });
  it('clears settings parameters when leaving system settings', () => {
    expect(writeSettingsNavigation(new URL('https://example.com/settings?tab=system&section=communication&channel=email'), 'admin', 'email')).toBe('/settings?tab=admin');
  });
});
