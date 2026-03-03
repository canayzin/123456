import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { consoleApi } from '../api/console';
import type { ApiError, DateRange as DR, ProjectOverview as T } from '../api/types';
import { DateRange } from '../ui/DateRange';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Spinner } from '../ui/Spinner';
import { AnalyticsSeries } from '../charts/AnalyticsSeries';
import { MessagingSeries } from '../charts/MessagingSeries';
import { StorageSeries } from '../charts/StorageSeries';
import { BillingSeries } from '../charts/BillingSeries';

export function ProjectOverview() {
  const { projectId = '' } = useParams();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [r, setR] = useState<DR>(() => {
    const to = new Date(); const from = new Date(Date.now() - 6 * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const [series, setSeries] = useState<any>({ a: [], m: [], s: [], b: [] });
  useEffect(() => {
    setLoading(true); setError(null);
    Promise.all([
      consoleApi.projectOverview(projectId, r),
      consoleApi.chartAnalytics(projectId, r),
      consoleApi.chartMessaging(projectId, r),
      consoleApi.chartStorage(projectId, r),
      consoleApi.chartBilling(projectId, r)
    ]).then(([ov, a, m, s, b]) => { setData(ov); setSeries({ a: a.series, m: m.series, s: s.series, b: b.series }); }).catch(setError).finally(() => setLoading(false));
  }, [projectId, r]);

  return <div><h2>Project Overview</h2><DateRange value={r} onChange={setR} /><ErrorBanner error={error} />{loading ? <Spinner /> : null}
    {data ? <div className="grid3"><div className="card">Env: {data.project.env}</div><div className="card">Region: {data.project.region}</div><div className="card">Queue: {data.health.queueDepth}</div></div> : null}
    <div className="grid2"><AnalyticsSeries series={series.a} /><MessagingSeries series={series.m} /><StorageSeries series={series.s} /><BillingSeries series={series.b} /></div>
    <div className="grid3">
      <Link to={`/projects/${projectId}/apikeys`}>API Keys</Link>
      <Link to={`/projects/${projectId}/hosting`}>Hosting</Link>
      <Link to={`/projects/${projectId}/remoteconfig`}>RemoteConfig</Link>
      <Link to={`/projects/${projectId}/messaging/receipts`}>Receipts</Link>
      <Link to={`/projects/${projectId}/messaging/dlq`}>DLQ</Link>
      <Link to={`/projects/${projectId}/appcheck/denies`}>AppCheck Denies</Link>
    </div>
  </div>;
}
