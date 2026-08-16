import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
  Line as SvgLine,
  Circle,
} from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const SCREEN_WIDTH = Dimensions.get("window").width;

const ENTRY_COLORS = [
  "#12a195",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#3b82f6",
  "#10b981",
];
const TOTAL_COLOR = "#1a2d5a";
// Snapshot table semantics: interest adds value (deep green), drawdown
// removes value but is received as income (warm orange-red)
const INTEREST_COLOR = "#15803d";
const DRAWDOWN_COLOR = "#e8590c";

const BIRTH_DATE = new Date(1979, 11, 10); // December 10, 1979

/** Annual inflation applied to the retirement income drawdown. */
const INFLATION_RATE = 0.03;

function ageAtMonthOffset(monthOffset: number): number {
  const now = new Date();
  const future = new Date(now.getFullYear(), now.getMonth() + monthOffset, 15);
  let age = future.getFullYear() - BIRTH_DATE.getFullYear();
  if (
    future.getMonth() < BIRTH_DATE.getMonth() ||
    (future.getMonth() === BIRTH_DATE.getMonth() && future.getDate() < BIRTH_DATE.getDate())
  ) {
    age--;
  }
  return age;
}

function yearAtMonthOffset(monthOffset: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + monthOffset, 15).getFullYear();
}

/**
 * Snap a month offset back to the start of the 12-month "table year"
 * containing it, so drawdown years align with snapshot rows: the full
 * entered amount is withdrawn during the year the user reaches
 * retirement age, rising by inflation each row thereafter.
 */
function snapToYearStart(offset: number): number {
  return offset === 0 ? 0 : Math.floor((offset - 1) / 12) * 12;
}

/** Months from now until the birthday when the user turns targetAge (0 if already reached). */
function monthOffsetAtAge(targetAge: number): number {
  const now = new Date();
  const target = new Date(BIRTH_DATE.getFullYear() + targetAge, BIRTH_DATE.getMonth(), BIRTH_DATE.getDate());
  const offset = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(0, offset);
}

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

interface Entry {
  id: string;
  label: string;
  principal: string;
  rate: string;
  yearlyContribution?: string;
}

const DEFAULT_ENTRIES: Entry[] = [
  { id: genId(), label: "Investment 1", principal: "10000", rate: "7.5" },
  { id: genId(), label: "Investment 2", principal: "5000", rate: "5.0" },
];

interface MonthData {
  month: number;
  balance: number;
}

interface SimEntry {
  principal: number;
  annualRate: number;
  yearlyContribution: number;
}

/**
 * Simulate all entries jointly so a shared monthly drawdown can be
 * withdrawn pro-rata across balances. Before drawdownStartMonth the
 * entries compound uninterrupted; from the month after it, 1/12 of
 * drawdownAnnual is deducted each month (split in proportion to each
 * entry's balance) until the period ends or the pot is exhausted.
 * The annual amount rises by INFLATION_RATE each year of retirement.
 * Yearly contributions stop once retirement (drawdownStartMonth) is
 * reached, whether or not an income amount is set.
 */
function simulateEntries(
  simEntries: SimEntry[],
  months: number,
  drawdownAnnual: number,
  drawdownStartMonth: number | null
): { perEntry: MonthData[][]; totalWithdrawn: number; withdrawnByMonth: number[] } {
  const mrs = simEntries.map((e) => e.annualRate / 100 / 12);
  const balances = simEntries.map((e) => e.principal);
  const perEntry: MonthData[][] = simEntries.map((e) => [{ month: 0, balance: e.principal }]);
  const drawing = drawdownAnnual > 0 && drawdownStartMonth !== null;
  let totalWithdrawn = 0;
  const withdrawnByMonth: number[] = [0];
  for (let m = 1; m <= months; m++) {
    for (let i = 0; i < balances.length; i++) {
      balances[i] *= 1 + mrs[i];
      // Add yearly contribution at the end of each 12-month period,
      // but not once retirement has been reached
      if (
        simEntries[i].yearlyContribution > 0 &&
        m % 12 === 0 &&
        (drawdownStartMonth === null || m < drawdownStartMonth)
      ) {
        balances[i] += simEntries[i].yearlyContribution;
      }
    }
    let withdrawnThisMonth = 0;
    if (drawing && m > drawdownStartMonth!) {
      // Inflation-adjust the annual amount for each full year of retirement
      const yearsIn = Math.floor((m - drawdownStartMonth! - 1) / 12);
      const monthlyDraw = (drawdownAnnual / 12) * Math.pow(1 + INFLATION_RATE, yearsIn);
      const available = balances.reduce((s, b) => s + Math.max(0, b), 0);
      const take = Math.min(monthlyDraw, available);
      if (take > 0) {
        for (let i = 0; i < balances.length; i++) {
          if (balances[i] > 0) balances[i] -= (balances[i] / available) * take;
        }
        totalWithdrawn += take;
        withdrawnThisMonth = take;
      }
    }
    withdrawnByMonth.push(withdrawnThisMonth);
    for (let i = 0; i < balances.length; i++) {
      perEntry[i].push({ month: m, balance: balances[i] });
    }
  }
  return { perEntry, totalWithdrawn, withdrawnByMonth };
}

function formatCurrency(amount: number): string {
  if (isNaN(amount) || !isFinite(amount)) return "£0.00";
  return amount.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCompact(amount: number): string {
  if (isNaN(amount) || !isFinite(amount)) return "£0";
  if (amount >= 1_000_000) {
    const s = (amount / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return "£" + s + "M";
  }
  if (amount >= 1_000) {
    const s = (amount / 1_000).toFixed(1).replace(/\.0$/, "");
    return "£" + s + "K";
  }
  return "£" + amount.toFixed(0);
}

/** Round a rough step value up to the nearest "nice" number. */
function niceStep(rough: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 2.5) nice = 2.5;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * mag;
}

const TIME_PRESETS = [
  { label: "1Y", months: 12 },
  { label: "2Y", months: 24 },
  { label: "3Y", months: 36 },
  { label: "5Y", months: 60 },
  { label: "10Y", months: 120 },
  { label: "20Y", months: 240 },
  { label: "30Y", months: 360 },
  { label: "40Y", months: 480 },
];

interface LineData {
  label: string;
  color: string;
  data: MonthData[];
  isTotal?: boolean;
}

interface MultiChartProps {
  lines: LineData[];
  months: number;
  mutedColor: string;
  touchMonth: number | null;
  onTouchMonthChange: (month: number | null) => void;
  drawdownStartMonth?: number | null;
}

function MultiLineChart({ lines, months, mutedColor, touchMonth, onTouchMonthChange, drawdownStartMonth = null }: MultiChartProps) {
  const [chartWidth, setChartWidth] = useState(SCREEN_WIDTH - 72);
  const height = 200;
  const pad = { top: 16, right: 12, bottom: 30, left: 48 };

  // Scale helpers (recomputed on width/data changes)
  const cW = chartWidth - pad.left - pad.right;
  const cH = height - pad.top - pad.bottom;
  const entryLines = lines.filter((l) => !l.isTotal);
  const totalLine = lines.find((l) => l.isTotal) ?? null;
  // maxBal must reflect the peak of the cumulative stack top — with
  // drawdown active the balance can fall, so the end value is not the max
  let cumPeak = 0;
  for (let m = 0; m <= months; m++) {
    let s = 0;
    for (const l of entryLines) s += l.data[m]?.balance ?? 0;
    if (s > cumPeak) cumPeak = s;
  }
  const maxBal = Math.max(cumPeak, 1);

  // Compute nice linear y-axis ticks (4-6 steps)
  const yStep = niceStep(maxBal / 5);
  const displayMax = Math.ceil(maxBal / yStep) * yStep;
  const yTicks: number[] = [];
  for (let v = yStep; v <= displayMax + yStep * 0.01; v += yStep) yTicks.push(v);

  const sx = (m: number) => pad.left + (m / months) * cW;
  const sy = (v: number) => pad.top + cH - (v / displayMax) * cH;

  const handleChartTap = (locationX: number) => {
    if (!isFinite(locationX)) return;
    const ratio = Math.max(0, Math.min(1, (locationX - pad.left) / cW));
    const month = Math.round(ratio * months);
    if (!isFinite(month)) return;
    // Tap near the same position toggles the tooltip off
    const threshold = Math.max(1, Math.round(months * 0.04));
    if (touchMonth !== null && Math.abs(month - touchMonth) <= threshold) {
      onTouchMonthChange(null);
    } else {
      Haptics.selectionAsync();
      onTouchMonthChange(month);
    }
  };

  const areaPaths = useMemo(() => {
    if (chartWidth <= 0 || entryLines.length === 0) return { areas: [], totalPath: "", totalColor: "" };
    const step = Math.max(1, Math.floor(months / 60));

    // Sampled month indices
    const sampleMs: number[] = [];
    for (let m = 0; m <= months; m += step) sampleMs.push(m);
    if (sampleMs[sampleMs.length - 1] !== months) sampleMs.push(months);

    // cumTop[i][j] = cumulative balance of entries 0..i at sampleMs[j]
    const cumTop: number[][] = [];
    for (let i = 0; i < entryLines.length; i++) {
      cumTop[i] = sampleMs.map((m, j) => {
        const prev = i > 0 ? cumTop[i - 1][j] : 0;
        return prev + (entryLines[i].data[m]?.balance ?? 0);
      });
    }

    const areas = entryLines.map((line, i) => {
      const topPts = sampleMs.map((m, j) => ({ x: sx(m), y: sy(cumTop[i][j]) }));
      const botPts = sampleMs.map((m, j) => ({ x: sx(m), y: sy(i > 0 ? cumTop[i - 1][j] : 0) }));

      let d = `M ${topPts[0].x.toFixed(1)} ${topPts[0].y.toFixed(1)}`;
      for (let j = 1; j < topPts.length; j++)
        d += ` L ${topPts[j].x.toFixed(1)} ${topPts[j].y.toFixed(1)}`;
      for (let j = botPts.length - 1; j >= 0; j--)
        d += ` L ${botPts[j].x.toFixed(1)} ${botPts[j].y.toFixed(1)}`;
      d += " Z";
      return { d, color: line.color };
    });

    // Optional dashed total stroke along the top of the stack
    const totalPath = totalLine
      ? sampleMs
          .map((m, j) => `${j === 0 ? "M" : "L"} ${sx(m).toFixed(1)} ${sy(totalLine.data[m]?.balance ?? 0).toFixed(1)}`)
          .join(" ")
      : "";

    return { areas, totalPath, totalColor: totalLine?.color ?? "" };
  }, [entryLines, totalLine, chartWidth, months]);

  const xLabels = useMemo(() => {
    const labelStep = months <= 24 ? 6 : months <= 60 ? 12 : months <= 120 ? 24 : months <= 360 ? 60 : 120;
    const labels: { x: number; text: string }[] = [];
    for (let m = 0; m <= months; m += labelStep) {
      labels.push({
        x: sx(m),
        text: m === 0 ? "Now" : m % 12 === 0 ? `${m / 12}y` : `${m}m`,
      });
    }
    return labels;
  }, [chartWidth, months]);

  // Crosshair & tooltip values — dots sit at top of each stacked band
  const crosshairX = touchMonth !== null ? sx(touchMonth) : null;
  const touchValues = (() => {
    if (touchMonth === null) return [];
    let cumSum = 0;
    const vals = entryLines.map((line) => {
      const bal = line.data[touchMonth]?.balance ?? 0;
      cumSum += bal;
      return { label: line.label, color: line.color, isTotal: false, balance: bal, cy: sy(cumSum) };
    });
    if (totalLine) {
      const bal = totalLine.data[touchMonth]?.balance ?? 0;
      vals.push({ label: totalLine.label, color: totalLine.color, isTotal: true, balance: bal, cy: sy(bal) });
    }
    return vals;
  })();
  const touchTimeLabel =
    touchMonth === null ? ""
    : touchMonth === 0 ? `Age ${ageAtMonthOffset(0)} · Now`
    : `Age ${ageAtMonthOffset(touchMonth)} · ${yearAtMonthOffset(touchMonth)}`;

  // Keep tooltip inside the chart
  const TOOLTIP_W = 220;
  const tooltipLeft =
    crosshairX !== null
      ? crosshairX + 10 + TOOLTIP_W > chartWidth
        ? crosshairX - TOOLTIP_W - 10
        : crosshairX + 10
      : 0;

  return (
    <View
      style={[{ position: "relative", zIndex: 2, overflow: "visible" }, { userSelect: "none" } as object]}
      onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => handleChartTap(e.nativeEvent.locationX)}
      onResponderTerminationRequest={() => true}
    >
      {chartWidth > 0 && (
        <>
          <Svg
            width={chartWidth}
            height={height}
          >
            {/* Y-axis gridlines only (labels rendered outside SVG) */}
            {yTicks.map((val) => {
              const y = sy(val);
              return (
                <SvgLine key={val}
                  x1={pad.left} y1={y}
                  x2={chartWidth - pad.right} y2={y}
                  stroke={mutedColor} strokeWidth="0.5" opacity="0.18"
                  strokeDasharray="3 3"
                />
              );
            })}

            {/* Baseline */}
            <SvgLine
              x1={pad.left} y1={height - pad.bottom}
              x2={chartWidth - pad.right} y2={height - pad.bottom}
              stroke={mutedColor} strokeWidth="0.5" opacity="0.3"
            />

            {/* Stacked area fills — bottom entry first */}
            {areaPaths.areas.map((a, i) => (
              <Path key={i} d={a.d} fill={a.color} opacity="0.82" />
            ))}

            {/* Dashed total stroke along top of stack */}
            {areaPaths.totalPath ? (
              <Path
                d={areaPaths.totalPath} fill="none"
                stroke={areaPaths.totalColor} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray="5 3" opacity="0.9"
              />
            ) : null}

            {/* Drawdown start marker */}
            {drawdownStartMonth !== null && drawdownStartMonth <= months && (
              <SvgLine
                x1={sx(drawdownStartMonth)} y1={pad.top}
                x2={sx(drawdownStartMonth)} y2={height - pad.bottom}
                stroke="#f59e0b" strokeWidth="1.5" opacity="0.85"
              />
            )}

            {/* Crosshair */}
            {crosshairX !== null && (
              <SvgLine
                x1={crosshairX} y1={pad.top}
                x2={crosshairX} y2={height - pad.bottom}
                stroke={mutedColor} strokeWidth="1"
                strokeDasharray="3 3" opacity="0.6"
              />
            )}

            {/* Dots on each line at touch point */}
            {touchValues.map((v, i) => (
              <Circle
                key={i}
                cx={crosshairX!} cy={v.cy} r={v.isTotal ? 5.5 : 4.5}
                fill={v.color} stroke="#fff" strokeWidth="1.5"
              />
            ))}

          </Svg>

          {/* Axis labels — native Text in a non-interactive overlay so iOS
              can never trigger its native long-press selection on them */}
          <View
            style={[StyleSheet.absoluteFillObject, { pointerEvents: "none" } as object]}
          >
            {/* Y-axis labels */}
            {yTicks.map((val) => {
              const y = sy(val);
              return (
                <Text
                  key={val}
                  selectable={false}
                  style={{
                    position: "absolute",
                    top: y - 7,
                    left: 0,
                    width: pad.left - 6,
                    textAlign: "right",
                    fontSize: 9,
                    color: mutedColor,
                    opacity: 0.65,
                  }}
                >
                  {formatCompact(val)}
                </Text>
              );
            })}
            {/* X-axis labels */}
            {xLabels.map((label, i) => (
              <Text
                key={i}
                selectable={false}
                style={{
                  position: "absolute",
                  top: height - pad.bottom + 4,
                  left: label.x - 18,
                  width: 36,
                  textAlign: "center",
                  fontSize: 10,
                  color: mutedColor,
                }}
              >
                {label.text}
              </Text>
            ))}
          </View>

          {/* Tooltip */}
          {touchMonth !== null && crosshairX !== null && (
            <View style={[chartTooltipStyle, { left: tooltipLeft, top: pad.top }]}>
              <Text style={chartTooltipTimeStyle}>{touchTimeLabel}</Text>
              {touchValues.map((v, i) => (
                <View key={i} style={chartTooltipRowStyle}>
                  <View style={[chartTooltipDotStyle, { backgroundColor: v.color }]} />
                  <Text style={chartTooltipLabelStyle} numberOfLines={1}>
                    {v.label}
                  </Text>
                  <Text style={[chartTooltipValueStyle, { color: v.isTotal ? TOTAL_COLOR : v.color }]}>
                    {formatCurrency(v.balance)}
                  </Text>
                </View>
              ))}
              {(() => {
                const totalEntry = touchValues.find((v) => v.isTotal);
                const drawdown = (totalEntry?.balance ?? 0) * 0.035;
                if (drawdown <= 0) return null;
                return (
                  <>
                    <View style={chartTooltipDividerStyle} />
                    <View style={chartTooltipRowStyle}>
                      <View style={[chartTooltipDotStyle, { backgroundColor: "#f59e0b" }]} />
                      <Text style={chartTooltipLabelStyle} numberOfLines={1}>Drawdown</Text>
                      <Text style={[chartTooltipValueStyle, { color: "#f59e0b" }]}>
                        {formatCurrency(drawdown)}<Text style={{ fontSize: 9, opacity: 0.7 }}> /yr</Text>
                      </Text>
                    </View>
                  </>
                );
              })()}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const chartTooltipStyle: object = {
  position: "absolute",
  width: 220,
  backgroundColor: "rgba(255,255,255,0.97)",
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 12,
  elevation: 8,
  zIndex: 999,
  borderWidth: 1,
  borderColor: "rgba(0,0,0,0.06)",
};
const chartTooltipTimeStyle: object = {
  fontSize: 11,
  fontFamily: "Inter_600SemiBold",
  color: "#607080",
  letterSpacing: 0.5,
  marginBottom: 6,
};
const chartTooltipRowStyle: object = {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: 4,
  gap: 5,
};
const chartTooltipDividerStyle: object = {
  height: 1,
  backgroundColor: "rgba(0,0,0,0.07)",
  marginVertical: 4,
};
const chartTooltipDotStyle: object = {
  width: 8, height: 8, borderRadius: 4, flexShrink: 0,
};
const chartTooltipLabelStyle: object = {
  flex: 1,
  fontSize: 12,
  fontFamily: "Inter_400Regular",
  color: "#607080",
};
const chartTooltipValueStyle: object = {
  fontSize: 13,
  fontFamily: "Inter_700Bold",
};

export default function CalculatorScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [entries, setEntries] = useState<Entry[]>(DEFAULT_ENTRIES);
  const [months, setMonths] = useState(120);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [touchMonth, setTouchMonth] = useState<number | null>(null);
  const [drawdownAmount, setDrawdownAmount] = useState("");
  const [retirementAge, setRetirementAge] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.multiGet(["calc_entries", "calc_months", "calc_drawdown", "calc_retirement_age"]).then(
      ([[, rawEntries], [, rawMonths], [, rawDrawdown], [, rawRetirementAge]]) => {
        if (rawEntries) {
          try {
            const parsed = JSON.parse(rawEntries) as Entry[];
            if (Array.isArray(parsed) && parsed.length > 0) setEntries(parsed);
          } catch {}
        }
        if (rawMonths) {
          const m = parseInt(rawMonths, 10);
          if (!isNaN(m)) setMonths(m);
        }
        if (rawDrawdown) setDrawdownAmount(rawDrawdown);
        if (rawRetirementAge) setRetirementAge(rawRetirementAge);
        loaded.current = true;
      }
    );
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.multiSet([
      ["calc_entries", JSON.stringify(entries)],
      ["calc_months", String(months)],
      ["calc_drawdown", drawdownAmount],
      ["calc_retirement_age", retirementAge],
    ]);
  }, [entries, months, drawdownAmount, retirementAge]);

  const parsedEntries = useMemo(
    () =>
      entries.map((e, i) => ({
        ...e,
        color: ENTRY_COLORS[i % ENTRY_COLORS.length],
        parsedPrincipal: parseFloat(e.principal.replace(/,/g, "")) || 0,
        parsedRate: parseFloat(e.rate) || 0,
        parsedYearlyContribution: e.yearlyContribution ? (parseFloat(e.yearlyContribution.replace(/,/g, "")) || 0) : 0,
      })),
    [entries]
  );

  const parsedDrawdown = parseFloat(drawdownAmount.replace(/,/g, "")) || 0;
  const parsedRetirementAge = parseInt(retirementAge, 10);
  const drawdownStart =
    !isNaN(parsedRetirementAge) && parsedRetirementAge > 0
      ? snapToYearStart(monthOffsetAtAge(parsedRetirementAge))
      : null;
  const drawdownActive = parsedDrawdown > 0 && drawdownStart !== null && drawdownStart < months;

  const simResult = useMemo(
    () =>
      simulateEntries(
        parsedEntries.map((e) => ({
          principal: e.parsedPrincipal,
          annualRate: e.parsedRate,
          yearlyContribution: e.parsedYearlyContribution,
        })),
        months,
        parsedDrawdown,
        drawdownStart
      ),
    [parsedEntries, months, parsedDrawdown, drawdownStart]
  );

  const entryData = useMemo(
    () =>
      parsedEntries.map((e, i) => ({
        ...e,
        data: simResult.perEntry[i],
      })),
    [parsedEntries, simResult]
  );

  const totalData: MonthData[] = useMemo(() => {
    return Array.from({ length: months + 1 }, (_, m) => ({
      month: m,
      balance: entryData.reduce((sum, e) => sum + (e.data[m]?.balance ?? 0), 0),
    }));
  }, [entryData, months]);

  const totalFinal = totalData[totalData.length - 1]?.balance ?? 0;
  // Contributions are made at each 12-month mark, but stop at retirement
  const contribYears =
    drawdownStart === null
      ? Math.floor(months / 12)
      : Math.min(Math.floor(months / 12), Math.max(0, Math.floor((drawdownStart - 1) / 12)));
  const totalInvested = parsedEntries.reduce(
    (s, e) => s + e.parsedPrincipal + e.parsedYearlyContribution * contribYears,
    0
  );
  // "Retirement pot" figure: the balance at the moment retirement starts,
  // not at the end of the selected time period. Falls back to the
  // end-of-period total when no retirement age is set (or it falls beyond
  // the selected period).
  const retirementMonth = drawdownStart !== null && drawdownStart <= months ? drawdownStart : null;
  const balanceAtRetirement = retirementMonth !== null ? (totalData[retirementMonth]?.balance ?? 0) : totalFinal;

  const visibleEntryData = useMemo(
    () => entryData.filter((e) => !hiddenIds.has(e.id)),
    [entryData, hiddenIds]
  );

  const visibleTotalData: MonthData[] = useMemo(() => {
    return Array.from({ length: months + 1 }, (_, m) => ({
      month: m,
      balance: visibleEntryData.reduce((sum, e) => sum + (e.data[m]?.balance ?? 0), 0),
    }));
  }, [visibleEntryData, months]);

  const toggleLine = (id: string) => {
    Haptics.selectionAsync();
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chartLines: LineData[] = useMemo(() => [
    ...entryData
      .filter((e) => !hiddenIds.has(e.id))
      .map((e) => ({
        label: e.label || "Entry",
        color: e.color,
        data: e.data,
      })),
    ...(!hiddenIds.has("total") ? [{
      label: "Total",
      color: TOTAL_COLOR,
      data: visibleTotalData,
      isTotal: true,
    }] : []),
  ], [entryData, visibleTotalData, hiddenIds]);

  const yearlyTotals = useMemo(() => {
    const rows: { year: number; total: number; byEntry: number[]; interest: number; drawdown: number }[] = [];
    const yearlyContribs = parsedEntries.reduce((s, e) => s + e.parsedYearlyContribution, 0);
    let prevTotal = totalData[0]?.balance ?? 0;
    for (let y = 1; y * 12 <= months; y++) {
      const m = y * 12;
      let yearWithdrawn = 0;
      for (let k = m - 11; k <= m; k++) yearWithdrawn += simResult.withdrawnByMonth[k] ?? 0;
      const total = totalData[m]?.balance ?? 0;
      rows.push({
        year: y,
        total,
        byEntry: entryData.map((e) => e.data[m]?.balance ?? 0),
        // Interest earned during this year: balance change plus what was
        // withdrawn, minus contributions paid in (none after retirement)
        interest:
          total - prevTotal + yearWithdrawn -
          (drawdownStart === null || m < drawdownStart ? yearlyContribs : 0),
        drawdown: yearWithdrawn,
      });
      prevTotal = total;
    }
    return rows;
  }, [totalData, entryData, months, simResult, parsedEntries, drawdownStart]);

  const handlePreset = (m: number) => {
    Haptics.selectionAsync();
    setMonths(m);
  };

  const updateEntry = (id: string, field: keyof Entry, value: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const addEntry = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEntries((prev) => [
      ...prev,
      { id: genId(), label: `Investment ${prev.length + 1}`, principal: "1000", rate: "6.0" },
    ]);
  };

  const removeEntry = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const styles = makeStyles(colors, insets);

  return (
    <View
      style={styles.root}
      onStartShouldSetResponderCapture={() => {
        if (touchMonth !== null) setTouchMonth(null);
        return false;
      }}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => setTouchMonth(null)}
      >
        {/* Hero */}
        <LinearGradient
          colors={["#1a2d5a", "#0f1e40"]}
          style={[styles.hero, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}
        >
          <Text style={styles.heroLabel}>TOTAL PROJECTED RETIREMENT POT</Text>
          <Text style={styles.heroBalance}>{formatCurrency(balanceAtRetirement)}</Text>
          <View style={styles.heroStats}>
            <View>
              <Text style={styles.heroStatLabel}>Total Invested</Text>
              <Text style={styles.heroStatValue}>{formatCurrency(totalInvested)}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View>
              <Text style={styles.heroStatLabel}>Total</Text>
              <Text style={[styles.heroStatValue, styles.accentText]}>
                {formatCurrency(touchMonth !== null ? visibleTotalData[touchMonth]?.balance ?? 0 : totalFinal)}
              </Text>
            </View>
          </View>

          <View style={styles.heroDrawdownRow}>
            <View style={styles.heroDrawdownDivider} />
            <View style={styles.heroDrawdownContent}>
              <Text style={styles.heroStatLabel}>Safe Withdrawal Rate (3.5%)</Text>
              <Text style={[styles.heroStatValue, styles.drawdownText]}>
                {formatCurrency((touchMonth !== null ? visibleTotalData[touchMonth]?.balance ?? 0 : balanceAtRetirement) * 0.035)}
                <Text style={styles.heroDrawdownSub}>
                  {" "}/ yr{touchMonth !== null ? ` · ${yearAtMonthOffset(touchMonth)}` : ""}
                </Text>
              </Text>
            </View>
            {drawdownActive && (
              <View style={[styles.heroDrawdownContent, { marginTop: 12 }]}>
                <Text style={styles.heroStatLabel}>
                  Desired Retirement Income (from age {parsedRetirementAge})
                </Text>
                <Text style={[styles.heroStatValue, styles.drawdownText]}>
                  {formatCurrency(parsedDrawdown)}
                  <Text style={styles.heroDrawdownSub}> / yr</Text>
                </Text>
              </View>
            )}
          </View>
        </LinearGradient>

        {/* Chart + Time Period (combined card) */}
        <View style={styles.chartCard}>
          <MultiLineChart
            lines={chartLines}
            months={months}
            mutedColor={colors.mutedForeground}
            touchMonth={touchMonth}
            onTouchMonthChange={setTouchMonth}
            drawdownStartMonth={drawdownActive ? drawdownStart : null}
          />

          {/* Legend */}
          <View style={styles.legend}>
            {entryData.map((e) => {
              const hidden = hiddenIds.has(e.id);
              return (
                <TouchableOpacity
                  key={e.id}
                  style={[styles.legendItem, hidden && styles.legendItemHidden]}
                  onPress={() => toggleLine(e.id)}
                  activeOpacity={0.6}
                >
                  <View style={[styles.legendDot, { backgroundColor: hidden ? "transparent" : e.color }, hidden && { borderWidth: 1.5, borderColor: e.color }]} />
                  <Text style={[styles.legendText, hidden && styles.legendTextHidden]} numberOfLines={1}>
                    {e.label || "Entry"}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {(() => {
              const hidden = hiddenIds.has("total");
              return (
                <TouchableOpacity
                  style={[styles.legendItem, hidden && styles.legendItemHidden]}
                  onPress={() => toggleLine("total")}
                  activeOpacity={0.6}
                >
                  <View style={[styles.legendDot, hidden ? { backgroundColor: "transparent", borderWidth: 1.5, borderColor: TOTAL_COLOR } : styles.legendDotTotal]} />
                  <Text style={[styles.legendText, { fontFamily: "Inter_600SemiBold" }, hidden && styles.legendTextHidden]}>
                    Total
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>

          {/* Time Period Presets */}
          <View style={styles.chartDivider} />
          <View style={styles.timeLabelRow}>
            <Text style={styles.fieldLabel}>TIME PERIOD</Text>
            <Text style={styles.timeValue}>
              {months >= 12
                ? `${months / 12 === Math.floor(months / 12) ? months / 12 : (months / 12).toFixed(1)} yr`
                : `${months} mo`}
            </Text>
          </View>
          <View style={styles.presetRow}>
            {TIME_PRESETS.map((p) => (
              <TouchableOpacity
                key={p.months}
                style={[styles.presetBtn, months === p.months && styles.presetBtnActive]}
                onPress={() => handlePreset(p.months)}
                activeOpacity={0.75}
              >
                <Text style={[styles.presetText, months === p.months && styles.presetTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Retirement Income */}
          <View style={styles.chartDivider} />
          <View style={styles.timeLabelRow}>
            <Text style={styles.fieldLabel}>DESIRED RETIREMENT INCOME</Text>
            {drawdownActive && (
              <Text style={styles.drawdownHintActive}>
                from age {parsedRetirementAge} · {yearAtMonthOffset(drawdownStart! + 1)}
              </Text>
            )}
          </View>
          <View style={styles.drawdownRow}>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <Text style={styles.inputAffix}>£</Text>
              <TextInput
                style={[styles.textInput, { flex: 1 }]}
                value={drawdownAmount}
                onChangeText={setDrawdownAmount}
                keyboardType="numeric"
                placeholder="Annual income"
                placeholderTextColor={colors.mutedForeground}
              />
              <Text style={styles.inputAffix}>/yr</Text>
            </View>
            <View style={[styles.inputWrap, { width: 110 }]}>
              <Text style={styles.inputAffix}>Age</Text>
              <TextInput
                style={[styles.textInput, { flex: 1 }]}
                value={retirementAge}
                onChangeText={setRetirementAge}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </View>
          <Text style={[styles.drawdownHint, { marginTop: 8 }]}>
            {drawdownActive
              ? "Withdrawn monthly · rises 3% each year with inflation"
              : parsedDrawdown <= 0
              ? "Enter an annual income and your retirement age — withdrawn monthly from the total"
              : drawdownStart === null
              ? "Enter your retirement age"
              : "Retirement falls beyond the selected time period"}
          </Text>
        </View>

        {/* Entry Cards */}
        {entryData.map((entry, idx) => (
          <View key={entry.id} style={[styles.card, styles.entryCard]}>
            <View style={[styles.entryColorBar, { backgroundColor: entry.color }]} />
            <View style={styles.entryBody}>
              <View style={styles.entryHeader}>
                <TextInput
                  style={styles.entryLabelInput}
                  value={entry.label}
                  onChangeText={(v) => updateEntry(entry.id, "label", v)}
                  placeholder="Label"
                  placeholderTextColor={colors.mutedForeground}
                />
                {entries.length > 1 && (
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => removeEntry(entry.id)}
                    hitSlop={10}
                  >
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.entryFinalBadge}>
                <Text style={[styles.entryFinalLabel, { color: entry.color }]}>
                  {formatCurrency(entry.data[entry.data.length - 1]?.balance ?? 0)}
                </Text>
                <Text style={styles.entryFinalSub}>
                  in {months >= 12 ? `${months / 12}yr` : `${months}mo`}
                </Text>
              </View>

              <View style={styles.entryFields}>
                <View style={[styles.inputWrap, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.inputAffix}>£</Text>
                  <TextInput
                    style={styles.textInput}
                    value={entry.principal}
                    onChangeText={(v) => updateEntry(entry.id, "principal", v)}
                    keyboardType="numeric"
                    placeholder="Amount"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
                <View style={[styles.inputWrap, { width: 100 }]}>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={entry.rate}
                    onChangeText={(v) => updateEntry(entry.id, "rate", v)}
                    keyboardType="numeric"
                    placeholder="Rate"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  <Text style={styles.inputAffix}>%</Text>
                </View>
              </View>

              <View style={styles.entryContribRow}>
                <Text style={styles.entryContribLabel}>Yearly contribution</Text>
                <View style={[styles.inputWrap, { width: 140 }]}>
                  <Text style={styles.inputAffix}>£</Text>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={entry.yearlyContribution ?? ""}
                    onChangeText={(v) => updateEntry(entry.id, "yearlyContribution", v)}
                    keyboardType="numeric"
                    placeholder="Optional"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  <Text style={styles.inputAffix}>/yr</Text>
                </View>
              </View>
            </View>
          </View>
        ))}

        {/* Add Entry */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={addEntry}
          activeOpacity={0.75}
        >
          <Text style={styles.addBtnText}>+ Add Entry</Text>
        </TouchableOpacity>

        {/* Snapshot Table */}
        <View style={[styles.card, styles.tableCard]}>
          <Text style={[styles.fieldLabel, { paddingHorizontal: 20 }]}>VALUE SNAPSHOTS</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tableScroll}
          >
            <View>
              {/* Column headers */}
              <View style={styles.tableHeaderRow}>
                <View style={styles.tableAgeCol}>
                  <Text style={[styles.tableHeaderText, styles.tableHeaderTextBold]}>Age</Text>
                </View>
                <View style={styles.tableLabelCol} />
                <View style={styles.tableDataCol}>
                  <View style={[styles.tableHeaderDot, { backgroundColor: TOTAL_COLOR }]} />
                  <Text style={[styles.tableHeaderText, styles.tableHeaderTextBold]}>
                    Total
                  </Text>
                </View>
                <View style={styles.tableDataCol}>
                  <Text style={[styles.tableHeaderText, styles.tableHeaderTextBold, { color: INTEREST_COLOR }]} numberOfLines={1}>
                    Interest
                  </Text>
                </View>
                <View style={styles.tableDataCol}>
                  <Text style={[styles.tableHeaderText, styles.tableHeaderTextBold, { color: DRAWDOWN_COLOR }]} numberOfLines={1}>
                    Drawdown
                  </Text>
                </View>
                <View style={styles.tableGroupGap} />
                {entryData.map((e) => (
                  <View key={e.id} style={styles.tableDataCol}>
                    <View style={[styles.tableHeaderDot, { backgroundColor: e.color }]} />
                    <Text style={styles.tableHeaderText} numberOfLines={1}>
                      {e.label || "Entry"}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Now row */}
              <View style={styles.tableRow}>
                <Text style={styles.tableAgeText}>{ageAtMonthOffset(0)}</Text>
                <Text style={styles.tableLabelText}>Now</Text>
                <Text style={[styles.tableCell, styles.tableCellTotal]}>
                  {formatCompact(totalInvested)}
                </Text>
                <Text style={[styles.tableCell, { color: INTEREST_COLOR }]}>—</Text>
                <Text style={[styles.tableCell, { color: DRAWDOWN_COLOR }]}>—</Text>
                <View style={styles.tableGroupGap} />
                {parsedEntries.map((e) => (
                  <Text key={e.id} style={[styles.tableCell, { color: e.color }]}>
                    {formatCompact(e.parsedPrincipal)}
                  </Text>
                ))}
              </View>

              {/* Year rows */}
              {yearlyTotals.map((row, idx) => (
                <View
                  key={row.year}
                  style={[
                    styles.tableRow,
                    idx === yearlyTotals.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <Text style={styles.tableAgeText}>{ageAtMonthOffset(row.year * 12)}</Text>
                  <Text style={styles.tableLabelText}>{row.year}yr</Text>
                  <Text style={[styles.tableCell, styles.tableCellTotal]}>
                    {formatCompact(row.total)}
                  </Text>
                  <Text style={[styles.tableCell, { color: INTEREST_COLOR }]}>
                    {formatCompact(row.interest)}
                  </Text>
                  <Text style={[styles.tableCell, { color: DRAWDOWN_COLOR }]}>
                    {row.drawdown > 0 ? formatCompact(row.drawdown) : "—"}
                  </Text>
                  <View style={styles.tableGroupGap} />
                  {row.byEntry.map((bal, i) => (
                    <Text
                      key={i}
                      style={[styles.tableCell, { color: ENTRY_COLORS[i % ENTRY_COLORS.length] }]}
                    >
                      {formatCompact(bal)}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={{ height: (Platform.OS === "web" ? 34 : insets.bottom) + 24 }} />
      </ScrollView>
    </View>
  );
}

function makeStyles(
  colors: ReturnType<typeof useColors>,
  insets: ReturnType<typeof useSafeAreaInsets>
) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1 },

    hero: { paddingHorizontal: 24, paddingBottom: 32 },
    heroLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: "rgba(255,255,255,0.5)",
      letterSpacing: 2,
      marginBottom: 8,
    },
    heroBalance: {
      fontSize: 44,
      fontFamily: "Inter_700Bold",
      color: "#ffffff",
      marginBottom: 20,
    },
    heroStats: { flexDirection: "row", alignItems: "center" },
    heroStatLabel: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: "rgba(255,255,255,0.5)",
      marginBottom: 3,
    },
    heroStatValue: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: "#ffffff",
    },
    accentText: { color: "#12a195" },
    heroDivider: {
      width: 1,
      height: 36,
      backgroundColor: "rgba(255,255,255,0.15)",
      marginHorizontal: 24,
    },
    heroDrawdownRow: {
      marginTop: 16,
      width: "100%",
    },
    heroDrawdownDivider: {
      height: 1,
      backgroundColor: "rgba(255,255,255,0.12)",
      marginBottom: 14,
    },
    heroDrawdownContent: {},
    drawdownText: { color: "#f59e0b" },
    heroDrawdownSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: "rgba(255,255,255,0.5)",
    },

    chartCard: {
      backgroundColor: colors.card,
      marginHorizontal: 16,
      marginTop: 12,
      borderRadius: 20,
      padding: 16,
      paddingBottom: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },
    chartDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 14,
    },
    legend: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 8,
      gap: 10,
    },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendItemHidden: { opacity: 0.4 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendDotTotal: {
      backgroundColor: TOTAL_COLOR,
    },
    legendText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      maxWidth: 80,
    },
    legendTextHidden: {
      textDecorationLine: "line-through" as const,
    },

    card: {
      backgroundColor: colors.card,
      marginHorizontal: 16,
      marginTop: 12,
      borderRadius: 20,
      padding: 20,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },

    fieldLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      letterSpacing: 1.2,
      marginBottom: 10,
    },
    timeLabelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    timeValue: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    drawdownRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    drawdownHint: {
      flex: 1,
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    drawdownHintActive: {
      fontFamily: "Inter_600SemiBold",
      color: "#f59e0b",
    },
    presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    presetBtn: {
      flexBasis: "20%",
      flexGrow: 1,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: colors.secondary,
      alignItems: "center",
    },
    presetBtnActive: { backgroundColor: "#1a2d5a" },
    presetText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
    },
    presetTextActive: { color: "#ffffff" },

    entryCard: {
      flexDirection: "row",
      padding: 0,
      overflow: "hidden",
    },
    entryColorBar: {
      width: 4,
      borderTopLeftRadius: 20,
      borderBottomLeftRadius: 20,
    },
    entryBody: {
      flex: 1,
      padding: 16,
    },
    entryHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 6,
    },
    entryLabelInput: {
      flex: 1,
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      padding: 0,
    },
    deleteBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    deleteBtnText: {
      fontSize: 14,
      color: colors.mutedForeground,
    },
    entryFinalBadge: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 6,
      marginBottom: 12,
    },
    entryFinalLabel: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
    },
    entryFinalSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    entryFields: { flexDirection: "row" },
    entryContribRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 10,
    },
    entryContribLabel: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.input,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    inputAffix: {
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      marginHorizontal: 2,
    },
    textInput: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      padding: 0,
    },

    addBtn: {
      marginHorizontal: 16,
      marginTop: 12,
      paddingVertical: 14,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderStyle: "dashed",
      alignItems: "center",
    },
    addBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
    },

    tableCard: {
      paddingHorizontal: 0,
      paddingTop: 16,
      paddingBottom: 4,
    },
    tableScroll: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    tableHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tableAgeCol: { width: 36 },
    tableGroupGap: { width: 20 },
    tableAgeText: {
      width: 36,
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    tableLabelCol: { width: 32 },
    tableDataCol: {
      width: 84,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 5,
    },
    tableHeaderDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
    tableHeaderText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      maxWidth: 66,
    },
    tableHeaderTextBold: { fontFamily: "Inter_600SemiBold" },
    tableRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tableLabelText: {
      width: 32,
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    tableCell: {
      width: 84,
      textAlign: "right",
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
    },
    tableCellTotal: {
      color: TOTAL_COLOR,
      fontFamily: "Inter_700Bold",
    },
  });
}
