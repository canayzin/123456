import { BaseSeries } from './BaseSeries';
export const AnalyticsSeries = ({ series }: { series: Array<Record<string, number | string>> }) => <BaseSeries title="Analytics Events" series={series} keyName="eventsTotal" />;
