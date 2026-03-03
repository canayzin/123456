import type { ApiError } from '../api/types';
export function ErrorBanner({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return <div className="error-banner">{error.message} ({error.code}) {error.requestId ? `requestId=${error.requestId}` : ''}</div>;
}
