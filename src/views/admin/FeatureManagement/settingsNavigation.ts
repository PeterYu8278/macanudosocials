export const SETTINGS_SECTIONS = ['appearance', 'login', 'communication', 'payment', 'ai', 'environment', 'monitoring'] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export type ContentTab = 'frontend' | 'admin' | 'cigar-database' | 'tools' | 'app' | 'login' | 'ai' | 'communications' | 'payment' | 'env' | 'monitoring';
export type CommunicationChannel = 'whatsapp' | 'push' | 'email';

const sectionTabs: Record<SettingsSection, ContentTab> = {
  appearance: 'app', login: 'login', communication: 'communications', payment: 'payment', ai: 'ai', environment: 'env', monitoring: 'monitoring',
};

export function getSettingsSection(tab: ContentTab): SettingsSection | null {
  return SETTINGS_SECTIONS.find(section => sectionTabs[section] === tab) ?? null;
}

export function getSectionTab(section: SettingsSection): ContentTab {
  return sectionTabs[section];
}

export function readSettingsNavigation(search: string): { tab: ContentTab; channel: CommunicationChannel } {
  const params = new URLSearchParams(search);
  const requested = params.get('tab');
  const channel = params.get('channel');
  const resultChannel = channel === 'email' || channel === 'push' || channel === 'whatsapp'
    ? channel : requested === 'notifications' ? 'push' : 'whatsapp';
  if (requested === 'system') {
    const section = params.get('section');
    return { tab: getSectionTab(SETTINGS_SECTIONS.find(value => value === section) ?? 'appearance'), channel: resultChannel };
  }
  if (requested === 'whapi' || requested === 'notifications') return { tab: 'communications', channel: resultChannel };
  const tabs: ContentTab[] = ['frontend', 'admin', 'cigar-database', 'tools', ...Object.values(sectionTabs)];
  return { tab: tabs.find(tab => tab === requested) ?? 'frontend', channel: resultChannel };
}

export function writeSettingsNavigation(url: URL, tab: ContentTab, channel: CommunicationChannel): string {
  const section = getSettingsSection(tab);
  url.searchParams.set('tab', section ? 'system' : tab);
  if (section) url.searchParams.set('section', section);
  else url.searchParams.delete('section');
  if (section === 'communication') url.searchParams.set('channel', channel);
  else url.searchParams.delete('channel');
  return `${url.pathname}${url.search}${url.hash}`;
}
