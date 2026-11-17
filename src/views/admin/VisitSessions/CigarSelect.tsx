import React, { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { Input, Spin, type InputProps, type InputRef } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import './CigarSelect.css';

interface CigarSelectProps extends Omit<InputProps, 'value' | 'onChange'> {
  value?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
  loading?: boolean;
  loadError?: boolean;
}

// Keep options in normal document flow: popup alignment can move offscreen on some clients.
const CigarSelect = forwardRef<InputRef, CigarSelectProps>(({ value, onChange, options, loading, loadError, disabled, ...inputProps }, ref) => {
  const { t } = useTranslation();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.find(option => option.value === value);
  const active = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, query]);

  const expand = () => {
    if (!disabled && !open) {
      setQuery('');
      setActiveIndex(0);
      setOpen(true);
    }
  };
  const choose = (id: string) => {
    onChange?.(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="redemption-cigar-select" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <Input
        {...inputProps}
        ref={ref}
        disabled={disabled}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && filtered.length ? `${listId}-${active}` : undefined}
        value={open ? query : selected?.label || value || ''}
        suffix={loading ? <Spin size="small" /> : <DownOutlined />}
        onFocus={event => { inputProps.onFocus?.(event); expand(); }}
        onClick={expand}
        onChange={event => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) expand();
            else setActiveIndex(Math.max(0, Math.min(filtered.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
          } else if (open && event.key === 'Enter') {
            event.preventDefault();
            if (filtered[active]) choose(filtered[active].value);
          } else if (open && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <>
          {loading && <div className="redemption-cigar-state" role="status">{t('common.loading')}</div>}
          <div id={listId} role="listbox" aria-label={inputProps.placeholder} aria-busy={loading} className="redemption-cigar-options" ref={listRef}>
            {filtered.map((option, index) => (
              <div
                id={`${listId}-${index}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={`redemption-cigar-option${index === active ? ' is-active' : ''}`}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >{option.label}</div>
            ))}
          </div>
          {!loading && filtered.length === 0 && <div className="redemption-cigar-state" role="status">{t(loadError ? 'visitSessions.loadCigarsFailed' : 'common.noData')}</div>}
        </>
      )}
    </div>
  );
});

CigarSelect.displayName = 'CigarSelect';
export default CigarSelect;
