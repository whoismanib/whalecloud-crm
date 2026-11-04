import { D, Decimal, fraction, money, type Numeric } from './common';
import type { LineItemType } from '../enums';

/**
 * Price ex-tax from cost and target margin (source §"Las tres fórmulas" 1):
 * price = cost / (1 − target).
 */
export function priceFromCost(cost: Numeric, targetMargin: Numeric): string {
  const t = D(targetMargin);
  if (t.gte(1) || t.lt(0)) throw new RangeError('targetMargin must be in [0, 1)');
  return money(D(cost).div(new Decimal(1).minus(t)));
}

/** Net-income margin (软收毛利率) = (net income − cost) / net income. Null when net income is 0. */
export function netIncomeMargin(netIncome: Numeric, cost: Numeric): string | null {
  const ni = D(netIncome);
  if (ni.isZero()) return null;
  return fraction(ni.minus(D(cost)).div(ni));
}

/** Contract margin (合同毛利率) = (price − cost − commercial costs) / price. Null when price is 0. */
export function contractMargin(
  price: Numeric,
  cost: Numeric,
  commercialCosts: Numeric,
): string | null {
  const p = D(price);
  if (p.isZero()) return null;
  return fraction(p.minus(D(cost)).minus(D(commercialCosts)).div(p));
}

export interface LineItemInput {
  lineNo: number;
  itemType: LineItemType;
  cost: Numeric;
  priceExTax: Numeric;
  netIncome: Numeric;
  commercialCosts?: Numeric;
  targetMargin?: Numeric | null;
}

export interface LineItemMargins {
  lineNo: number;
  itemType: LineItemType;
  netMargin: string | null;
  contractMargin: string | null;
  targetMargin: string;
}

export function lineMargins(
  item: LineItemInput,
  targets: Partial<Record<LineItemType, number>>,
): LineItemMargins {
  const target = item.targetMargin ?? targets[item.itemType];
  if (target === undefined || target === null) {
    throw new RangeError(`No target margin for ${item.itemType}`);
  }
  return {
    lineNo: item.lineNo,
    itemType: item.itemType,
    netMargin: netIncomeMargin(item.netIncome, item.cost),
    contractMargin: contractMargin(item.priceExTax, item.cost, item.commercialCosts ?? 0),
    targetMargin: fraction(target),
  };
}

export interface AggregateMargins {
  totalCost: string;
  totalPriceExTax: string;
  totalNetIncome: string;
  totalCommercialCosts: string;
  netMargin: string | null;
  contractMargin: string | null;
  /** Gross profit used for the Profit KPI: price − cost − commercial costs. */
  profit: string;
}

export function aggregateLineItems(
  items: ReadonlyArray<
    Pick<LineItemInput, 'cost' | 'priceExTax' | 'netIncome' | 'commercialCosts'>
  >,
): AggregateMargins {
  let cost = new Decimal(0);
  let price = new Decimal(0);
  let ni = new Decimal(0);
  let cc = new Decimal(0);
  for (const i of items) {
    cost = cost.plus(D(i.cost));
    price = price.plus(D(i.priceExTax));
    ni = ni.plus(D(i.netIncome));
    cc = cc.plus(D(i.commercialCosts ?? 0));
  }
  return {
    totalCost: money(cost),
    totalPriceExTax: money(price),
    totalNetIncome: money(ni),
    totalCommercialCosts: money(cc),
    netMargin: netIncomeMargin(ni, cost),
    contractMargin: contractMargin(price, cost, cc),
    profit: money(price.minus(cost).minus(cc)),
  };
}

/** Formats a fraction string as a percentage with one decimal (es-CL style handled by UI). */
export function toPct(fractionValue: Numeric, decimals = 1): string {
  return D(fractionValue)
    .times(100)
    .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
    .toFixed(decimals);
}
