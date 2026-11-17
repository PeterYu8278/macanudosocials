import { useId, useState, type ReactNode } from 'react';
import { Button, Tooltip } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './PromptStrip.css';

export interface PromptItem {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  action: ReactNode;
  warning?: boolean;
}

export default function PromptStrip({ items }: { items: PromptItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const { t } = useTranslation();
  const primary = items[0];
  if (!primary) return null;
  const toggleLabel = t(expanded ? 'homePrompts.collapse' : 'homePrompts.expand');

  return <section className="prompt-strip" aria-label={t('homePrompts.label')}>
    <div className="prompt-strip-row">
      <span className={`prompt-strip-icon${primary.warning ? ' prompt-strip-warning' : ''}`} aria-hidden="true">{primary.icon}</span>
      <span className="prompt-strip-title" role={primary.warning ? 'alert' : undefined}>{primary.title}</span>
      <div className="prompt-strip-actions">
        {primary.action}
        <Tooltip title={toggleLabel}>
          <Button size="small" type="text" aria-label={toggleLabel} aria-expanded={expanded} aria-controls={detailsId}
            icon={expanded ? <UpOutlined /> : <DownOutlined />} onClick={() => setExpanded(value => !value)}>
            {items.length > 1 ? t('homePrompts.count', { count: items.length }) : null}
          </Button>
        </Tooltip>
      </div>
    </div>
    {expanded && <div id={detailsId} className="prompt-strip-details">
      <p className={primary.warning ? 'prompt-strip-warning' : undefined}>{primary.description}</p>
      {items.slice(1).map(item => <div key={item.id} className="prompt-strip-secondary">
        <div className="prompt-strip-row">
          <span className={`prompt-strip-icon${item.warning ? ' prompt-strip-warning' : ''}`} aria-hidden="true">{item.icon}</span>
          <span className="prompt-strip-title">{item.title}</span>
          <div className="prompt-strip-actions">{item.action}</div>
        </div>
        <p>{item.description}</p>
      </div>)}
    </div>}
  </section>;
}
