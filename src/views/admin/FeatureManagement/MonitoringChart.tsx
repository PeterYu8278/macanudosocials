import { useState } from 'react';
import { Checkbox, Empty, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { MetricRow } from '@/services/firebase/monitoringQueue';
import './MonitoringChart.css';

const series = ['reads', 'writes', 'deletes'] as const;
type Series = typeof series[number];
const colors = { reads: '#5796ff', writes: '#ffab32', deletes: '#ff6fa4' };
type DailyPoint = { date: string; values: Record<Series, number> | null };

export function dailyMonitoringPoints(rows: Array<MetricRow & { date: string }>, days: number, now = new Date()): DailyPoint[] {
  const totals = new Map<string, Record<Series, number>>();
  for (const row of rows) {
    const value = totals.get(row.date) || { reads: 0, writes: 0, deletes: 0 };
    for (const key of series) value[key] += row[key];
    totals.set(row.date, value);
  }
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + index + 1));
    const date = day.toISOString().slice(0, 10);
    return { date, values: totals.get(date) || null };
  });
}

export default function MonitoringChart({ rows, days, loading }: {
  rows: Array<MetricRow & { date: string }>; days: number; loading: boolean;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState<Record<Series, boolean>>({ reads: true, writes: true, deletes: true });
  const points = dailyMonitoringPoints(rows, days);
  const totals = Object.fromEntries(series.map(key => [key, points.reduce((sum, point) => sum + (point.values?.[key] || 0), 0)]));
  const max = Math.max(1, ...points.flatMap(point => series.filter(key => visible[key]).map(key => point.values?.[key] || 0)));
  const ceiling = Math.ceil(max / 4) * 4;
  const x = (index: number) => points.length === 1 ? 350 : 65 + index * 535 / (points.length - 1);
  const y = (value: number) => 210 - value / ceiling * 185;
  const path = (key: Series) => {
    let connected = false;
    return points.map((point, index) => {
      if (!point.values) { connected = false; return ''; }
      const command = connected ? 'L' : 'M'; connected = true;
      return `${command}${x(index)},${y(point.values[key])}`;
    }).join(' ');
  };
  const hasData = points.some(point => point.values);
  return <section className="monitoring-trend" aria-busy={loading} aria-label={t('systemMonitoring.trend')}>
    <Typography.Title level={5}>{t('systemMonitoring.trend')}</Typography.Title>
    <div className="monitoring-trend-layout">
      <div className="monitoring-trend-legend">
        {series.map(key => <div key={key}>
          <Checkbox checked={visible[key]} onChange={event => setVisible(value => ({ ...value, [key]: event.target.checked }))}>
            <span style={{ color: colors[key] }}>{t(`systemMonitoring.${key}`)}</span>
          </Checkbox>
          <strong style={{ color: colors[key] }}>{totals[key].toLocaleString()}</strong>
        </div>)}
      </div>
      <div className="monitoring-trend-plot">
        {!hasData ? <Empty description={t('systemMonitoring.empty')} /> : <svg viewBox="0 0 630 265" role="img" aria-label={t('systemMonitoring.dailyOperations')}>
          {[0, 1, 2, 3, 4].map(tick => <g key={tick}>
            <line x1="65" x2="600" y1={y(ceiling * tick / 4)} y2={y(ceiling * tick / 4)} stroke="currentColor" opacity="0.15" />
            <text x="55" y={y(ceiling * tick / 4) + 4} textAnchor="end">{(ceiling * tick / 4).toLocaleString()}</text>
          </g>)}
          {points.map((point, index) => (points.length <= 7 || index % 5 === 0 || index === points.length - 1) &&
            <text key={point.date} x={x(index)} y="232" textAnchor="middle">{point.date.slice(5)}</text>)}
          <text x="330" y="258" textAnchor="middle">{t('systemMonitoring.dailyOperations')}</text>
          {series.filter(key => visible[key]).map(key => <g key={key}>
            <path d={path(key)} fill="none" stroke={colors[key]} strokeWidth="2" />
            {points.map((point, index) => point.values && <circle key={point.date} cx={x(index)} cy={y(point.values[key])} r="4" fill={colors[key]}>
              <title>{`${point.date} UTC · ${t(`systemMonitoring.${key}`)}: ${point.values[key].toLocaleString()}`}</title>
            </circle>)}
          </g>)}
        </svg>}
      </div>
    </div>
  </section>;
}
