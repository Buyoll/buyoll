import type { SpeedOption } from '../types.ts';

export const STANDARD_MEMBER_SPEEDS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
export const SOLO_DURATION_MONTHS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_SOLO_MONTHS = 3;

export function calculateDailyContribution(
  price: number,
  size: number,
  cycleDays?: number
): number {
  const safePrice = Math.max(0, Number(price) || 0);
  const safeSize = Math.max(1, Math.min(10, Math.round(Number(size) || 1)));
  if (safeSize === 1) {
    const days = Math.max(1, Math.round(Number(cycleDays) || DEFAULT_SOLO_MONTHS * 30));
    return Math.ceil(safePrice / days);
  }
  const perRotationDays = Math.max(1, Math.round(Number(cycleDays) || 10));
  return Math.ceil(safePrice / (safeSize * perRotationDays));
}

export function calculateTotalDurationDays(size: number, cycleDays?: number): number {
  const safeSize = Math.max(1, Math.min(10, Math.round(Number(size) || 1)));
  if (safeSize === 1) {
    return Math.max(1, Math.round(Number(cycleDays) || DEFAULT_SOLO_MONTHS * 30));
  }
  const perRotationDays = Math.max(1, Math.round(Number(cycleDays) || 10));
  return safeSize * perRotationDays;
}

export function calculateRotationPoolAmount(
  dailyAmount: number,
  size: number,
  cycleDays?: number
): number {
  const safeSize = Math.max(1, Math.min(10, Math.round(Number(size) || 1)));
  const days = safeSize === 1
    ? Math.max(1, Math.round(Number(cycleDays) || DEFAULT_SOLO_MONTHS * 30))
    : Math.max(1, Math.round(Number(cycleDays) || 10));
  return Math.max(0, Math.round(Number(dailyAmount) || 0)) * safeSize * days;
}

export function buildSpeedOption(
  price: number,
  size: number,
  opts?: {
    cycleDays?: number;
    soloMonths?: number;
    description?: string;
    dailyAmountOverride?: number;
  }
): SpeedOption {
  const safePrice = Math.max(0, Number(price) || 0);
  const safeSize = Math.max(1, Math.min(10, Math.round(Number(size) || 1)));

  if (safeSize === 1) {
    const months = opts?.soloMonths
      ? Math.max(1, Math.min(6, Math.round(opts.soloMonths)))
      : Math.max(1, Math.min(6, Math.round((opts?.cycleDays || DEFAULT_SOLO_MONTHS * 30) / 30)));
    const cycleDays =
      opts?.cycleDays && !opts?.soloMonths
        ? Math.max(1, Math.round(opts.cycleDays))
        : months * 30;
    const dailyAmount =
      opts?.dailyAmountOverride && opts.dailyAmountOverride > 0
        ? Math.round(opts.dailyAmountOverride)
        : calculateDailyContribution(safePrice, 1, cycleDays);

    return {
      size: 1,
      cycleDays,
      dailyAmount,
      totalAmount: safePrice,
      description:
        opts?.description ||
        `1 member · Solo Lipa Mdogomdogo · ${months} Month${months === 1 ? '' : 's'} (${cycleDays} days)`,
    };
  }

  const cycleDays = Math.max(1, Math.round(opts?.cycleDays || 10));
  const dailyAmount =
    opts?.dailyAmountOverride && opts.dailyAmountOverride > 0
      ? Math.round(opts.dailyAmountOverride)
      : calculateDailyContribution(safePrice, safeSize, cycleDays);
  const totalDays = calculateTotalDurationDays(safeSize, cycleDays);

  return {
    size: safeSize,
    cycleDays,
    dailyAmount,
    totalAmount: safePrice,
    description:
      opts?.description ||
      `${safeSize} members · KSh ${dailyAmount.toLocaleString()} daily · ${totalDays}-day total (1 item every ${cycleDays} days)`,
  };
}

/**
 * Returns all 10 member speeds in descending order: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1.
 * Preserves merchant-customized values for sizes matching the product price and
 * computes any missing speed tiers consistently.
 */
export function buildAllSpeedOptions(
  price: number,
  existingOptions?: SpeedOption[] | null,
  soloMonths?: number
): SpeedOption[] {
  const safePrice = Math.max(0, Number(price) || 0);
  const list = Array.isArray(existingOptions) ? existingOptions : [];

  return STANDARD_MEMBER_SPEEDS.map((sz) => {
    const existing = list.find((s) => Number(s.size) === sz);

    if (sz === 1) {
      if (typeof soloMonths === 'number') {
        return buildSpeedOption(safePrice, 1, { soloMonths });
      }
      if (
        existing &&
        Number(existing.dailyAmount) > 0 &&
        Number(existing.totalAmount) === safePrice
      ) {
        return buildSpeedOption(safePrice, 1, {
          cycleDays: Number(existing.cycleDays) || DEFAULT_SOLO_MONTHS * 30,
          dailyAmountOverride: Number(existing.dailyAmount),
          description: existing.description,
        });
      }
      return buildSpeedOption(safePrice, 1, { soloMonths: DEFAULT_SOLO_MONTHS });
    }

    if (
      existing &&
      Number(existing.dailyAmount) > 0 &&
      Number(existing.totalAmount) === safePrice
    ) {
      return buildSpeedOption(safePrice, sz, {
        cycleDays: Number(existing.cycleDays) || 10,
        dailyAmountOverride: Number(existing.dailyAmount),
        description: existing.description,
      });
    }

    return buildSpeedOption(safePrice, sz);
  });
}

export function getLowestGroupDailyAmount(
  price: number,
  speedOptions?: SpeedOption[] | null
): number {
  const all = buildAllSpeedOptions(price, speedOptions);
  const valid = all.map((s) => Number(s.dailyAmount)).filter((n) => n > 0);
  return valid.length > 0 ? Math.min(...valid) : calculateDailyContribution(price, 10, 10);
}
