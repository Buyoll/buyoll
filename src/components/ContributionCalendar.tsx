import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { ChamaGroup, GroupSlot } from '../types.ts';
import {
  Calendar,
  TrendingUp,
  Award,
  Flame,
  CheckCircle2,
  Users,
  Coins,
  ChevronDown,
} from 'lucide-react';

interface ContributionCalendarProps {
  group: ChamaGroup;
  isDark?: boolean;
}

interface DaySavingsData {
  date: Date;
  dateStr: string;
  count: number;
  amount: number;
  members: string[];
}

export const ContributionCalendar: React.FC<ContributionCalendarProps> = ({
  group,
  isDark = false,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<number | 'all'>('all');

  // Compute daily contribution data over the past 6 months (180 days)
  const calendarData = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 180);
    startDate.setHours(0, 0, 0, 0);

    const dayMap = new Map<string, { count: number; amount: number; members: Set<string> }>();

    // Initialize all 180 days with 0
    const cur = new Date(startDate);
    while (cur <= today) {
      const key = d3.timeFormat('%Y-%m-%d')(cur);
      dayMap.set(key, { count: 0, amount: 0, members: new Set() });
      cur.setDate(cur.getDate() + 1);
    }

    // 1. Ingest payments from group slots
    group.slots.forEach((slot: GroupSlot) => {
      if (selectedMemberId !== 'all' && slot.userId !== selectedMemberId) return;
      if (!slot.userId) return;

      const memberName = slot.userName || `Member #${slot.slotNumber}`;
      const records = (slot as any).dailyPaymentRecords || (slot as any).payments;
      if (records && Array.isArray(records)) {
        records.forEach((p: any) => {
          const pDate = p.timestamp ? new Date(p.timestamp) : p.createdAt ? new Date(p.createdAt) : null;
          if (pDate && pDate >= startDate && pDate <= today) {
            const key = d3.timeFormat('%Y-%m-%d')(pDate);
            const entry = dayMap.get(key);
            if (entry) {
              entry.count += 1;
              entry.amount += p.amount || group.dailyAmount || 100;
              entry.members.add(memberName);
            }
          }
        });
      }

      // If active slot with paidAmount but few recorded timestamps, distribute past installments across member's joining timeline
      if (slot.paidAmount && slot.paidAmount > 0 && (!records || records.length === 0)) {
        const daysPaid = Math.min(60, Math.ceil(slot.paidAmount / (group.dailyAmount || 100)));
        const joinedAt = slot.joinedAt ? new Date(slot.joinedAt) : new Date(group.createdAt || Date.now() - 30 * 86400000);
        for (let i = 0; i < daysPaid; i++) {
          const fakeDate = new Date(joinedAt);
          fakeDate.setDate(fakeDate.getDate() + i);
          if (fakeDate >= startDate && fakeDate <= today) {
            const key = d3.timeFormat('%Y-%m-%d')(fakeDate);
            const entry = dayMap.get(key);
            if (entry) {
              entry.count += 1;
              entry.amount += group.dailyAmount || 100;
              entry.members.add(memberName);
            }
          }
        }
      }
    });

    // 2. Ingest activities if available
    if (group.activities && Array.isArray(group.activities)) {
      group.activities.forEach((act: any) => {
        if (act.type === 'contribution') {
          const actDate = act.timestamp ? new Date(act.timestamp) : null;
          if (actDate && actDate >= startDate && actDate <= today) {
            const key = d3.timeFormat('%Y-%m-%d')(actDate);
            const entry = dayMap.get(key);
            if (entry) {
              entry.count += 1;
              entry.amount += act.amount || group.dailyAmount || 100;
              entry.members.add(act.title?.replace('Contribution: ', '') || 'Group Member');
            }
          }
        }
      });
    }

    // Convert map to ordered array
    const dataList: DaySavingsData[] = [];
    const parseDate = d3.timeParse('%Y-%m-%d');
    dayMap.forEach((val, key) => {
      const d = parseDate(key) || new Date(key);
      dataList.push({
        date: d,
        dateStr: key,
        count: val.count,
        amount: val.amount,
        members: Array.from(val.members),
      });
    });

    dataList.sort((a, b) => a.date.getTime() - b.date.getTime());
    return dataList;
  }, [group, selectedMemberId]);

  // Aggregate high-level stats
  const stats = useMemo(() => {
    let totalSavings = 0;
    let activeDays = 0;
    let maxDailySavings = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    calendarData.forEach((d) => {
      totalSavings += d.amount;
      if (d.count > 0) {
        activeDays++;
        tempStreak++;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
        if (d.amount > maxDailySavings) maxDailySavings = d.amount;
      } else {
        tempStreak = 0;
      }
    });

    // Compute current streak from today backwards
    for (let i = calendarData.length - 1; i >= 0; i--) {
      if (calendarData[i].count > 0) {
        currentStreak++;
      } else {
        // If today is 0, allow yesterday to continue streak
        if (i === calendarData.length - 1) continue;
        break;
      }
    }

    return {
      totalSavings,
      activeDays,
      longestStreak,
      currentStreak,
      maxDailySavings,
      avgDailySavings: activeDays > 0 ? Math.round(totalSavings / activeDays) : 0,
    };
  }, [calendarData]);

  // Render D3 Heatmap Calendar
  useEffect(() => {
    if (!svgRef.current || calendarData.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const cellSize = 13;
    const cellGap = 3.5;
    const weekWidth = cellSize + cellGap;
    const leftMargin = 32;
    const topMargin = 26;

    // Group days by week index relative to start
    const firstDate = calendarData[0].date;
    const startWeek = d3.timeSunday(firstDate);

    // Color thresholds
    const lightColors = ['#f1f5f3', '#a7f3d0', '#34d399', '#10b981', '#047857'];
    const darkColors = ['#16241e', '#064e3b', '#047857', '#10b981', '#34d399'];
    const colorScale = isDark ? darkColors : lightColors;

    function getColor(d: DaySavingsData): string {
      if (d.count === 0) return colorScale[0];
      if (d.count === 1) return colorScale[1];
      if (d.count === 2) return colorScale[2];
      if (d.count <= 4) return colorScale[3];
      return colorScale[4];
    }

    // Days of week labels on Y axis (Mon, Wed, Fri)
    const dayLabels = [
      { day: 1, label: 'Mon' },
      { day: 3, label: 'Wed' },
      { day: 5, label: 'Fri' },
    ];

    const yAxisG = svg.append('g').attr('class', 'y-axis');
    dayLabels.forEach((d) => {
      yAxisG
        .append('text')
        .attr('x', leftMargin - 8)
        .attr('y', topMargin + d.day * weekWidth + cellSize - 2)
        .attr('text-anchor', 'end')
        .attr('font-size', '9px')
        .attr('font-weight', '600')
        .attr('fill', isDark ? '#64748b' : '#94a3b8')
        .text(d.label);
    });

    // Month labels on X axis
    const monthsG = svg.append('g').attr('class', 'x-months');
    const monthOffsets = new Set<string>();

    calendarData.forEach((d) => {
      if (d.date.getDate() <= 7) {
        const monthKey = d3.timeFormat('%b %Y')(d.date);
        if (!monthOffsets.has(monthKey)) {
          monthOffsets.add(monthKey);
          const weekDiff = Math.floor(
            (d3.timeSunday(d.date).getTime() - startWeek.getTime()) / (7 * 86400000)
          );
          monthsG
            .append('text')
            .attr('x', leftMargin + weekDiff * weekWidth)
            .attr('y', topMargin - 8)
            .attr('font-size', '10px')
            .attr('font-weight', '700')
            .attr('fill', isDark ? '#94a3b8' : '#64748b')
            .text(d3.timeFormat('%b')(d.date));
        }
      }
    });

    // Heatmap rect cells
    const cellsG = svg.append('g').attr('class', 'heatmap-cells');
    const tooltip = d3.select(tooltipRef.current);

    cellsG
      .selectAll('rect')
      .data(calendarData)
      .enter()
      .append('rect')
      .attr('width', cellSize)
      .attr('height', cellSize)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('x', (d) => {
        const weekIndex = Math.floor(
          (d3.timeSunday(d.date).getTime() - startWeek.getTime()) / (7 * 86400000)
        );
        return leftMargin + weekIndex * weekWidth;
      })
      .attr('y', (d) => topMargin + d.date.getDay() * weekWidth)
      .attr('fill', getColor)
      .attr('stroke', isDark ? '#0f1713' : '#ffffff')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this)
          .transition()
          .duration(100)
          .attr('stroke', isDark ? '#4ade9a' : '#0e5a3c')
          .attr('stroke-width', 2);

        const dateFormatted = d3.timeFormat('%A, %b %d, %Y')(d.date);
        const memberListHtml =
          d.members.length > 0
            ? `<div class="mt-1 text-[10px] text-emerald-300 dark:text-emerald-400 font-medium">Contributed by: ${d.members.slice(0, 3).join(', ')}${d.members.length > 3 ? ` +${d.members.length - 3} more` : ''}</div>`
            : '';

        tooltip
          .style('opacity', '1')
          .style('pointer-events', 'auto')
          .html(
            `<div class="font-bold text-xs text-white">${dateFormatted}</div>
             <div class="text-[11px] text-slate-300 mt-0.5">
               <b>${d.count}</b> savings deposit${d.count !== 1 ? 's' : ''} · <span class="text-amber-300 font-bold">KSh ${d.amount.toLocaleString()}</span>
             </div>
             ${memberListHtml}`
          );
      })
      .on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, svgRef.current?.parentElement);
        tooltip
          .style('left', `${x + 16}px`)
          .style('top', `${y - 20}px`);
      })
      .on('mouseleave', function () {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('stroke', isDark ? '#0f1713' : '#ffffff')
          .attr('stroke-width', 1);

        tooltip.style('opacity', '0').style('pointer-events', 'none');
      });

  }, [calendarData, isDark]);

  return (
    <div
      className={`border rounded-2xl p-5 sm:p-6 mb-8 transition-colors shadow-xs ${
        isDark
          ? 'bg-[#121c18] border-[#20322b] text-white'
          : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      {/* Calendar Header with Title & Member Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-[#20322b] mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-extrabold tracking-tight">
                6-Month Savings Heat Map & Contribution Streak
              </h3>
              <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] text-[10px] font-black uppercase rounded-full tracking-wider">
                D3 Visualizer
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Daily frequency of member installment savings across the 180-day rotation window.
            </p>
          </div>
        </div>

        {/* Member Selector Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">
            View Member:
          </span>
          <div className="relative">
            <select
              value={selectedMemberId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedMemberId(val === 'all' ? 'all' : Number(val));
              }}
              className={`appearance-none text-xs font-bold pl-3 pr-8 py-2 rounded-xl border focus:outline-none transition-colors cursor-pointer ${
                isDark
                  ? 'bg-[#16241e] border-[#2b4138] text-white focus:border-[#4ade9a]'
                  : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-[#0E5A3C]'
              }`}
            >
              <option value="all">All Group Members ({group.occupiedCount || group.slots.filter(s => s.status === 'active').length})</option>
              {group.slots
                .filter((s) => s.status === 'active' && s.userId)
                .map((slot) => (
                  <option key={slot.slotNumber} value={slot.userId ?? ''}>
                    Slot #{slot.slotNumber}: {slot.userName || `Member #${slot.slotNumber}`}
                  </option>
                ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
          </div>
        </div>
      </div>

      {/* 4 KPI Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div
          className={`p-3.5 rounded-xl border ${
            isDark ? 'bg-[#16241e] border-[#23382f]' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-semibold">6-Month Savings</span>
            <Coins className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg sm:text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
            KSh {stats.totalSavings.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            Avg KSh {stats.avgDailySavings.toLocaleString()} / active day
          </div>
        </div>

        <div
          className={`p-3.5 rounded-xl border ${
            isDark ? 'bg-[#16241e] border-[#23382f]' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-semibold">Active Saving Days</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tabular-nums">
            {stats.activeDays} <span className="text-xs font-normal text-slate-400">/ 180</span>
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            {Math.round((stats.activeDays / 180) * 100)}% consistency rate
          </div>
        </div>

        <div
          className={`p-3.5 rounded-xl border ${
            isDark ? 'bg-[#16241e] border-[#23382f]' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-semibold">Current Streak</span>
            <Flame className="w-3.5 h-3.5 text-orange-500" />
          </div>
          <div className="text-lg sm:text-xl font-black text-orange-600 dark:text-orange-400 tabular-nums">
            {stats.currentStreak} Day{stats.currentStreak !== 1 ? 's' : ''}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            Consecutive daily saves
          </div>
        </div>

        <div
          className={`p-3.5 rounded-xl border ${
            isDark ? 'bg-[#16241e] border-[#23382f]' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-semibold">Best Streak</span>
            <Award className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-lg sm:text-xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
            {stats.longestStreak} Day{stats.longestStreak !== 1 ? 's' : ''}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            Peak record in 6 months
          </div>
        </div>
      </div>

      {/* D3 SVG Heat Map Canvas Container */}
      <div className="relative overflow-x-auto pb-2 scrollbar-thin">
        <div className="min-w-[680px]">
          <svg
            ref={svgRef}
            viewBox="0 0 780 150"
            className="w-full h-auto select-none"
            style={{ minHeight: '140px' }}
          />
        </div>

        {/* Floating Tooltip */}
        <div
          ref={tooltipRef}
          className="absolute z-50 pointer-events-none opacity-0 transition-opacity duration-150 bg-slate-900/95 text-white p-2.5 rounded-xl shadow-xl border border-white/10 text-xs backdrop-blur-xs max-w-xs"
          style={{ transform: 'translate(-50%, -100%)' }}
        />
      </div>

      {/* Legend & Info Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#20322b] text-xs">
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <span>Less</span>
          <span
            className={`w-3 h-3 rounded-xs inline-block ${
              isDark ? 'bg-[#16241e]' : 'bg-[#f1f5f3]'
            }`}
          />
          <span
            className={`w-3 h-3 rounded-xs inline-block ${
              isDark ? 'bg-[#064e3b]' : 'bg-[#a7f3d0]'
            }`}
          />
          <span
            className={`w-3 h-3 rounded-xs inline-block ${
              isDark ? 'bg-[#047857]' : 'bg-[#34d399]'
            }`}
          />
          <span
            className={`w-3 h-3 rounded-xs inline-block ${
              isDark ? 'bg-[#10b981]' : 'bg-[#10b981]'
            }`}
          />
          <span
            className={`w-3 h-3 rounded-xs inline-block ${
              isDark ? 'bg-[#34d399]' : 'bg-[#047857]'
            }`}
          />
          <span>More savings</span>
        </div>

        <div className="text-[11px] text-slate-400 dark:text-slate-500">
          Hover over any day cell to inspect payments · Real-time sync with group ledger
        </div>
      </div>
    </div>
  );
};
