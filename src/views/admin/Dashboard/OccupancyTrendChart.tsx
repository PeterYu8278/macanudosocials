import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface OccupancyTrendPoint { label: string; value: number; redemptions: number | null }
export default function OccupancyTrendChart({ data, isMobile }: { data: OccupancyTrendPoint[]; isMobile: boolean }) {
  const { t } = useTranslation();
  const [showPeople, setShowPeople] = useState(true), [showCigars, setShowCigars] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 500, height = 220, left = 38, right = 42, top = 20, bottom = 30;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const gold = '#FDE08D', blue = '#38bdf8';
  const cigarsReady = data.length > 0 && data.every(point => point.redemptions !== null);
  const maximum = (values: number[]) => Math.max(4, Math.ceil(Math.max(0, ...values) / 4) * 4);
  const maxPeople = maximum(data.map(point => point.value));
  const maxCigars = maximum(data.map(point => point.redemptions ?? 0));
  const points = (values: number[], max: number) => values.map((value, index) => ({
    x: left + index / Math.max(1, data.length - 1) * chartWidth,
    y: top + chartHeight - value / max * chartHeight,
  }));
  const people = points(data.map(point => point.value), maxPeople);
  const cigars = points(data.map(point => point.redemptions ?? 0), maxCigars);
  const path = (series: typeof people) => series.map((point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = series[index - 1], delta = (point.x - previous.x) / 3;
    return `C ${previous.x + delta} ${previous.y}, ${point.x - delta} ${point.y}, ${point.x} ${point.y}`;
  }).join(' ');
  const hovered = hoveredIndex === null ? null : data[hoveredIndex];
  const stride = data.length <= 7 ? 1 : Math.max(1, Math.ceil(data.length / (isMobile ? 6 : 8)));
  return <div style={{ position: 'relative', height: isMobile ? 250 : 286, minWidth: 0, boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', padding: 16, border: '1px solid rgba(244,175,37,0.15)',
    borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
      <button type="button" className="dashboard-chart-legend" aria-pressed={showPeople} onClick={() => setShowPeople(value => !value)}>
        <span style={{ width: 18, height: 3, background: gold }} />{t('dashboard.occupancyPeople')}
      </button>
      <button type="button" className="dashboard-chart-legend" aria-pressed={showCigars && cigarsReady}
        disabled={!cigarsReady} title={!cigarsReady ? t('dashboard.redemptionTrendUnavailable') : undefined}
        onClick={() => setShowCigars(value => !value)}>
        <span style={{ width: 18, height: 3, background: blue }} />{t('dashboard.cigarRedemptions')}
      </button>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" aria-label={t('dashboard.occupancyTrend')}
      style={{ flex: 1, minHeight: 0, overflow: 'visible' }}>
      {Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4, y = top + chartHeight - ratio * chartHeight;
        return <g key={index}>
          <line x1={left} y1={y} x2={width - right} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
          {showPeople && <text x={left - 8} y={y + 4} fill={gold} fontSize="9" textAnchor="end">{Math.round(ratio * maxPeople)}</text>}
          {showCigars && cigarsReady && <text x={width - right + 8} y={y + 4} fill={blue} fontSize="9">{Math.round(ratio * maxCigars)}</text>}
        </g>;
      })}
      {data.map((point, index) => index % stride === 0 || index === data.length - 1
        ? <text key={index} x={people[index].x} y={top + chartHeight + 16} fill="rgba(255,255,255,0.55)" fontSize="9" textAnchor="middle">{point.label}</text> : null)}
      {showPeople && <path data-series="occupancy" d={path(people)} fill="none" stroke={gold} strokeWidth="3" strokeLinecap="round" />}
      {showCigars && cigarsReady && <path data-series="redemptions" d={path(cigars)} fill="none" stroke={blue} strokeWidth="3" strokeLinecap="round" />}
      {data.map((point, index) => <g key={index}>
        {showPeople && <circle cx={people[index].x} cy={people[index].y} r={hoveredIndex === index ? 5 : 3.5} fill="#1a160d" stroke={gold} strokeWidth="2" style={{ pointerEvents: 'none' }} />}
        {showCigars && cigarsReady && <circle cx={cigars[index].x} cy={cigars[index].y} r={hoveredIndex === index ? 5 : 3.5} fill="#1a160d" stroke={blue} strokeWidth="2" style={{ pointerEvents: 'none' }} />}
        <rect x={Math.max(left, people[index].x - chartWidth / Math.max(1, data.length - 1) / 2)} y={top}
          width={data.length === 1 ? chartWidth : chartWidth / (data.length - 1) / (index === 0 || index === data.length - 1 ? 2 : 1)}
          height={chartHeight} fill="transparent" role="button" tabIndex={0}
          aria-label={`${point.label}: ${t('dashboard.occupancyPeople')} ${point.value}; ${t('dashboard.cigarRedemptions')} ${point.redemptions ?? '-'}`}
          onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}
          onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} onClick={() => setHoveredIndex(index)}
          onKeyDown={event => { if (event.key === 'Escape') setHoveredIndex(null); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setHoveredIndex(index); } }} />
      </g>)}
    </svg>
    {!cigarsReady && <span style={{ color: 'rgba(255,255,255,0.62)', fontSize: 11 }}>{t('dashboard.redemptionTrendUnavailable')}</span>}
    {hovered && (showPeople || showCigars && cigarsReady) && <div role="status" style={{ position: 'absolute',
      left: `${Math.min(78, Math.max(22, people[hoveredIndex!].x / width * 100))}%`, top: 48, transform: 'translateX(-50%)',
      maxWidth: 'calc(100% - 32px)', padding: '7px 10px', border: '1px solid rgba(56,189,248,0.5)', borderRadius: 6,
      background: 'rgba(26,22,13,0.96)', color: '#fff', fontSize: 11, pointerEvents: 'none', zIndex: 2 }}>
      <div>{hovered.label}</div>
      {showPeople && <div style={{ color: gold }}>{t('dashboard.occupancyPeople')}: {hovered.value}</div>}
      {showCigars && cigarsReady && <div style={{ color: blue }}>{t('dashboard.cigarRedemptions')}: {hovered.redemptions}</div>}
    </div>}
  </div>;
}
