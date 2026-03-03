import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { consoleApi } from '../api/console';
import { Pagination } from '../ui/Pagination';
import { ErrorBanner } from '../ui/ErrorBanner';

export function AppCheckDenies() {
  const { projectId = '' } = useParams();
  const [items, setItems] = useState<any[]>([]); const [nextCursor, setNext] = useState(''); const [cursor, setCursor] = useState(''); const [limit, setLimit] = useState(50);
  const [error, setError] = useState<any>(null);
  useEffect(() => { consoleApi.appcheckDenies(projectId, limit, cursor).then((x) => { setItems(x.items); setNext(x.nextCursor); }).catch(setError); }, [projectId, limit, cursor]);
  return <div><h2>AppCheck Denies</h2><ErrorBanner error={error} /><pre>{JSON.stringify(items, null, 2)}</pre><Pagination limit={limit} setLimit={setLimit} nextCursor={nextCursor} onNext={() => setCursor(nextCursor)} /></div>;
}
