import React from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({ data, width = 120, height = 32, color = '#818cf8', className }: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} className={className} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * w,
    y: pad + h - ((v - min) / range) * h,
  }));

  // Build SVG path
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  // Area fill path (close to bottom)
  const areaPath = linePath
    + ` L ${points[points.length - 1]!.x.toFixed(1)} ${(pad + h).toFixed(1)}`
    + ` L ${pad} ${(pad + h).toFixed(1)} Z`;

  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 6)}`;

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      {points[points.length - 1] && (
        <circle
          cx={points[points.length - 1]!.x}
          cy={points[points.length - 1]!.y}
          r="2.5"
          fill={color}
        />
      )}
    </svg>
  );
}
