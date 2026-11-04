import { describe, expect, it } from 'vitest';
import {
  aggregateLineItems,
  contractMargin,
  lineMargins,
  netIncomeMargin,
  priceFromCost,
  toPct,
} from './margins';
import { DEFAULT_SETTINGS } from '../schemas/settings';

describe('margins (P6-01, source "Cómo se calcula el margen")', () => {
  it('Equifiber OSS fase 1: net-income margin 58.0 % and contract margin 50.3 %', () => {
    const ni = netIncomeMargin('1633644', '686772');
    const cm = contractMargin('1881878', '686772', '248234');
    expect(toPct(ni!)).toBe('58.0');
    expect(toPct(cm!)).toBe('50.3');
    expect(ni).toBe('0.579607');
    expect(cm).toBe('0.503153');
  });

  it('aggregates line items to the same Equifiber figures', () => {
    const agg = aggregateLineItems([
      { cost: '166640', priceExTax: '476114', netIncome: '413311', commercialCosts: '62803' },
      { cost: '520132', priceExTax: '1405764', netIncome: '1220333', commercialCosts: '185431' },
    ]);
    expect(agg.totalCost).toBe('686772.00');
    expect(agg.totalPriceExTax).toBe('1881878.00');
    expect(agg.totalNetIncome).toBe('1633644.00');
    expect(agg.totalCommercialCosts).toBe('248234.00');
    expect(toPct(agg.netMargin!)).toBe('58.0');
    expect(toPct(agg.contractMargin!)).toBe('50.3');
    expect(agg.profit).toBe('946872.00');
  });

  it('price = cost / (1 − target): software 65 %, implementation 63 %, L3 79.5 %', () => {
    expect(Number(priceFromCost(166640, 0.65))).toBeCloseTo(476114, -1);
    expect(Number(priceFromCost(520133, 0.63))).toBeCloseTo(1405764, -1);
    // source rounds the L3 target; 434.688 → 2.120.428 (±2 USD)
    expect(Math.abs(Number(priceFromCost(434688, 0.795)) - 2120428)).toBeLessThan(3);
    expect(priceFromCost(100, 0)).toBe('100.00');
  });

  it('rejects invalid targets and handles zero denominators', () => {
    expect(() => priceFromCost(100, 1)).toThrow(RangeError);
    expect(() => priceFromCost(100, -0.1)).toThrow(RangeError);
    expect(netIncomeMargin(0, 10)).toBeNull();
    expect(contractMargin(0, 10, 0)).toBeNull();
    expect(aggregateLineItems([]).netMargin).toBeNull();
  });

  it('computes per-line margins with default targets by item type', () => {
    const m = lineMargins(
      {
        lineNo: 4,
        itemType: 'SUPPORT_L1L2',
        cost: '36160',
        priceExTax: '100000',
        netIncome: '100000',
      },
      DEFAULT_SETTINGS['margins.targets'],
    );
    expect(m.netMargin).toBe('0.638400');
    expect(m.contractMargin).toBe('0.638400');
    expect(m.targetMargin).toBe('0.680000');
    expect(() =>
      lineMargins({ lineNo: 1, itemType: 'HARDWARE', cost: 1, priceExTax: 2, netIncome: 2 }, {}),
    ).toThrow(RangeError);
    expect(
      lineMargins(
        {
          lineNo: 1,
          itemType: 'HARDWARE',
          cost: 1,
          priceExTax: 2,
          netIncome: 2,
          targetMargin: 0.4,
        },
        {},
      ).targetMargin,
    ).toBe('0.400000');
  });
});
