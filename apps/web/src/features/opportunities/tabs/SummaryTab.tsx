import {
  Alert,
  Button,
  Group,
  List,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
} from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CloseSchema,
  FORECAST_CATEGORIES,
  OpportunityUpdateSchema,
  RISK_LEVELS,
  transitionProcess,
} from '@wcrm/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { api } from '../../../api/client';
import { canDo, useMe } from '../../../auth/useMe';
import { RuleErrors, useRuleMessage } from '../../../components/RuleErrors';
import { EnumSelect, useFieldError } from '../../../components/ui';
import { fmtDateTime } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';

type UpdateForm = z.input<typeof OpportunityUpdateSchema>;

export function SummaryTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const fe = useFieldError();
  const msg = useRuleMessage();
  const { data: me } = useMe();
  const [backOpen, setBackOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [backTo, setBackTo] = useState<string | null>(null);
  const [backReason, setBackReason] = useState('');
  const inv = [['opportunity', opp.id], ['opportunities']];
  const advance = useAction(
    (toStage: number) => api.post(`/opportunities/${opp.id}/transitions`, { toStage }),
    { invalidate: inv },
  );
  const back = useAction(
    () =>
      api.post(`/opportunities/${opp.id}/transitions`, {
        toStage: Number(backTo),
        reason: backReason,
      }),
    {
      invalidate: inv,
      onDone: () => setBackOpen(false),
    },
  );
  const form = useForm<UpdateForm>({
    resolver: zodResolver(OpportunityUpdateSchema),
    values: {
      rowVersion: opp.rowVersion,
      name: opp.name,
      amount: opp.amount,
      expectedCloseDate: opp.expectedCloseDate,
      decisionDate: opp.decisionDate,
      pain: opp.pain,
      sponsorContactId: opp.sponsorContactId,
      decisionCriteria: opp.decisionCriteria,
      forecastCategory: opp.forecastCategory as UpdateForm['forecastCategory'],
      risk: opp.risk as UpdateForm['risk'],
      competitors: opp.competitors,
    },
  });
  const save = useAction((v: UpdateForm) => api.patch(`/opportunities/${opp.id}`, v), {
    invalidate: inv,
  });
  const closeForm = useForm<z.input<typeof CloseSchema>>({
    resolver: zodResolver(CloseSchema),
    defaultValues: { status: 'LOST' },
  });
  const close = useAction(
    (v: z.input<typeof CloseSchema>) => api.post(`/opportunities/${opp.id}/close`, v),
    {
      invalidate: inv,
      onDone: () => setCloseOpen(false),
    },
  );
  const canWrite = canDo(me, 'P2', 'write');
  const next = opp.nextGate;
  const canAdvance = next && canDo(me, transitionProcess(next.toStage), 'write');
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }}>
      <Stack>
        {opp.status === 'OPEN' && next && (
          <Paper withBorder p="md" data-testid="next-gate">
            {next.ok ? (
              <Alert color="green">
                {t('opps.gateOk', { stage: t(`enums:stage.${next.toStage}`) })}
              </Alert>
            ) : (
              <Alert
                color="yellow"
                title={t('opps.nextGate', { stage: t(`enums:stage.${next.toStage}`) })}
              >
                <List size="sm">
                  {next.failures.map((f, i) => (
                    <List.Item key={i}>{msg(f)}</List.Item>
                  ))}
                </List>
              </Alert>
            )}
            <Group mt="sm">
              {canAdvance && (
                <Button
                  onClick={() => advance.mutate(next.toStage)}
                  loading={advance.isPending}
                  data-testid="advance-btn"
                >
                  {t('actions.advance', { stage: t(`enums:stage.${next.toStage}`) })}
                </Button>
              )}
              {canWrite && opp.stage > 0 && (
                <Button variant="default" onClick={() => setBackOpen(true)}>
                  {t('actions.back')}
                </Button>
              )}
              {canWrite && opp.stage < 7 && (
                <Button variant="light" color="red" onClick={() => setCloseOpen(true)}>
                  {t('opps.closeTitle')}
                </Button>
              )}
            </Group>
            <RuleErrors error={advance.error} />
          </Paper>
        )}
        {opp.stage >= 8 && <Alert color="blue">{t('opps.derivedInfo')}</Alert>}
        {opp.status !== 'OPEN' && (
          <Alert color="red">
            {t(`enums:oppStatus.${opp.status}`)}: {opp.closeReason}{' '}
            {opp.winningCompetitor ? `· ${opp.winningCompetitor}` : ''}
          </Alert>
        )}
        <Paper withBorder p="md">
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <Stack gap="xs">
              <TextInput label={t('fields.name')} {...form.register('name')} />
              <Textarea label={t('fields.pain')} autosize minRows={2} {...form.register('pain')} />
              <Controller
                control={form.control}
                name="sponsorContactId"
                render={({ field }) => (
                  <Select
                    label={t('fields.sponsor')}
                    clearable
                    data={opp.contacts.map((c) => ({
                      value: c.id,
                      label: `${c.firstName} ${c.lastName}`,
                    }))}
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
              <Textarea
                label={t('fields.decisionCriteria')}
                autosize
                minRows={2}
                {...form.register('decisionCriteria')}
              />
              <SimpleGrid cols={2}>
                <TextInput
                  type="date"
                  label={t('fields.decisionDate')}
                  {...form.register('decisionDate', { setValueAs: (v) => v || null })}
                  error={fe(form.formState.errors.decisionDate)}
                />
                <TextInput
                  type="date"
                  label={t('fields.expectedClose')}
                  {...form.register('expectedCloseDate')}
                />
                <TextInput
                  label={`${t('fields.amount')} (${opp.amountCurrency})`}
                  {...form.register('amount')}
                  error={fe(form.formState.errors.amount)}
                />
                <EnumSelect
                  control={form.control}
                  name="forecastCategory"
                  ns="forecast"
                  values={FORECAST_CATEGORIES}
                  label={t('fields.forecast')}
                  clearable
                />
                <EnumSelect
                  control={form.control}
                  name="risk"
                  ns="risk"
                  values={RISK_LEVELS}
                  label={t('fields.risk')}
                  clearable
                />
                <TextInput
                  label={t('fields.zmpProjectId')}
                  value={opp.zmpProjectId ?? '—'}
                  readOnly
                />
              </SimpleGrid>
              <RuleErrors error={save.error} />
              {canWrite && (
                <Button type="submit" loading={save.isPending} w="fit-content">
                  {t('actions.save')}
                </Button>
              )}
            </Stack>
          </form>
        </Paper>
      </Stack>
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          {t('fields.stage')}
        </Title>
        <Timeline active={opp.stageHistory.length} bulletSize={14} lineWidth={2}>
          {opp.stageHistory.map((h) => (
            <Timeline.Item
              key={h.id}
              title={
                h.toStatus !== 'OPEN'
                  ? t(`enums:oppStatus.${h.toStatus}`)
                  : t(`enums:stage.${h.toStage}`)
              }
            >
              <Text size="xs" c="dimmed">
                {fmtDateTime(h.changedAt)} {h.derived ? '· auto' : ''}
              </Text>
              {h.reason && <Text size="xs">{h.reason}</Text>}
            </Timeline.Item>
          ))}
        </Timeline>
      </Paper>
      <Modal opened={backOpen} onClose={() => setBackOpen(false)} title={t('opps.backTitle')}>
        <Stack>
          <Select
            label={t('fields.stage')}
            data={Array.from({ length: Math.min(opp.stage, 8) }, (_, i) => ({
              value: String(i),
              label: t(`enums:stage.${i}`),
            }))}
            value={backTo}
            onChange={setBackTo}
          />
          <Textarea
            label={t('fields.reason')}
            value={backReason}
            onChange={(e) => setBackReason(e.currentTarget.value)}
          />
          <RuleErrors error={back.error} />
          <Button onClick={() => back.mutate(undefined)} disabled={!backTo}>
            {t('actions.confirm')}
          </Button>
        </Stack>
      </Modal>
      <Modal opened={closeOpen} onClose={() => setCloseOpen(false)} title={t('opps.closeTitle')}>
        <form onSubmit={closeForm.handleSubmit((v) => close.mutate(v))}>
          <Stack>
            <EnumSelect
              control={closeForm.control}
              name="status"
              ns="oppStatus"
              values={['LOST', 'DISCARDED', 'NOT_QUOTED']}
              label={t('fields.status')}
            />
            <Textarea label={t('fields.reason')} {...closeForm.register('reason')} />
            <TextInput
              label={t('fields.winningCompetitor')}
              {...closeForm.register('winningCompetitor')}
            />
            <RuleErrors error={close.error} />
            <Button type="submit" color="red">
              {t('actions.close')}
            </Button>
          </Stack>
        </form>
      </Modal>
    </SimpleGrid>
  );
}
