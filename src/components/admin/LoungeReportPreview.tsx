import './LoungeReportPreview.css';

/** Presentation only: the saved report and the WhatsApp message remain unchanged. */
export default function LoungeReportPreview({ text }: { text: string }) {
  const sections: Array<{ title?: string; lines: string[] }> = [{ lines: [] }];
  const explicitHeadings = /^>\s*\*.+\*\s*$/m.test(text);
  const legacyHeadings: Record<string, string> = {
    'Settlement:': 'Visitation', 'Confirmed cigars:': 'Cigar Redemption',
    'Outstanding lounge debt (verified):': 'Outstanding',
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^>\s*\*(.+)\*\s*$/)?.[1]
      || (!explicitHeadings && Object.entries(legacyHeadings).find(([prefix]) => line.startsWith(prefix))?.[1]);
    if (heading) sections.push({ title: heading, lines: [] });
    if (!line.match(/^>\s*\*.+\*\s*$/)) sections[sections.length - 1].lines.push(line);
  }
  return <article className="lounge-report-preview">
    {sections.filter(section => section.lines.join('').trim() || section.title).map((section, index) =>
      <section className={section.title ? 'lounge-report-preview-section' : 'lounge-report-preview-heading'} key={index}>
        {section.title && <h3>{section.title}</h3>}
        <pre>{section.lines.join('\n').trim()}</pre>
      </section>)}
  </article>;
}
