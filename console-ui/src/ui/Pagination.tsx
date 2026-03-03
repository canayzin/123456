export function Pagination({ limit, setLimit, nextCursor, onNext }: { limit: number; setLimit: (n: number) => void; nextCursor: string; onNext: () => void }) {
  return <div className="row gap">
    <label>Limit <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}><option>50</option><option>100</option><option>200</option></select></label>
    <button onClick={onNext} disabled={!nextCursor}>Next</button>
  </div>;
}
