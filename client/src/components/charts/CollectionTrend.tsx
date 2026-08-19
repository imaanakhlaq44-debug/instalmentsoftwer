import React, { useState } from 'react';
import { money, moneyShort } from '../../utils/format.js';

/**
 * Collected against overdue exposure, by month.
 *
 * What stood here before was a row of coloured divs against a hardcoded
 * `maxVal = 850000`, so a good month and a catastrophic one drew the same bar
 * once they passed that ceiling. This is a real plot: an axis derived from the
 * data, the shop's own monthly target as a reference line, and a tooltip —
 * because the question a dealer actually asks is "which month, and how much".
 *
 * Two series, and they are the two that matter. The colours were validated for
 * colour-vision deficiency (adjacent ΔE 21.6 protan, 32.3 normal vision) and
 * both are named in the legend, so the chart never asks anyone to decode a hue.
 */

export interface TrendPoint {
  month: string;
  collection: number;
  overdue: number;
  target: number;
  paymentCount: number;
}

/*
 * The viewBox is kept close to the width this chart is actually rendered at
 * (~490px at 1040 viewport, ~640 on a wide monitor). At 720 the whole plot was
 * being scaled down by a third and the axis labels landed at about 7px — a
 * legible size in the source and unreadable on screen.
 */
const W = 560;
const H = 220;
const PAD = { top: 18, right: 8, bottom: 32, left: 50 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** A round number at or above the data, so the axis reads in whole lakhs. */
function niceCeiling(max: number): number {
  if (max <= 0) return 100_000;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil(max / (magnitude / 2)) * (magnitude / 2);
}

export const CollectionTrend: React.FC<{ data: TrendPoint[] }> = ({ data }) => {
  const [hovered, setHovered] = useState<number | null>(null);

  if (!data.length) return null;

  const target = data.find((d) => d.target > 0)?.target ?? 0;
  const ceiling = niceCeiling(Math.max(...data.flatMap((d) => [d.collection, d.overdue]), target));
  const ticks = [0, ceiling / 2, ceiling];

  const slot = PLOT_W / data.length;
  const barW = Math.min(22, (slot - 14) / 2);
  const y = (value: number) => PAD.top + PLOT_H - (value / ceiling) * PLOT_H;

  const active = hovered !== null ? data[hovered] : null;

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label="Monthly collections against overdue exposure"
        >
          {/* Grid: recessive, and only where a value is actually read off. */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="#E6E3DC"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 10}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-ink-400"
                style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
              >
                {t === 0 ? '0' : moneyShort(t)}
              </text>
            </g>
          ))}

          {/* The shop's monthly target — the line the columns are reaching for. */}
          {target > 0 && (
            <g>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(target)}
                y2={y(target)}
                stroke="#8C8880"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <text
                x={W - PAD.right}
                y={y(target) - 6}
                textAnchor="end"
                className="fill-ink-400"
                style={{ fontSize: 11, letterSpacing: '0.04em' }}
              >
                TARGET {moneyShort(target)}
              </text>
            </g>
          )}

          {data.map((d, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const isActive = hovered === i;
            return (
              <g key={d.month}>
                {isActive && (
                  <rect
                    x={PAD.left + slot * i}
                    y={PAD.top}
                    width={slot}
                    height={PLOT_H}
                    fill="#EFEDE8"
                    opacity={0.7}
                  />
                )}

                {/* Collected — anchored to the baseline, rounded at the data end. */}
                <rect
                  x={cx - barW - 1}
                  y={y(d.collection)}
                  width={barW}
                  height={Math.max(0, PAD.top + PLOT_H - y(d.collection))}
                  rx={4}
                  fill="#2a78d6"
                  opacity={hovered === null || isActive ? 1 : 0.45}
                />
                {/* Overdue exposure, 2px of surface away from it. */}
                <rect
                  x={cx + 1}
                  y={y(d.overdue)}
                  width={barW}
                  height={Math.max(0, PAD.top + PLOT_H - y(d.overdue))}
                  rx={4}
                  fill="#e34948"
                  opacity={hovered === null || isActive ? 1 : 0.45}
                />

                <text
                  x={cx}
                  y={H - 12}
                  textAnchor="middle"
                  className={isActive ? 'fill-ink-700' : 'fill-ink-400'}
                  style={{ fontSize: 12 }}
                >
                  {d.month.split(' ')[0]}
                </text>

                {/* The hit area is the whole column, not the 22px bar. */}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={PLOT_H}
                  fill="transparent"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              </g>
            );
          })}

          {/* Baseline last, so it sits over the bars' rounded feet. */}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + PLOT_H}
            y2={PAD.top + PLOT_H}
            stroke="#D5D1C7"
            strokeWidth={1}
          />
        </svg>

        {active && hovered !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border
                       border-paper-300 bg-paper-50 px-3 py-2 shadow-overlay min-w-[9.5rem]"
            style={{
              // Centred on the hovered column, but held far enough from either
              // edge that the tooltip's own width cannot push it outside the
              // card — which is what happened on the newest month, the one
              // anybody actually hovers first.
              left: `${clamp(((PAD.left + slot * hovered + slot / 2) / W) * 100, 17, 83)}%`,
              top: 0,
            }}
          >
            <p className="text-caption font-medium text-ink-900">{active.month}</p>
            <dl className="mt-1.5 space-y-1">
              <div className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-1.5 text-caption text-ink-500">
                  <span className="h-2 w-2 rounded-full" style={{ background: '#2a78d6' }} />
                  Collected
                </dt>
                <dd className="text-caption font-medium text-ink-900 tabular">
                  {money(active.collection)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-1.5 text-caption text-ink-500">
                  <span className="h-2 w-2 rounded-full" style={{ background: '#e34948' }} />
                  Overdue
                </dt>
                <dd className="text-caption font-medium text-ink-900 tabular">
                  {money(active.overdue)}
                </dd>
              </div>
            </dl>
            <p className="mt-1.5 border-t border-paper-300 pt-1.5 text-micro text-ink-400">
              {active.paymentCount} {active.paymentCount === 1 ? 'payment' : 'payments'}
            </p>
          </div>
        )}
      </div>

      {/* The same figures as a table, for anyone who cannot read the plot. */}
      <table className="sr-only">
        <caption>Monthly collections against overdue exposure</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Collected</th>
            <th>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <td>{d.month}</td>
              <td>{money(d.collection)}</td>
              <td>{money(d.overdue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
};

/** The chart's key. Rendered in the card header, beside the title. */
export const CollectionTrendLegend: React.FC = () => (
  <div className="flex items-center gap-4">
    {[
      { label: 'Collected', color: '#2a78d6' },
      { label: 'Overdue', color: '#e34948' },
    ].map((s) => (
      <span key={s.label} className="flex items-center gap-1.5 text-caption text-ink-500">
        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
        {s.label}
      </span>
    ))}
  </div>
);
