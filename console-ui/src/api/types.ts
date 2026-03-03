export type CursorPage<T> = { items: T[]; nextCursor: string };

export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  status?: number;
};

export type DateRange = { from: string; to: string };

export type OrgOverview = {
  org: { orgId: string; name: string; plan: string; status: string };
  projects: { active: number; deleted: number };
  billing: { revenueCents: number; currentMonthEstimateCents: number };
  usage: { analyticsEvents: number; messagingSends: number; storageBytes: number; functionsInvocations: number };
  topProjects: Array<{ projectId: string; events: number }>;
  alerts: { budget: number; quotaDenies: number; appcheckDenies: number };
};

export type ProjectOverview = {
  project: { projectId: string; env: string; region: string; status: string };
  usage: Record<string, number>;
  billing: { plan: string; monthToDateEstimateCents: number; lastInvoiceTotal: number };
  health: { realtimeConnectionsActive: number; queueDepth: number; storageObjectsCount: number; recentErrors: number };
  config: { activeHostingReleaseId: string; remoteconfigVersion: number; appcheckEnforcementSummary: Record<string, unknown> };
};

export type SeriesResponse = { series: Array<Record<string, number | string>> };
