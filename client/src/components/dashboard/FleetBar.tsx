import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * The fleet, as one bar.
 *
 * This replaces six equally-sized tiles in six different colours. Six tiles
 * answered "how many are locked" but never "how much of my fleet is that",
 * which is the question a dealer is really asking — and giving each tile its own
 * hue made a healthy fleet and a failing one look equally busy.
 *
 * Part-to-whole, so the shape of the bar *is* the answer, with the counts spelled
 * out underneath. Each segment is a link into the filtered device list.
 */

export interface FleetSegment {
  key: string;
  label: string;
  count: number;
  /** Device-list filter this segment leads to. */
  status: string;
  /** Tone, not decoration: healthy states are quiet, trouble is loud. */
  tone: 'positive' | 'caution' | 'critical' | 'neutral' | 'accent';
}

const FILL: Record<FleetSegment['tone'], string> = {
  positive: 'bg-positive-600',
  caution: 'bg-caution-600',
  critical: 'bg-critical-600',
  accent: 'bg-accent-600',
  neutral: 'bg-paper-400',
};

const DOT: Record<FleetSegment['tone'], string> = {
  positive: 'bg-positive-600',
  caution: 'bg-caution-600',
  critical: 'bg-critical-600',
  accent: 'bg-accent-600',
  neutral: 'bg-paper-400',
};

export const FleetBar: React.FC<{ segments: FleetSegment[]; total: number }> = ({
  segments,
  total,
}) => {
  const navigate = useNavigate();
  const shown = segments.filter((s) => s.count > 0);
  const sum = shown.reduce((acc, s) => acc + s.count, 0) || 1;

  return (
    <div>
      {/* 2px of surface between segments, so adjacent tones never bleed together. */}
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-paper-200">
        {shown.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(`/devices?status=${s.status}`)}
            style={{ width: `${(s.count / sum) * 100}%` }}
            className={`${FILL[s.tone]} h-full rounded-full transition-opacity hover:opacity-80`}
            aria-label={`${s.count} ${s.label} devices`}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>

      {/* One state per line. This card sits in a ~230px column, and a two- or
          three-column legend wrapped "Awaiting QR" onto a second line while
          leaving its count stranded — cramped enough to look broken. */}
      <ul className="mt-4 space-y-1.5">
        {segments.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => navigate(`/devices?status=${s.status}`)}
              className="group flex w-full items-baseline gap-2 text-left"
            >
              <span className={`${DOT[s.tone]} h-2 w-2 shrink-0 translate-y-[-1px] rounded-full`} />
              <span className="truncate text-caption text-ink-500 group-hover:text-ink-900">
                {s.label}
              </span>
              <span className="ml-auto text-body font-medium text-ink-900 tabular">{s.count}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-paper-300 pt-3 text-caption text-ink-400">
        {total} {total === 1 ? 'device' : 'devices'} financed in total
      </p>
    </div>
  );
};
