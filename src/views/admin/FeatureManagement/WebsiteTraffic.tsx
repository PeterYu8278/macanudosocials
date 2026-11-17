import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Segmented, Select, Space, Statistic, Table, Tabs, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getAuth } from 'firebase/auth';
import dayjs from 'dayjs';
import { emptyTrafficCounts, trafficDay, trafficHour, type TrafficCounts } from '../../../utils/websiteTraffic';
import './WebsiteTraffic.css';

type Report = { counts: TrafficCounts; visitors: number; sessions: number; trend: Record<string, TrafficCounts>;
  pages: Record<string, TrafficCounts>; sources: Record<string, TrafficCounts>; campaigns: Record<string, TrafficCounts>; updatedAt: string | null;
  conversionUpdatedAt: string | null; conversionError: boolean; enabled: boolean; truncated: boolean;
  start: string; end: string; lounges: string[] };
const cache = new Map<string, { data: Report; until: number }>();
export default function WebsiteTraffic() {
  const { t } = useTranslation(), label = (key: string) => t(`websiteTraffic.${key}`);
  const today = trafficDay(Date.now());
  const [range, setRange] = useState<[string, string]>([today, today]), [lounge, setLounge] = useState('all');
  const [data, setData] = useState<Report | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const [revision, refresh] = useState(0), [resolution, setResolution] = useState('day');
  useEffect(() => {
    const abort = new AbortController(); let busy = false;
    const load = async () => {
      if (busy || abort.signal.aborted || document.visibilityState === 'hidden') return;
      busy = true; setLoading(true); setError(false);
      try {
        const user = getAuth().currentUser; if (!user) throw new Error('AUTH_REQUIRED');
        const key = `${user.uid}/${range.join('/')}/${lounge}`, saved = cache.get(key);
        if (saved && saved.until > Date.now()) { setData(saved.data); return; }
        const token = await user.getIdToken();
        const response = await fetch(`/api/website-traffic?start=${range[0]}&end=${range[1]}&lounge=${encodeURIComponent(lounge)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: abort.signal,
        });
        if (!response.ok) throw new Error('TRAFFIC_LOAD_FAILED');
        const result: Report = await response.json();
        if (!abort.signal.aborted) { setData(result); if (cache.size > 50) cache.clear(); cache.set(key, { data: result, until: Date.now() + 60000 }); }
      } catch { if (!abort.signal.aborted) setError(true); }
      finally { busy = false; if (!abort.signal.aborted) setLoading(false); }
    };
    void load(); const timer = setInterval(() => void load(), 65000);
    document.addEventListener('visibilitychange', load);
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [range[0], range[1], lounge, revision]);
  const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : label('notAvailable');
  const counts = data?.counts;
  const makeRows = (values?: Record<string, TrafficCounts>) => Object.entries(values || {}).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.page_view - a.page_view);
  const columns = [{ title: label('dimension'), dataIndex: 'key', render: (key: string) => t(`websiteTraffic.names.${key}`, { defaultValue: key }) },
    ...Object.keys(emptyTrafficCounts()).map(key => ({ title: label(key), dataIndex: key, sorter: (a: any, b: any) => a[key] - b[key] }))];
  const trend: Record<string, TrafficCounts> = {};
  if (data) {
    const stop = Math.min(Date.parse(data.end + 'T23:00:00+08:00'), Date.now());
    for (let at = Date.parse(data.start + 'T00:00:00+08:00'); at <= stop; at += 3600000) {
      trend[resolution === 'day' ? trafficDay(at) : trafficHour(at).replace('T', ' ') + ':00'] ||= emptyTrafficCounts();
    }
  }
  for (const [hour, values] of Object.entries(data?.trend || {})) {
    const key = resolution === 'day' ? hour.slice(0, 10) : hour.replace('T', ' ') + ':00';
    trend[key] ||= emptyTrafficCounts();
    for (const field of Object.keys(values) as (keyof TrafficCounts)[]) trend[key][field] += values[field];
  }
  const points = makeRows(trend).sort((a, b) => a.key.localeCompare(b.key));
  const max = Math.max(1, ...points.map(p => p.page_view));
  const polyline = points.map((p, i) => `${20 + i * 960 / Math.max(1, points.length - 1)},${150 - p.page_view / max * 130}`).join(' ');
  return <div className="website-traffic">
    <Alert type="info" showIcon message={label('method')} />
    <Space wrap>
      <Segmented aria-label={label('range')} options={[1, 7, 30].map(days => ({ label: label(`days${days}`), value: days }))}
        value={range[1] === today ? dayjs(range[1]).diff(dayjs(range[0]), 'day') + 1 : -1}
        onChange={days => setRange([trafficDay(Date.now() - (Number(days) - 1) * 86400000), today])} />
      <DatePicker.RangePicker allowClear={false} value={[dayjs(range[0]), dayjs(range[1])]} disabledDate={(date, info) => date.format('YYYY-MM-DD') > today || !!info.from && Math.abs(date.diff(info.from, 'day')) > 30}
        onChange={dates => { if (dates?.[0] && dates[1] && dates[1].diff(dates[0], 'day') <= 30) setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')]); }} />
      <Select aria-label={label('lounge')} value={lounge} style={{ minWidth: 160 }} onChange={setLounge}
        options={['all', ...new Set(['default', ...(data?.lounges || [])])].map(value => ({ value,
          label: value === 'all' ? label('allLounges') : value === 'default' ? 'Macanudo Socials Kota Kinabalu' : value === 'unassigned' ? label('unassigned') : value }))} />
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => { cache.clear(); refresh(v => v + 1); }}>{label('refresh')}</Button>
    </Space>
    {error && <Alert type="error" showIcon message={label('loadError')} />}
    {data?.truncated && <Alert type="warning" showIcon message={label('truncated')} />}
    {data && !data.enabled && <Alert type="warning" message={label('disabled')} />}
    <Typography.Text type="secondary">{label('shownRange')}: {data ? `${data.start} — ${data.end}` : '—'} · MYT · {label('lastEvent')}: {dateTime(data?.updatedAt || null)}</Typography.Text>
    <div className="website-traffic-metrics">
      {['page_view', 'visitors', 'sessions', 'engaged_visit', 'registration_success', 'membership_activated'].map(key => <Card key={key} size="small">
        <Statistic title={label(key)} value={data ? (key === 'visitors' || key === 'sessions' ? data[key] : counts?.[key as keyof TrafficCounts] || 0) : '—'} />
      </Card>)}
    </div>
    <Typography.Text type="secondary">{label('conversionRefresh')}: {dateTime(data?.conversionUpdatedAt || null)}</Typography.Text>
    {(!data?.conversionUpdatedAt || data?.conversionError) && <Alert showIcon type="warning" message={label('conversionPending')} />}
    <Tabs items={[
      { key: 'trend', label: label('trend'), children: <>
        <Segmented options={[{ value: 'day', label: label('perDay') }, { value: 'hour', label: label('perHour') }]} value={resolution} onChange={setResolution} />
        {!!points.length && <svg viewBox="0 0 1000 180" role="img" aria-label={label('trend')} className="website-traffic-chart"><polyline points={polyline} fill="none" stroke="var(--cigar-gradient-gold-fallback, #FDE08D)" strokeWidth="3" /><text x="20" y="175" fill="currentColor">{points[0]?.key}</text><text x="980" y="175" textAnchor="end" fill="currentColor">{points.at(-1)?.key}</text></svg>}
        <Table size="small" loading={loading} rowKey="key" dataSource={points} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 12 }} />
      </> },
      { key: 'pages', label: label('pages'), children: <Table size="small" rowKey="key" dataSource={makeRows(data?.pages)} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 10 }} /> },
      { key: 'sources', label: label('sources'), children: <><Alert type="info" showIcon message={label('attribution')} /><Table size="small" rowKey="key" dataSource={makeRows(data?.sources)} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 10 }} /></> },
      { key: 'campaigns', label: label('campaigns'), children: <><Alert type="info" message={label('campaignHelp')} /><Table size="small" rowKey="key" dataSource={makeRows(data?.campaigns)} columns={columns} scroll={{ x: 1100 }} pagination={{ pageSize: 10 }} /></> },
      { key: 'conversions', label: label('conversionActivity'), children: <>
        <Alert type="info" showIcon message={label('attribution')} />
        <ol className="website-traffic-stages">{['page_view', 'registration_start', 'registration_success', 'membership_activated'].map(key => {
          const linked = ['registration_success', 'membership_activated'].includes(key);
          const count = !data ? '—' : linked ? Object.entries(data.sources).filter(([source]) => source !== 'unknown')
            .reduce((sum, [, sourceCounts]) => sum + sourceCounts[key as keyof TrafficCounts], 0) : data.counts[key as keyof TrafficCounts];
          return <li key={key}><span>{label(key)}{linked && ` · ${label('linkedOnly')}`}</span><strong>{count}</strong></li>;
        })}</ol>
      </> },
    ]} />
  </div>;
}
