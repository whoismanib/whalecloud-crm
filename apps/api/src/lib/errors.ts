import type { RuleFailure } from '@wcrm/shared';

/** RFC 9457 problem+json error (API.md §1.4). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly errors: Array<
      RuleFailure | { path: string; code: string; message: string }
    > = [],
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, errors: AppError['errors'] = []) =>
  new AppError(400, code, code, errors);
export const unauthenticated = (code = 'UNAUTHENTICATED') => new AppError(401, code);
export const forbidden = (code = 'FORBIDDEN') => new AppError(403, code);
export const notFound = () => new AppError(404, 'NOT_FOUND');
export const conflict = (code = 'CONFLICT', errors: RuleFailure[] = []) =>
  new AppError(409, code, code, errors);
/** 422 BUSINESS_RULE_VIOLATION with rule failure codes. */
export const ruleViolation = (failures: RuleFailure[], detail?: string) =>
  new AppError(
    422,
    'BUSINESS_RULE_VIOLATION',
    detail ?? failures.map((f) => f.code).join(', '),
    failures,
  );
export const gateFailed = (failures: RuleFailure[], from: number, to: number) =>
  new AppError(422, 'STAGE_GATE_FAILED', `Transition ${from}→${to} blocked`, failures);

/** Throws a rule violation when the list is not empty. */
export function assertRules(failures: RuleFailure[]): void {
  if (failures.length) throw ruleViolation(failures);
}
