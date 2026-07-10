import Link from "next/link";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Pure server-rendered month grid — no client JS, navigation via ?month=YYYY-MM links. */
export function MonthCalendar({
  year,
  month, // 1-12
  activeDays, // Set of "YYYY-MM-DD" days that have upload activity
  baseHref,
}: {
  year: number;
  month: number;
  activeDays: Set<string>;
  baseHref: string;
}) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = first.getUTCDay();
  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const monthLabel = first.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Link
          href={`${baseHref}?month=${prev.y}-${pad(prev.m)}`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← prev
        </Link>
        <span className="text-sm font-medium">{monthLabel}</span>
        <Link
          href={`${baseHref}?month=${next.y}-${pad(next.m)}`}
          className="text-sm text-blue-600 hover:underline"
        >
          next →
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const active = activeDays.has(`${year}-${pad(month)}-${pad(day)}`);
          return (
            <div
              key={i}
              title={active ? "Creatives uploaded" : undefined}
              className={`flex h-9 items-center justify-center rounded-md text-sm ${
                active
                  ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                  : "text-gray-500"
              }`}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}
