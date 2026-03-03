import { BaseSeries } from './BaseSeries';
export const MessagingSeries = ({ series }: { series: Array<Record<string, number | string>> }) => <BaseSeries title="Messaging" series={series} keyName="sends" />;
