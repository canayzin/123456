function toPoints(series: Array<Record<string, number | string>>, key: string, w = 360, h = 120) {
  const vals = series.map((x) => Number(x[key] || 0));
  const max = Math.max(1, ...vals);
  return series.map((x, i) => {
    const px = (i / Math.max(1, series.length - 1)) * (w - 20) + 10;
    const py = h - (Number(x[key] || 0) / max) * (h - 20) - 10;
    return `${px},${py}`;
  }).join(' ');
}

export function BaseSeries({ title, series, keyName }: { title: string; series: Array<Record<string, number | string>>; keyName: string }) {
  return <div className="card"><h4>{title}</h4><svg width="360" height="120"><polyline fill="none" stroke="#1a73e8" strokeWidth="2" points={toPoints(series, keyName)} /></svg></div>;
}
