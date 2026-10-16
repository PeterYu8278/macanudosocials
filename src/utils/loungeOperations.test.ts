import { describe, expect, it } from 'vitest';
import { businessCutoff, emptyLoungeOperations, firstVisitCutoff, loungeAvailability, localBusinessDate, validateLoungeOperations, visitChargeQuote } from './loungeOperations';
const at = (time: string) => new Date(`2026-10-15T${time}:00+08:00`);
const operations = () => ({ ...emptyLoungeOperations(), enabled: true, week: Array.from({ length: 7 }, () => ({ open: true, startsAt: '12:00' })) });

describe('lounge weekly hours and 23:00 cutoff', () => {
  it('defaults every day to 10:00-23:00 without enabling automated closing', () => {
    const defaults = emptyLoungeOperations();
    expect(defaults.enabled).toBe(false);
    expect(defaults.dailyReportEnabled).toBe(false);
    expect(defaults.week).toEqual(Array.from({ length: 7 }, () => ({ open: true, startsAt: '10:00' })));
    const enabled = { ...defaults, enabled: true };
    expect(loungeAvailability(enabled, at('09:59')).allowed).toBe(false);
    expect(loungeAvailability(enabled, at('10:00')).allowed).toBe(true);
    expect(loungeAvailability(enabled, at('22:59')).allowed).toBe(true);
    expect(loungeAvailability(enabled, at('23:00')).allowed).toBe(false);
    defaults.week[0].open = false;
    expect(defaults.week[1].open).toBe(true);
    expect(emptyLoungeOperations().week[0].open).toBe(true);
  });
  it('uses Malaysian calendar dates and UTC cutoffs', () => {
    expect(localBusinessDate(at('00:00'))).toBe('2026-10-15');
    expect(businessCutoff('2026-10-15').toISOString()).toBe('2026-10-15T15:00:00.000Z');
    expect(firstVisitCutoff(at('22:59'))).toEqual(at('23:00'));
  });
  it('allows opening inclusively and closes exactly at 23:00', () => {
    expect(loungeAvailability(operations(), at('11:59')).allowed).toBe(false);
    expect(loungeAvailability(operations(), at('12:00')).allowed).toBe(true);
    expect(loungeAvailability(operations(), at('22:59')).allowed).toBe(true);
    expect(loungeAvailability(operations(), at('23:00'))).toEqual({ allowed: false, nextOpen: '2026-10-16T04:00:00.000Z' });
  });
  it('respects weekly rest days and special date overrides', () => {
    const ops = operations(); ops.week[4].open = false;
    expect(loungeAvailability(ops, at('13:00')).allowed).toBe(false);
    ops.exceptions.push({ date: '2026-10-15', open: true, startsAt: '14:00' });
    expect(loungeAvailability(ops, at('13:00')).allowed).toBe(false);
    expect(loungeAvailability(ops, at('14:00')).allowed).toBe(true);
    ops.exceptions[0].open = false;
    expect(loungeAvailability(ops, at('14:00')).allowed).toBe(false);
  });
  it('rejects invalid times, duplicate exceptions and dates', () => {
    for (const startsAt of ['23:00', '24:00', '9:00', '12:60', '']) {
      const ops = operations(); ops.week[0].startsAt = startsAt;
      expect(() => validateLoungeOperations(ops)).toThrow('invalid-hours');
    }
    const ops = operations(); ops.exceptions.push({ date: '2026-02-30', open: false, startsAt: '' });
    expect(() => validateLoungeOperations(ops)).toThrow();
  });
  it('leaves unconfigured lounges on the legacy path', () => {
    expect(loungeAvailability(undefined, at('23:59')).allowed).toBe(true);
    expect(() => validateLoungeOperations(emptyLoungeOperations())).not.toThrow();
  });
});

describe('closing fee quotes', () => {
  const base = { checkInAt: at('20:00'), hourlyRate: 20, realtimeDeductionsEnabled: true, realtimePointsDeducted: 20, deductionCount: 1 };
  it('charges only unpaid intervals, not the initial hour again', () => {
    expect(visitChargeQuote(base, at('22:59'))).toMatchObject({ total: 60, due: 40, billedHours: 3, hoursAdjustment: 2 });
    expect(visitChargeQuote({ ...base, realtimePointsDeducted: 60, deductionCount: 5 }, at('22:59')).due).toBe(0);
  });
  it('preserves the existing inclusive half-hour boundary semantics', () => {
    expect(visitChargeQuote(base, at('20:59')).total).toBe(20);
    expect(visitChargeQuote(base, at('21:00')).total).toBe(30);
  });
  it('freezes an earlier pending checkout time', () => {
    expect(visitChargeQuote({ ...base, checkoutPending: { requestedAt: at('21:20') } }, at('23:00')).total).toBe(30);
  });
  it('retains waiver and day pass overage semantics', () => {
    expect(visitChargeQuote({ ...base, isFirstVisitAfterRenewal: true, realtimeDeductionsEnabled: false, realtimePointsDeducted: 0 }, at('23:00')).total).toBe(0);
    expect(visitChargeQuote({ ...base, dayPass: { isPurchased: true, config: { cost: 100, freeHours: 2, hourlyRateAfter: 30 } } }, at('23:00')))
      .toMatchObject({ total: 130, due: 30, hoursAdjustment: 0 });
  });
});
