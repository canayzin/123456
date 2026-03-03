import type { DateRange as DR } from '../api/types';
export function DateRange({ value, onChange }: { value: DR; onChange: (v: DR) => void }) {
  return <div className="row gap"><input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} /><input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} /></div>;
}
