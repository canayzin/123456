import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { consoleApi } from '../api/console';
import { ErrorBanner } from '../ui/ErrorBanner';

function save(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  URL.revokeObjectURL(u);
}

export function Exports() {
  const { projectId = '' } = useParams();
  const [error, setError] = useState<any>(null);
  const today = new Date().toISOString().slice(0, 10);
  return <div><h2>Exports</h2><ErrorBanner error={error} />
    <div className="grid3">
      <button onClick={async () => { try { save(await consoleApi.exportUsage(projectId, 0, Date.now(), 'json'), `usage-${projectId}.json`); } catch (e) { setError(e); } }}>Usage JSON</button>
      <button onClick={async () => { try { save(await consoleApi.exportAnalytics(projectId, today, 'ndjson'), `analytics-${projectId}.ndjson`); } catch (e) { setError(e); } }}>Analytics NDJSON</button>
      <button onClick={async () => { try { save(await consoleApi.exportInvoices(projectId, today.slice(0, 7), 'json'), `invoices-${projectId}.json`); } catch (e) { setError(e); } }}>Invoices JSON</button>
    </div>
  </div>;
}
