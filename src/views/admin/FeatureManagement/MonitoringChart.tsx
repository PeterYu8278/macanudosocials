import { useState } from 'react';
import { Checkbox, Empty, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { MetricRow } from '@/services/firebase/monitoringQueue';
import './MonitoringChart.css';

const series = ['reads', 'writes', 'deletes'] as const;
type Series = typeof series[number];
const colors = { reads: '#5796ff', writes: '#ffab32', deletes: '#ff6fa4' };
type DailyPoint = { date: string; values: Record<Series, number> | null };
type MonitoringRow = MetricRow & { date: string; hour?: string };

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

export function hourlyMonitoringPoints(rows: MonitoringRow[], days: number, now = new Date()): DailyPoint[] {
  const totals = new Map<string, Record<Series, number>>();
  for (const row of rows) {
    if (!row.hour || !/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(row.hour)) continue;
    const value = totals.get(row.hour) || { reads: 0, writes: 0, deletes: 0 };
    for (const key of series) value[key] += row[key];
    totals.set(row.hour, value);
  }
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1);
  const count = (days - 1) * 24 + now.getUTCHours() + 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start + index * 3600000).toISOString().slice(0, 13);
    return { date, values: totals.get(date) || null };
  });
}

export default function MonitoringChart({ rows, days, loading, granularity = 'day' }: {
  rows: MonitoringRow[]; days: number; loading: boolean; granularity?: 'day' | 'hour';
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState<Record<Series, boolean>>({ reads: true, writes: true, deletes: true });
  const hourly = granularity === 'hour';
  const axisLabel = t(hourly ? 'systemMonitoring.hourlyOperations' : 'systemMonitoring.dailyOperations');
  const points = hourly ? hourlyMonitoringPoints(rows, days) : dailyMonitoringPoints(rows, days);
  const labelIndexes = new Set(Array.from({ length: 6 }, (_, index) => Math.round(index * (points.length - 1) / 5)));
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
          <strong style={{ color: colors[key] }}>{loading ? '--' : totals[key].toLocaleString()}</strong>
        </div>)}
      </div>
      <div className="monitoring-trend-plot">
        {loading ? <Spin /> : !hasData ? <Empty description={t(hourly ? 'systemMonitoring.hourlyEmpty' : 'systemMonitoring.empty')} /> : <svg viewBox="0 0 630 265" role="img" aria-label={axisLabel}>
          {[0, 1, 2, 3, 4].map(tick => <g key={tick}>
            <line x1="65" x2="600" y1={y(ceiling * tick / 4)} y2={y(ceiling * tick / 4)} stroke="currentColor" opacity="0.15" />
            <text x="55" y={y(ceiling * tick / 4) + 4} textAnchor="end">{(ceiling * tick / 4).toLocaleString()}</text>
          </g>)}
          {points.map((point, index) => labelIndexes.has(index) &&
            <text key={point.date} x={x(index)} y="232" textAnchor="middle">
              {hourly ? days === 1 ? point.date.slice(11) + ':00' : point.date.slice(5).replace('T', ' ') + 'h' : point.date.slice(5)}
            </text>)}
          <text x="330" y="258" textAnchor="middle">{axisLabel}</text>
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
