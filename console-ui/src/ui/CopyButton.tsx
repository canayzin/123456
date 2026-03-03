export function CopyButton({ text }: { text: string }) { return <button onClick={() => navigator.clipboard.writeText(text)}>Copy</button>; }
