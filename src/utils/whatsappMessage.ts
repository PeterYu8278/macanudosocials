const BRAND_HEADER = '[Macanudo Socials]';

export function formatWhatsAppMessage(text: string): string {
  const body = text.startsWith(BRAND_HEADER)
    ? text.slice(BRAND_HEADER.length).replace(/^(?:\r?\n|[ \t])+/, '')
    : text;
  return `${BRAND_HEADER}\n${body}`;
}
