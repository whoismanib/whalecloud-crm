import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../app/i18n';
import { ApiError } from '../api/client';
import { RuleErrors } from './RuleErrors';

const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>);

describe('RuleErrors (Spanish rule messages)', () => {
  it('renders stage-gate failures in es-CL with params', () => {
    const err = new ApiError(422, 'STAGE_GATE_FAILED', [
      { code: 'ECONOMIC_BUYER_MISSING' },
      { code: 'CASHFLOW_TC_MISMATCH', params: { cashflow: '20/20/50/10', tc: '30/50/20' } },
      { code: 'EVIDENCE_MISSING', params: { engine: 'A', types: ['SIGNED_AC', 'RECEPTION'] } },
    ]);
    wrap(<RuleErrors error={err} />);
    expect(screen.getByText('No se puede cambiar de etapa:')).toBeTruthy();
    expect(screen.getByText(/No se pide precio sin comprador económico/)).toBeTruthy();
    expect(
      screen.getByText(
        'Los hitos del flujo de caja (20/20/50/10) no coinciden con la T&C (30/50/20).',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Falta evidencia para el motor A: AC firmada, Recepción.'),
    ).toBeTruthy();
  });

  it('renders validation errors with the field path', () => {
    wrap(
      <RuleErrors
        error={
          new ApiError(400, 'VALIDATION_ERROR', [
            { path: 'standardName', code: 'NAMING_INVALID', message: 'NAMING_INVALID' },
          ])
        }
      />,
    );
    expect(screen.getByText(/standardName: No cumple/)).toBeTruthy();
  });

  it('renders nothing without errors', () => {
    wrap(<RuleErrors />);
    expect(screen.queryByTestId('rule-errors')).toBeNull();
  });
});
