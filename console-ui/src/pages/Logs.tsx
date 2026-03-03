import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { consoleApi } from '../api/console';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Pagination } from '../ui/Pagination';

const mask = (s: string) => s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[REDACTED_EMAIL]').replace(/(pk_live_|sk_live_|dbg_[a-zA-Z0-9_\-]+)/g, '[REDACTED_TOKEN]');

export function Logs() {
  const { projectId = '' } = useParams();
  const [items, setItems] = useState<any[]>([]); const [nextCursor, setNext] = useState(''); const [cursor, setCursor] = useState(''); const [limit, setLimit] = useState(50);
  const [type, setType] = useState('audit'); const [q, setQ] = useState('');
  const [error, setError] = useState<any>(null);
  useEffect(() => {
    consoleApi.logs(projectId, type, 0, Date.now(), limit, cursor).then((x) => { setItems(x.items); setNext(x.nextCursor); }).catch(setError);
  }, [projectId, type, limit, cursor]);
  const filtered = useMemo(() => items.filter((x) => mask(JSON.stringify(x)).toLowerCase().includes(q.toLowerCase())), [items, q]);
  return <div><h2>Logs</h2><div className="row gap"><select value={type} onChange={(e) => setType(e.target.value)}><option value="audit">audit</option><option value="billing">billing</option><option value="messaging">messaging</option><option value="remoteconfig">remoteconfig</option><option value="appcheck">appcheck</option></select><input placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <ErrorBanner error={error} /><pre>{JSON.stringify(filtered.map((x) => JSON.parse(mask(JSON.stringify(x)))), null, 2)}</pre><Pagination limit={limit} setLimit={setLimit} nextCursor={nextCursor} onNext={() => setCursor(nextCursor)} /></div>;
}
