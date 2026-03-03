import { BaseSeries } from './BaseSeries';
export const StorageSeries = ({ series }: { series: Array<Record<string, number | string>> }) => <BaseSeries title="Storage" series={series} keyName="bytesWritten" />;
