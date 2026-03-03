import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { consoleApi } from '../api/console';
import type { ApiError, OrgOverview as T, DateRange as DR } from '../api/types';
import { DateRange } from '../ui/DateRange';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Spinner } from '../ui/Spinner';

export function OrgOverview() {
  const { orgId = '' } = useParams();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [r, setR] = useState<DR>(() => {
    const to = new Date(); const from = new Date(Date.now() - 6 * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true); setError(null);
    consoleApi.orgOverview(orgId, r).then(setData).catch(setError).finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [orgId, r]);
  return <div><h2>Org Overview</h2><DateRange value={r} onChange={setR} /><ErrorBanner error={error} />{loading ? <Spinner /> : null}
    {data ? <div className="grid3">
      <div className="card">Plan: {data.org.plan}</div><div className="card">Status: {data.org.status}</div><div className="card">Active Projects: {data.projects.active}</div>
      <div className="card">Events: {data.usage.analyticsEvents}</div><div className="card">Sends: {data.usage.messagingSends}</div><div className="card">Quota Denies: {data.alerts.quotaDenies}</div>
    </div> : null}
  </div>;
}
