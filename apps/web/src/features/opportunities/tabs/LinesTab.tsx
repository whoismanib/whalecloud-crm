import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import {
  aggregateLineItems,
  CAPEX_OPEX,
  compareCashflowVsTc,
  detectConditions,
  LINE_ITEM_TYPES,
  routeApproval,
  type LineItemDto,
  type MilestoneTrigger,
} from '@wcrm/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { usePublicSettings } from '../../../api/settings';
import { hasAction, useMe } from '../../../auth/useMe';
import { RuleErrors, useRuleMessage } from '../../../components/RuleErrors';
import { EnumBadge, ScrollTable } from '../../../components/ui';
import { fmtMoney, fmtPct } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';
import { usePriceRequest } from './PriceRequestTab';

interface SheetLine {
  id: string;
  lineNo: number;
  block: string | null;
  itemType: string;
  capexOpex: string;
  cost: string;
  priceExTax: string;
  netIncome: string;
  commercialCosts: string;
  targetMargin: string;
  netMargin: string | null;
  contractMargin: string | null;
  band: string | null;
}
interface SheetMs {
  seq: number;
  pct: string;
  trigger: string;
}
export interface Sheet {
  id: string;
  versionLabel: string;
  currency: string;
  totalPriceExTax: string;
  totalCost: string;
  totalNetIncome: string;
  totalCommercialCosts: string;
  netMargin: string | null;
  contractMargin: string | null;
  proposedBand: string | null;
  offerValidityDays: number;
  paymentTermDays: number | null;
  lineItems: SheetLine[];
  cashflowMilestones: SheetMs[];
  tcMilestones: SheetMs[];
  milestoneCheck: {
    equal: boolean;
    diffs: { seq: number; field: string; cashflow: string | null; tc: string | null }[];
  };
}

const DEFAULT_TRIGGERS: MilestoneTrigger[] = [
  'SIGNATURE',
  'SRS_DONE',
  'UAT',
  'GO_LIVE',
  'OTHER',
  'OTHER',
];
const toMs = (s: string) =>
  s
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((pct, i) => ({ seq: i + 1, pct, trigger: DEFAULT_TRIGGERS[i] ?? 'OTHER' }));

function SheetView({ sheet }: { sheet: Sheet }) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Group>
        <Title order={5}>{t('sheet.current', { label: sheet.versionLabel })}</Title>
        {sheet.proposedBand && <EnumBadge ns="band" value={sheet.proposedBand} />}
      </Group>
      <ScrollTable striped withTableBorder data-testid="sheet-lines">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('sheet.lineNo')}</Table.Th>
            <Table.Th>{t('sheet.itemType')}</Table.Th>
            <Table.Th>{t('sheet.cost')}</Table.Th>
            <Table.Th>{t('sheet.price')}</Table.Th>
            <Table.Th>{t('sheet.netIncome')}</Table.Th>
            <Table.Th>{t('sheet.commercialCosts')}</Table.Th>
            <Table.Th>{t('sheet.netMargin')}</Table.Th>
            <Table.Th>{t('sheet.contractMargin')}</Table.Th>
            <Table.Th>{t('sheet.target')}</Table.Th>
            <Table.Th>{t('sheet.band')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sheet.lineItems.map((l) => (
            <Table.Tr key={l.id}>
              <Table.Td>{l.lineNo}</Table.Td>
              <Table.Td>
                {t(`enums:lineItem.${l.itemType}`)}
                <Text size="xs" c="dimmed">
                  {l.block} · {l.capexOpex}
                </Text>
              </Table.Td>
              <Table.Td>{fmtMoney(l.cost, sheet.currency)}</Table.Td>
              <Table.Td>{fmtMoney(l.priceExTax, sheet.currency)}</Table.Td>
              <Table.Td>{fmtMoney(l.netIncome, sheet.currency)}</Table.Td>
              <Table.Td>{fmtMoney(l.commercialCosts, sheet.currency)}</Table.Td>
              <Table.Td fw={600}>{fmtPct(l.netMargin)}</Table.Td>
              <Table.Td>{fmtPct(l.contractMargin)}</Table.Td>
              <Table.Td>{fmtPct(l.targetMargin)}</Table.Td>
              <Table.Td>
                <EnumBadge ns="band" value={l.band} size="xs" />
              </Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr fw={700}>
            <Table.Td colSpan={2}>{t('sheet.totals')}</Table.Td>
            <Table.Td>{fmtMoney(sheet.totalCost, sheet.currency)}</Table.Td>
            <Table.Td>{fmtMoney(sheet.totalPriceExTax, sheet.currency)}</Table.Td>
            <Table.Td>{fmtMoney(sheet.totalNetIncome, sheet.currency)}</Table.Td>
            <Table.Td>{fmtMoney(sheet.totalCommercialCosts, sheet.currency)}</Table.Td>
            <Table.Td data-testid="sheet-net-margin">{fmtPct(sheet.netMargin)}</Table.Td>
            <Table.Td data-testid="sheet-contract-margin">{fmtPct(sheet.contractMargin)}</Table.Td>
            <Table.Td colSpan={2} />
          </Table.Tr>
        </Table.Tbody>
      </ScrollTable>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder p="sm">
          <Group justify="space-between">
            <Text fw={600}>
              {t('sheet.cashflow')} vs {t('sheet.tc')}
            </Text>
            <Badge color={sheet.milestoneCheck.equal ? 'green' : 'red'}>
              {sheet.milestoneCheck.equal ? t('sheet.milestonesEqual') : t('sheet.milestonesDiff')}
            </Badge>
          </Group>
          <Text size="sm">
            {t('sheet.cashflow')}:{' '}
            {sheet.cashflowMilestones.map((m) => Number(m.pct)).join(' / ') || '—'}
          </Text>
          <Text size="sm">
            {t('sheet.tc')}: {sheet.tcMilestones.map((m) => Number(m.pct)).join(' / ') || '—'}
          </Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="sm">
            {t('sheet.offerValidityDays')}: {sheet.offerValidityDays}
          </Text>
          <Text size="sm">
            {t('sheet.paymentTermDays')}: {sheet.paymentTermDays ?? '—'}
          </Text>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}

function NewVersion({ prId, opp }: { prId: string } & TabProps) {
  const { t } = useTranslation();
  const msg = useRuleMessage();
  const settings = usePublicSettings();
  const [label, setLabel] = useState('1.0');
  const [lines, setLines] = useState<LineItemDto[]>([
    {
      lineNo: 1,
      itemType: 'OWN_SOFTWARE',
      capexOpex: 'CAPEX',
      cost: '0',
      priceExTax: '0',
      netIncome: '0',
      commercialCosts: '0',
    },
  ]);
  const [cashflow, setCashflow] = useState('30/50/20');
  const [tc, setTc] = useState('30/50/20');
  const [term, setTerm] = useState<number>(45);
  const [validity, setValidity] = useState<number>(30);
  const [unlimited, setUnlimited] = useState(false);
  const preview = useMemo(() => {
    if (!settings.data) return null;
    try {
      const agg = aggregateLineItems(lines);
      const route = routeApproval(
        lines.map((l) => ({ ...l, targetMargin: null })),
        detectConditions(
          { paymentTermDays: term, unlimitedLiability: unlimited },
          settings.data.settings,
        ),
        settings.data.settings,
      );
      return { agg, route, cmp: compareCashflowVsTc(toMs(cashflow), toMs(tc)) };
    } catch {
      return null;
    }
  }, [lines, cashflow, tc, term, unlimited, settings.data]);
  const save = useAction(
    () =>
      api.post(`/price-requests/${prId}/sheet-versions`, {
        versionLabel: label,
        currency: 'USD',
        lineItems: lines,
        cashflowMilestones: toMs(cashflow),
        tcMilestones: toMs(tc),
        tcTerms: {
          offerValidityDays: validity,
          paymentTermDays: term,
          unlimitedLiability: unlimited,
        },
      }),
    {
      invalidate: [
        ['opportunity', opp.id],
        ['priceRequest', prId],
      ],
    },
  );
  const upd = (i: number, patch: Partial<LineItemDto>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Paper withBorder p="md">
      <Title order={5} mb="xs">
        {t('sheet.newVersion')}
      </Title>
      <Group mb="xs">
        <TextInput
          size="xs"
          label={t('sheet.versionLabel')}
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <TextInput
          size="xs"
          label={`${t('sheet.cashflow')} %`}
          value={cashflow}
          onChange={(e) => setCashflow(e.currentTarget.value)}
        />
        <TextInput
          size="xs"
          label={`${t('sheet.tc')} %`}
          value={tc}
          onChange={(e) => setTc(e.currentTarget.value)}
        />
        <NumberInput
          size="xs"
          label={t('sheet.paymentTermDays')}
          value={term}
          onChange={(v) => setTerm(Number(v))}
          w={140}
        />
        <NumberInput
          size="xs"
          label={t('sheet.offerValidityDays')}
          value={validity}
          onChange={(v) => setValidity(Number(v))}
          w={140}
        />
        <Checkbox
          mt={22}
          size="xs"
          label={t('sheet.unlimitedLiability')}
          checked={unlimited}
          onChange={(e) => setUnlimited(e.currentTarget.checked)}
        />
      </Group>
      <ScrollTable>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('sheet.itemType')}</Table.Th>
            <Table.Th>{t('sheet.capexOpex')}</Table.Th>
            <Table.Th>{t('sheet.cost')}</Table.Th>
            <Table.Th>{t('sheet.price')}</Table.Th>
            <Table.Th>{t('sheet.netIncome')}</Table.Th>
            <Table.Th>{t('sheet.commercialCosts')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lines.map((l, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <Select
                  size="xs"
                  data={LINE_ITEM_TYPES.map((x) => ({ value: x, label: t(`enums:lineItem.${x}`) }))}
                  value={l.itemType}
                  onChange={(v) => upd(i, { itemType: v as LineItemDto['itemType'] })}
                />
              </Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  w={100}
                  data={[...CAPEX_OPEX]}
                  value={l.capexOpex}
                  onChange={(v) => upd(i, { capexOpex: v as LineItemDto['capexOpex'] })}
                />
              </Table.Td>
              {(['cost', 'priceExTax', 'netIncome', 'commercialCosts'] as const).map((k) => (
                <Table.Td key={k}>
                  <TextInput
                    size="xs"
                    value={String(l[k] ?? '')}
                    onChange={(e) => upd(i, { [k]: e.currentTarget.value })}
                  />
                </Table.Td>
              ))}
              <Table.Td>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() =>
                    setLines(
                      lines.filter((_, j) => j !== i).map((x, j) => ({ ...x, lineNo: j + 1 })),
                    )
                  }
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Button
        size="xs"
        variant="default"
        mt="xs"
        onClick={() =>
          setLines([
            ...lines,
            {
              lineNo: lines.length + 1,
              itemType: 'IMPLEMENTATION',
              capexOpex: 'CAPEX',
              cost: '0',
              priceExTax: '0',
              netIncome: '0',
              commercialCosts: '0',
            },
          ])
        }
      >
        {t('sheet.addLine')}
      </Button>
      {preview && (
        <Alert mt="sm" color={preview.route.blocked ? 'red' : 'blue'} title={t('sheet.preview')}>
          <Text size="sm">
            {t('sheet.netMargin')}: {fmtPct(preview.agg.netMargin)} · {t('sheet.contractMargin')}:{' '}
            {fmtPct(preview.agg.contractMargin)} ·{' '}
            {t('approval.band', { band: t(`enums:band.${preview.route.band}`) })}
          </Text>
          {preview.route.failures.map((f, i) => (
            <Text key={i} size="sm" c="red">
              {msg(f)}
            </Text>
          ))}
          {!preview.cmp.equal && (
            <Text size="sm" c="orange">
              {msg({ code: 'CASHFLOW_TC_MISMATCH', params: { cashflow, tc } })}
            </Text>
          )}
        </Alert>
      )}
      <RuleErrors error={save.error} />
      <Button mt="sm" onClick={() => save.mutate(undefined)} loading={save.isPending}>
        {t('actions.save')}
      </Button>
    </Paper>
  );
}

export function LinesTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const pr = usePriceRequest(opp.currentPriceRequestId);
  const sheet = pr.data?.currentSheet as Sheet | null | undefined;
  return (
    <Stack>
      {sheet ? <SheetView sheet={sheet} /> : <Text>{t('sheet.none')}</Text>}
      {opp.currentPriceRequestId &&
        pr.data &&
        pr.data.status !== 'DRAFT' &&
        hasAction(me, 'P5.sheetVersion.write') && (
          <NewVersion prId={opp.currentPriceRequestId} opp={opp} />
        )}
    </Stack>
  );
}
