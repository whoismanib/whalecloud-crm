import { DOC_KINDS, type DocKind } from '../enums';
import type { RuleFailure } from './common';

/** PAÍS_CLIENTE_TIPO_NÚMERO_VERSIÓN_FECHA.ext (CONVENTIONS §2, CORE-07). */
export const REPOSITORY_NAME_REGEX =
  /^([A-Z]{2})_([A-Z0-9-]{2,30})_(NDA|MSA|SOW|OC|CR|AC|REC|INV|PROP|BC|SHEET|BRD|RFP|TC|USAGE|OTHER)_([A-Za-z0-9-]{1,30})_(v\d+(?:\.\d+)?)_(\d{4}-\d{2}-\d{2})\.([a-z0-9]{2,5})$/;

export interface RepositoryName {
  country: string;
  client: string;
  type: DocKind;
  number: string;
  version: string;
  date: string;
  ext: string;
}

export function parseRepositoryName(name: string): RepositoryName | null {
  const m = REPOSITORY_NAME_REGEX.exec(name);
  if (!m) return null;
  const [, country, client, type, number, version, date, ext] = m as unknown as string[];
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  return {
    country: country!,
    client: client!,
    type: type as DocKind,
    number: number!,
    version: version!,
    date: date!,
    ext: ext!,
  };
}

/** Normalises a free-text client/number segment to the allowed alphabet. */
export function normalizeSegment(s: string, upper = true): string {
  const base = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return upper ? base.toUpperCase() : base;
}

export function buildRepositoryName(p: {
  country: string;
  client: string;
  type: DocKind;
  number: string;
  version: string | number;
  date: string;
  ext: string;
}): string {
  if (!DOC_KINDS.includes(p.type)) throw new RangeError(`Invalid doc type ${p.type}`);
  const version = String(p.version).startsWith('v') ? String(p.version) : `v${p.version}`;
  const name = [
    p.country.toUpperCase(),
    normalizeSegment(p.client),
    p.type,
    normalizeSegment(p.number, false) || 'NA',
    version,
    p.date,
  ].join('_');
  return `${name}.${p.ext.toLowerCase().replace(/^\./, '')}`;
}

export function validateRepositoryName(name: string): RuleFailure[] {
  return parseRepositoryName(name) ? [] : [{ code: 'NAMING_INVALID', params: { name } }];
}
