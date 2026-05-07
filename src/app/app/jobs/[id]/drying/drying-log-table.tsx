interface LogRow {
  id: string;
  logDate: Date;
  outsideTempF: number | null;
  outsideRH: number | null;
  outsideGPP: number | null;
  unaffectedTempF: number | null;
  unaffectedRH: number | null;
  unaffectedGPP: number | null;
  affectedTempF: number | null;
  affectedRH: number | null;
  affectedGPP: number | null;
  hvacTempF: number | null;
  hvacRH: number | null;
  hvacGPP: number | null;
  techNotes: string | null;
}

export function DryingLogTable({ logs }: { logs: LogRow[] }) {
  if (logs.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-sm text-muted-foreground">
        No drying-log entries yet. Today&apos;s row appears automatically once
        you save the first reading on this job.
      </p>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead className="border-b text-left uppercase text-muted-foreground">
        <tr>
          <th className="px-4 py-3" rowSpan={2}>Date</th>
          <th className="px-2 py-2 text-center" colSpan={3}>Outside</th>
          <th className="px-2 py-2 text-center" colSpan={3}>Unaffected</th>
          <th className="px-2 py-2 text-center" colSpan={3}>Affected</th>
          <th className="px-2 py-2 text-center" colSpan={3}>HVAC</th>
          <th className="px-4 py-3" rowSpan={2}>Notes</th>
        </tr>
        <tr>
          {Array.from({ length: 4 }).map((_, i) => (
            <Tri key={i} />
          ))}
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => (
          <tr key={log.id} className="border-b last:border-b-0">
            <td className="px-4 py-2 font-medium">
              {log.logDate.toISOString().slice(0, 10)}
            </td>
            <Cell t={log.outsideTempF} r={log.outsideRH} g={log.outsideGPP} />
            <Cell
              t={log.unaffectedTempF}
              r={log.unaffectedRH}
              g={log.unaffectedGPP}
            />
            <Cell t={log.affectedTempF} r={log.affectedRH} g={log.affectedGPP} />
            <Cell t={log.hvacTempF} r={log.hvacRH} g={log.hvacGPP} />
            <td className="max-w-xs px-4 py-2 text-muted-foreground">
              {log.techNotes ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tri() {
  return (
    <>
      <th className="px-1 py-1 text-center font-normal">°F</th>
      <th className="px-1 py-1 text-center font-normal">RH%</th>
      <th className="px-1 py-1 text-center font-normal">GPP</th>
    </>
  );
}

function Cell({
  t,
  r,
  g,
}: {
  t: number | null;
  r: number | null;
  g: number | null;
}) {
  return (
    <>
      <td className="px-1 py-2 text-center tabular-nums">{fmt(t)}</td>
      <td className="px-1 py-2 text-center tabular-nums">{fmt(r)}</td>
      <td className="px-1 py-2 text-center tabular-nums">{fmt(g)}</td>
    </>
  );
}

function fmt(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(1);
}
