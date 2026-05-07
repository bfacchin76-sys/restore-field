"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface SeriesPoint {
  t: string;
  value: number;
  isDryGoal: boolean;
}

interface SeriesVm {
  key: string;
  surface: string;
  roomName: string | null;
  dryGoalValue: number | null;
  reachedGoal: boolean;
  stuck: boolean;
  daysWithoutProgress: number;
  points: SeriesPoint[];
}

export function SurfaceCharts({ series }: { series: SeriesVm[] }) {
  if (series.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Once you log readings, each surface gets a time-series chart here.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {series.map((s) => (
        <SurfaceChart key={s.key} series={s} />
      ))}
    </div>
  );
}

function SurfaceChart({ series }: { series: SeriesVm }) {
  const goal = series.dryGoalValue;
  // Recharts wants numeric x for line continuity — use ms.
  const data = series.points.map((p) => ({
    ms: new Date(p.t).getTime(),
    value: p.value,
    isDryGoal: p.isDryGoal,
  }));

  const lineColor = series.reachedGoal
    ? "#059669" // emerald-600
    : series.stuck
      ? "#dc2626" // red-600
      : "#1e3a8a"; // primary

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{series.surface}</p>
          <p className="text-[11px] uppercase text-muted-foreground">
            {series.roomName ?? "unassigned"}
            {goal != null ? ` · goal ${goal.toFixed(1)}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end text-[11px]">
          {series.reachedGoal ? (
            <span className="text-emerald-700">✓ reached goal</span>
          ) : series.stuck ? (
            <span className="text-red-700">
              stuck · {series.daysWithoutProgress}d
            </span>
          ) : (
            <span className="text-muted-foreground">in progress</span>
          )}
        </div>
      </header>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="ms"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(ms) => fmtDate(ms as number)}
              fontSize={10}
              stroke="#94a3b8"
            />
            <YAxis fontSize={10} stroke="#94a3b8" />
            <Tooltip
              labelFormatter={(ms) => new Date(ms as number).toLocaleString()}
              formatter={(v) => [(v as number).toFixed(1), "%MC"]}
            />
            {goal != null ? (
              <ReferenceLine
                y={goal}
                stroke="#059669"
                strokeDasharray="3 3"
                label={{
                  value: "goal",
                  position: "right",
                  fontSize: 10,
                  fill: "#059669",
                }}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="value"
              stroke={lineColor}
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
