import { format, parseISO } from 'date-fns';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COLORS = {
  success: '#7da889',
  warning: '#d8a54a',
  critical: '#d0705f',
  info: '#8ca6b8',
  muted: '#6f776a',
  line: '#d7dbc7',
  grid: 'rgba(255,255,255,0.055)',
};

function axisFormat(value: string): string {
  try {
    return format(parseISO(value), 'HH:mm');
  } catch {
    return '';
  }
}

function axisDate(value: string): string {
  try {
    return format(parseISO(value), 'dd MMM');
  } catch {
    return '';
  }
}

function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string; name?: string; color?: string }>;
  label?: string;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-dialog">
      {label ? (
        <p className="mb-1 text-2xs text-muted-foreground">
          {(() => {
            try {
              return format(parseISO(label), 'dd MMM yyyy, HH:mm');
            } catch {
              return label;
            }
          })()}
        </p>
      ) : null}
      {payload.map((item) => (
        <p key={item.name} className="flex items-center gap-2 text-foreground">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="text-muted-foreground">{item.name}</span>
          <span className="ml-auto font-mono text-2xs">
            {typeof item.value === 'number'
              ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : item.value}
            {suffix ?? ''}
          </span>
        </p>
      ))}
    </div>
  );
}

export function UptimeChart({
  data,
  height = 220,
  showLatency = true,
}: {
  data: Array<{ timestamp: string; uptime: number; avgLatencyMs: number | null; checks?: number }>;
  height?: number;
  showLatency?: boolean;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
        No uptime samples in this window.
      </div>
    );
  }
  const spanMs =
    new Date(data[data.length - 1].timestamp).getTime() - new Date(data[0].timestamp).getTime();
  const longRange = spanMs > 2 * 24 * 60 * 60 * 1000;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="uptime-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.success} stopOpacity={0.24} />
            <stop offset="100%" stopColor={COLORS.success} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={longRange ? axisDate : axisFormat}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(value) => `${value}%`}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip content={<ChartTooltip suffix="%" />} />
        <Area
          type="monotone"
          dataKey="uptime"
          name="Uptime"
          stroke={COLORS.success}
          strokeWidth={1.8}
          fill="url(#uptime-fill)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: COLORS.success }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MetricChart({
  data,
  dataKey,
  name,
  suffix = '',
  color = COLORS.line,
  height = 180,
  tickFormatter,
}: {
  data: Array<{ timestamp: string; [key: string]: string | number | null }>;
  dataKey: string;
  name: string;
  suffix?: string;
  color?: string;
  height?: number;
  tickFormatter?: (value: number) => string;
}) {
  const points = data.filter((point) => point[dataKey] !== null && point[dataKey] !== undefined);
  if (!points.length) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-muted-foreground"
      >
        No samples in this window.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={axisFormat}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(value) => (tickFormatter ? tickFormatter(value) : `${value}${suffix}`)}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip content={<ChartTooltip suffix={suffix} />} />
        <Line
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={1.6}
          dot={false}
          connectNulls
          activeDot={{ r: 3, strokeWidth: 0, fill: color }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function LatencyChart({
  data,
  height = 220,
}: {
  data: Array<{ timestamp: string; avgLatencyMs: number | null }>;
  height?: number;
}) {
  const points = data.filter((point) => point.avgLatencyMs !== null);
  if (!points.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
        No successful latency samples in this window.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={axisFormat}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(value) => `${value} ms`}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip content={<ChartTooltip suffix=" ms" />} />
        <Line
          type="monotone"
          dataKey="avgLatencyMs"
          name="Latency"
          stroke={COLORS.line}
          strokeWidth={1.6}
          dot={false}
          connectNulls
          activeDot={{ r: 3, strokeWidth: 0, fill: COLORS.line }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ErrorTrendChart({
  data,
  height = 220,
}: {
  data: Array<{ timestamp: string; count: number }>;
  height?: number;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
        No errors recorded in the last 24 hours.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis
          dataKey="timestamp"
          tickFormatter={axisFormat}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: COLORS.muted, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="count" name="Errors" fill={COLORS.warning} radius={[2, 2, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SeverityPie({
  data,
  height = 200,
}: {
  data: Array<{ name: string; value: number }>;
  height?: number;
}) {
  const colors = [COLORS.critical, COLORS.warning, COLORS.info, COLORS.muted];
  const filtered = data.filter((entry) => entry.value > 0);
  if (!filtered.length) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
        No unresolved errors.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="none"
        >
          {filtered.map((entry, index) => (
            <Cell key={entry.name} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function MiniSparkline({
  data,
  color = COLORS.success,
  height = 40,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  if (!data.length) return <div style={{ height }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data.map((value, index) => ({ index, value }))}>
        <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.08} strokeWidth={1.4} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export { COLORS };
