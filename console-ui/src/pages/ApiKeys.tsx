import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { consoleApi } from '../api/console';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Pagination } from '../ui/Pagination';

export function ApiKeys() {
  const { projectId = '' } = useParams();
  const [items, setItems] = useState<any[]>([]); const [nextCursor, setNext] = useState(''); const [cursor, setCursor] = useState(''); const [limit, setLimit] = useState(50);
  const [error, setError] = useState<any>(null);
  useEffect(() => { consoleApi.apiKeys(projectId, limit, cursor).then((x) => { setItems(x.items); setNext(x.nextCursor); }).catch(setError); }, [projectId, limit, cursor]);
  return <div><h2>API Keys</h2><ErrorBanner error={error} /><table><thead><tr><th>keyId</th><th>type</th><th>revoked</th></tr></thead><tbody>{items.map((r) => <tr key={r.keyId}><td>{r.keyId}</td><td>{r.type}</td><td>{String(r.revoked)}</td></tr>)}</tbody></table><Pagination limit={limit} setLimit={setLimit} nextCursor={nextCursor} onNext={() => setCursor(nextCursor)} /></div>;
}
