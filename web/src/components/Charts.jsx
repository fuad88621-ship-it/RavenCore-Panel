import React, { useMemo } from 'react';

// Lightweight SVG area chart — no chart library needed. Renders a smooth
// gradient area + line for a time series, with a hover tooltip.
export function AreaChart({ data, valueKey, height = 120, color = '#8b5cf6', format = (v) => v, max = null }) {
  const [hover, setHover] = React.useState(null);

  const { points, path, areaPath, yMax, xStep } = useMemo(() => {
    const values = (data || []).map((d) => Number(d[valueKey]) || 0);
    if (values.length === 0) return { points: [], path: '', areaPath: '', yMax: 1, xStep: 0 };
    const rawMax = Math.max(...values);
    const yMax = max || (rawMax > 0 ? rawMax * 1.15 : 1);
    const w = 100; // normalized width
    const h = 100;
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const pts = values.map((v, i) => ({
      x: values.length > 1 ? (i / (values.length - 1)) * w : 50,
      y: h - (Math.min(v, yMax) / yMax) * h,
      v,
    }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const area = `${line} L100,100 L0,100 Z`;
    return { points: pts, path: line, areaPath: area, yMax, xStep: step };
  }, [data, valueKey, max]);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center text-xs text-zinc-600">
        No data yet — waiting for samples…
      </div>
    );
  }

  const hovered = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-[120px] w-full"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`grad-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* grid lines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="0" x2="100" y1={g * 100} y2={g * 100} stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={areaPath} fill={`url(#grad-${valueKey})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {/* hover hit area */}
        {points.map((p, i) => (
          <rect
            key={i}
            x={p.x - (xStep / 2 || 2)}
            y="0"
            width={xStep || 4}
            height="100"
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hovered && (
          <line x1={hovered.x} x2={hovered.x} y1="0" y2="100" stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg border border-white/10 bg-[#12121a] px-2 py-1 text-[11px] font-medium text-white shadow-xl"
          style={{ left: `${hovered.x}%` }}
        >
          {format(hovered.v)}
        </div>
      )}
    </div>
  );
}

// Tiny sparkline for compact cards (no hover).
export function Sparkline({ data, valueKey, height = 40, color = '#8b5cf6' }) {
  const path = useMemo(() => {
    const values = (data || []).map((d) => Number(d[valueKey]) || 0);
    if (values.length === 0) return '';
    const yMax = Math.max(...values, 1);
    const w = 100;
    const h = 100;
    return values.map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * w : 50;
      const y = h - (Math.min(v, yMax) / yMax) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }, [data, valueKey]);

  if (!data || data.length === 0) return <div className="h-[40px]" />;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`h-[${height}px] w-full`}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
