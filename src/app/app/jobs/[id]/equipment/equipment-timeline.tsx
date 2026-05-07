"use client";

import type { EquipmentType } from "@prisma/client";

interface PlacementVm {
  id: string;
  assetTag: string;
  type: EquipmentType;
  placedAt: string;
  removedAt: string | null;
}

interface DailyCount {
  day: string; // yyyy-mm-dd
  total: number;
}

const ROW_H = 18;
const ROW_GAP = 4;
const LEFT = 110;
const RIGHT = 16;
const TOP = 12;
const COUNT_BAR_H = 32;
const COUNT_BAR_GAP = 12;

const TYPE_COLOR: Record<EquipmentType, string> = {
  AIR_MOVER: "#1e3a8a",
  DEHUMIDIFIER_LGR: "#0f766e",
  DEHUMIDIFIER_REFRIGERANT: "#0f766e",
  DEHUMIDIFIER_DESICCANT: "#0f766e",
  AIR_SCRUBBER_HEPA: "#7e22ce",
  HEATER: "#dc2626",
  OZONE: "#a16207",
  HYDROXYL: "#a16207",
  THERMAL_FOGGER: "#a16207",
  DRYING_MAT: "#3f6212",
  OTHER: "#475569",
};

function startOfDay(d: Date): Date {
  const o = new Date(d);
  o.setUTCHours(0, 0, 0, 0);
  return o;
}

export function EquipmentTimeline({
  placements,
  counts,
}: {
  placements: PlacementVm[];
  counts: DailyCount[];
}) {
  if (placements.length === 0) return null;

  const now = new Date();
  const placedTimes = placements.map((p) => new Date(p.placedAt).getTime());
  const removedTimes = placements
    .map((p) => (p.removedAt ? new Date(p.removedAt).getTime() : now.getTime()));
  const minMs = Math.min(...placedTimes);
  const maxMs = Math.max(...removedTimes);
  const start = startOfDay(new Date(minMs));
  const end = startOfDay(new Date(maxMs + 1));
  const totalMs = Math.max(
    end.getTime() - start.getTime() + 24 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );

  // Compute day ticks
  const dayMs = 24 * 60 * 60 * 1000;
  const days: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
    days.push(new Date(t));
  }

  const width = 800;
  const innerW = width - LEFT - RIGHT;
  const xFor = (ms: number) =>
    LEFT + ((ms - start.getTime()) / totalMs) * innerW;

  // Group placements by equipmentId so the same physical unit gets one row.
  const groups = new Map<string, PlacementVm[]>();
  for (const p of placements) {
    const arr = groups.get(p.assetTag);
    if (arr) arr.push(p);
    else groups.set(p.assetTag, [p]);
  }
  const rows = Array.from(groups.entries());

  const rowsHeight = rows.length * (ROW_H + ROW_GAP);
  const height =
    TOP + rowsHeight + COUNT_BAR_GAP + COUNT_BAR_H + 24; // +24 for x-axis labels

  // Daily counts bar height scale
  const maxCount = Math.max(1, ...counts.map((c) => c.total));

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Equipment placement timeline"
        className="w-full text-[10px]"
      >
        {/* Day grid */}
        {days.map((d, i) => (
          <line
            key={i}
            x1={xFor(d.getTime())}
            x2={xFor(d.getTime())}
            y1={TOP - 2}
            y2={TOP + rowsHeight}
            stroke="rgba(0,0,0,0.06)"
          />
        ))}

        {/* Per-unit rows */}
        {rows.map(([assetTag, ps], rowIdx) => {
          const y = TOP + rowIdx * (ROW_H + ROW_GAP);
          return (
            <g key={assetTag}>
              <text
                x={LEFT - 6}
                y={y + ROW_H / 2 + 3}
                textAnchor="end"
                fill="#475569"
                fontFamily="monospace"
              >
                {assetTag}
              </text>
              {ps.map((p) => {
                const x1 = xFor(new Date(p.placedAt).getTime());
                const x2 = xFor(
                  p.removedAt
                    ? new Date(p.removedAt).getTime()
                    : now.getTime(),
                );
                return (
                  <rect
                    key={p.id}
                    x={x1}
                    y={y}
                    width={Math.max(2, x2 - x1)}
                    height={ROW_H}
                    fill={TYPE_COLOR[p.type] ?? TYPE_COLOR.OTHER}
                    opacity={p.removedAt ? 0.5 : 0.9}
                    rx={2}
                  >
                    <title>
                      {assetTag} — {p.type.replace(/_/g, " ").toLowerCase()}
                      {"\n"}
                      {new Date(p.placedAt).toLocaleString()} →{" "}
                      {p.removedAt
                        ? new Date(p.removedAt).toLocaleString()
                        : "active"}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        {/* Daily-count bars */}
        {counts.length > 0 ? (
          <>
            <text
              x={LEFT - 6}
              y={TOP + rowsHeight + COUNT_BAR_GAP + COUNT_BAR_H / 2 + 3}
              textAnchor="end"
              fill="#475569"
            >
              units / day
            </text>
            {counts.map((c) => {
              const dayStart = new Date(`${c.day}T00:00:00.000Z`).getTime();
              const x1 = xFor(dayStart);
              const x2 = xFor(dayStart + dayMs);
              const w = Math.max(0, x2 - x1 - 1);
              const barH = (c.total / maxCount) * COUNT_BAR_H;
              return (
                <g key={c.day}>
                  <rect
                    x={x1 + 0.5}
                    y={TOP + rowsHeight + COUNT_BAR_GAP + (COUNT_BAR_H - barH)}
                    width={w}
                    height={barH}
                    fill="#94a3b8"
                  />
                  {c.total > 0 ? (
                    <text
                      x={x1 + w / 2 + 0.5}
                      y={TOP + rowsHeight + COUNT_BAR_GAP + COUNT_BAR_H + 12}
                      textAnchor="middle"
                      fill="#475569"
                    >
                      {c.total}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </>
        ) : null}

        {/* Day labels */}
        {days.map((d, i) => (
          <text
            key={i}
            x={xFor(d.getTime() + dayMs / 2)}
            y={height - 4}
            textAnchor="middle"
            fill="#475569"
          >
            {d.getUTCMonth() + 1}/{d.getUTCDate()}
          </text>
        ))}
      </svg>
    </div>
  );
}
