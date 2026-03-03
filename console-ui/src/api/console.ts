import { download, http } from './http';
import type { CursorPage, DateRange, OrgOverview, ProjectOverview, SeriesResponse } from './types';

const q = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') sp.set(k, String(v)); });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const consoleApi = {
  orgOverview: (orgId: string, r: DateRange) => http<OrgOverview>(`/v1/console/orgs/${orgId}/overview${q(r)}`),
  orgProjects: (orgId: string, status: string, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/orgs/${orgId}/projects${q({ status, limit, cursor })}`),

  projectOverview: (projectId: string, r: DateRange) => http<ProjectOverview>(`/v1/console/projects/${projectId}/overview${q(r)}`),
  chartAnalytics: (projectId: string, r: DateRange) => http<SeriesResponse>(`/v1/console/projects/${projectId}/charts/analytics/events${q(r)}`),
  chartMessaging: (projectId: string, r: DateRange) => http<SeriesResponse>(`/v1/console/projects/${projectId}/charts/messaging${q(r)}`),
  chartStorage: (projectId: string, r: DateRange) => http<SeriesResponse>(`/v1/console/projects/${projectId}/charts/storage${q(r)}`),
  chartBilling: (projectId: string, r: DateRange) => http<SeriesResponse>(`/v1/console/projects/${projectId}/charts/billing${q(r)}`),

  apiKeys: (projectId: string, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/projects/${projectId}/apikeys${q({ limit, cursor })}`),
  hostingReleases: (projectId: string, siteId: string, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/projects/${projectId}/hosting/releases${q({ siteId, limit, cursor })}`),
  remoteConfigVersions: (projectId: string, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/projects/${projectId}/remoteconfig/versions${q({ limit, cursor })}`),
  messagingReceipts: (projectId: string, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/projects/${projectId}/messaging/receipts${q({ limit, cursor })}`),
  messagingDlq: (projectId: string, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/projects/${projectId}/messaging/dlq${q({ limit, cursor })}`),
  appcheckDenies: (projectId: string, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/projects/${projectId}/appcheck/denies${q({ limit, cursor })}`),

  logs: (projectId: string, type: string, from: number, to: number, limit: number, cursor = '') => http<CursorPage<any>>(`/v1/console/projects/${projectId}/logs${q({ type, from, to, limit, cursor })}`),

  exportUsage: (projectId: string, from: number, to: number, format: 'json' | 'ndjson') => download(`/v1/console/projects/${projectId}/exports/usage${q({ from, to, format })}`),
  exportAnalytics: (projectId: string, date: string, format: 'json' | 'ndjson') => download(`/v1/console/projects/${projectId}/exports/analytics${q({ date, format })}`),
  exportInvoices: (projectId: string, month: string, format: 'json' | 'ndjson') => download(`/v1/console/projects/${projectId}/exports/invoices${q({ month, format })}`)
};
