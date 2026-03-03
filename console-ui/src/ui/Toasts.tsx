import { createContext, useContext, useState } from 'react';

export type Toast = { kind: 'success' | 'error'; text: string };
const Ctx = createContext<{ push: (t: Toast) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = (t: Toast) => { setItems((x) => [...x, t]); setTimeout(() => setItems((x) => x.slice(1)), 2800); };
  return <Ctx.Provider value={{ push }}>
    {children}
    <div className="toasts">{items.map((t, i) => <div key={i} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
  </Ctx.Provider>;
}

export function useToasts() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
}
