import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { consoleApi } from '../api/console';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Pagination } from '../ui/Pagination';

export function ProjectsList() {
  const { orgId = '' } = useParams();
  const [items, setItems] = useState<any[]>([]); const [nextCursor, setNext] = useState(''); const [cursor, setCursor] = useState(''); const [limit, setLimit] = useState(50);
  const [error, setError] = useState<any>(null);
  useEffect(() => { consoleApi.orgProjects(orgId, 'all', limit, cursor).then((x) => { setItems(x.items); setNext(x.nextCursor); }).catch(setError); }, [orgId, limit, cursor]);
  return <div><h2>Projects</h2><ErrorBanner error={error} /><table><thead><tr><th>projectId</th><th>status</th></tr></thead><tbody>{items.map((r) => <tr key={r.projectId}><td>{r.projectId}</td><td>{r.status}</td></tr>)}</tbody></table><Pagination limit={limit} setLimit={setLimit} nextCursor={nextCursor} onNext={() => setCursor(nextCursor)} /></div>;
}
