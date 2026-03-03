import { BaseSeries } from './BaseSeries';
export const BillingSeries = ({ series }: { series: Array<Record<string, number | string>> }) => <BaseSeries title="Billing" series={series} keyName="estimatedCents" />;
