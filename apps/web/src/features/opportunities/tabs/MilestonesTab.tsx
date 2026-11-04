import {
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  buildRepositoryName,
  EVIDENCE_TYPES,
  requiredEvidence,
  SIGNATURE_TYPES,
  type BillingEngine,
} from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { canDo, hasAction, useMe } from '../../../auth/useMe';
import { RuleErrors } from '../../../components/RuleErrors';
import { EnumBadge, ScrollTable } from '../../../components/ui';
import { fmtDate, fmtMoney, todayIso } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';

export interface Invoice {
  id: string;
  number: string;
  amount: string;
  amountCurrency: string;
  balance: string;
  dueOn: string;
  status: string;
  escalation: {
    currentStep: string | null;
    daysOverdue: number;
    bucket: string;
    nextStep: string | null;
    nextOn: string | null;
  };
}
interface Milestone {
  id: string;
  seq: number;
  name: string;
  amount: string;
  amountCurrency: string;
  status: string;
  billingEngine: BillingEngine;
  acDueOn: string | null;
  recognizedOn: string | null;
  evidence: { id: string; evidenceType: string; standardName: string; url: string }[];
  billingLines: { id: string; amount: string; amountCurrency: string }[];
  invoices: Invoice[];
}

const KIND: Record<string, string> = {
  RECEPTION: 'REC',
  SIGNED_AC: 'AC',
  PO: 'OC',
  MSA: 'MSA',
  USAGE_REPORT: 'USAGE',
};

function EvidenceModal({ m, opp, onClose }: { m: Milestone; onClose: () => void } & TabProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<string>(
    requiredEvidence(m.billingEngine).find((e) => !m.evidence.some((x) => x.evidenceType === e)) ??
      'SIGNED_AC',
  );
  const [date, setDate] = useState(todayIso());
  const [sig, setSig] = useState<string | null>('HANDWRITTEN_SCAN');
  const name = buildRepositoryName({
    country: opp.countryCode,
    client: opp.account.name,
    type: (KIND[type] ?? 'OTHER') as never,
    number: `H${m.seq}`,
    version: 1,
    date,
    ext: 'pdf',
  });
  const [standardName, setStandardName] = useState(name);
  const [url, setUrl] = useState('https://');
  const add = useAction(
    () =>
      api.post(`/milestones/${m.id}/evidence`, {
        evidenceType: type,
        receivedOn: date,
        signatureType: sig,
        standardName,
        url,
      }),
    {
      invalidate: [['milestones', opp.id]],
      onDone: onClose,
    },
  );
  return (
    <Stack>
      <SimpleGrid cols={2}>
        <Select
          label={t('fields.type')}
          data={EVIDENCE_TYPES.map((e) => ({ value: e, label: t(`enums:evidence.${e}`) }))}
          value={type}
          onChange={(v) => v && setType(v)}
        />
        <TextInput
          type="date"
          label={t('milestone.receivedOn')}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <Select
          label={t('milestone.signatureType')}
          clearable
          data={SIGNATURE_TYPES.map((s) => ({ value: s, label: t(`enums:signature.${s}`) }))}
          value={sig}
          onChange={setSig}
        />
        <TextInput
          label={t('milestone.url')}
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
        />
      </SimpleGrid>
      <TextInput
        label={t('contract.standardName')}
        description={t('contract.suggested', { name })}
        value={standardName}
        onChange={(e) => setStandardName(e.currentTarget.value)}
      />
      <RuleErrors error={add.error} />
      <Button onClick={() => add.mutate(undefined)}>{t('actions.add')}</Button>
    </Stack>
  );
}

function InvoiceModal({
  lineId,
  amount,
  currency,
  opp,
  onClose,
}: { lineId: string; amount: string; currency: string; onClose: () => void } & TabProps) {
  const { t } = useTranslation();
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayIso());
  const [amt, setAmt] = useState(amount);
  const [term, setTerm] = useState('45');
  const inv = useAction(
    () =>
      api.post(`/milestone-billing-lines/${lineId}/invoices`, {
        number,
        issuedOn,
        amount: amt,
        currency,
        paymentTermDays: Number(term),
      }),
    {
      invalidate: [
        ['milestones', opp.id],
        ['opportunity', opp.id],
      ],
      onDone: onClose,
    },
  );
  return (
    <Stack>
      <SimpleGrid cols={2}>
        <TextInput
          label={t('fields.number')}
          value={number}
          onChange={(e) => setNumber(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label={t('milestone.issuedOn')}
          value={issuedOn}
          onChange={(e) => setIssuedOn(e.currentTarget.value)}
        />
        <TextInput
          label={`${t('fields.amount')} (${currency})`}
          value={amt}
          onChange={(e) => setAmt(e.currentTarget.value)}
        />
        <TextInput
          label={t('milestone.paymentTerm')}
          value={term}
          onChange={(e) => setTerm(e.currentTarget.value)}
        />
      </SimpleGrid>
      <RuleErrors error={inv.error} />
      <Button onClick={() => inv.mutate(undefined)}>{t('milestone.invoice')}</Button>
    </Stack>
  );
}

export function PaymentModal({
  invoice,
  invalidate,
  onClose,
}: {
  invoice: Invoice;
  invalidate: string[][];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [paidOn, setPaidOn] = useState(todayIso());
  const [amount, setAmount] = useState(invoice.balance);
  const [reference, setReference] = useState('');
  const pay = useAction(
    () =>
      api.post(`/invoices/${invoice.id}/payments`, {
        paidOn,
        amount,
        currency: invoice.amountCurrency,
        reference,
      }),
    {
      invalidate,
      onDone: onClose,
    },
  );
  return (
    <Stack>
      <SimpleGrid cols={2}>
        <TextInput
          type="date"
          label={t('milestone.paidOn')}
          value={paidOn}
          onChange={(e) => setPaidOn(e.currentTarget.value)}
        />
        <TextInput
          label={`${t('fields.amount')} (${invoice.amountCurrency})`}
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
        />
        <TextInput
          label={t('milestone.reference')}
          value={reference}
          onChange={(e) => setReference(e.currentTarget.value)}
        />
      </SimpleGrid>
      <RuleErrors error={pay.error} />
      <Button onClick={() => pay.mutate(undefined)}>{t('milestone.payment')}</Button>
    </Stack>
  );
}

export function MilestonesTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['milestones', opp.id],
    queryFn: () => api.get<Milestone[]>(`/milestones?opportunityId=${opp.id}`),
  });
  const inv = [
    ['milestones', opp.id],
    ['opportunity', opp.id],
  ];
  const ready = useAction((id: string) => api.post(`/milestones/${id}/ready`), { invalidate: inv });
  const accept = useAction((id: string) => api.post(`/milestones/${id}/accept`), {
    invalidate: inv,
  });
  const send = useAction((id: string) => api.post(`/milestones/${id}/send-to-finance`), {
    invalidate: inv,
  });
  const [evidenceFor, setEvidenceFor] = useState<Milestone | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<Milestone | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const err = ready.error ?? accept.error ?? send.error;
  return (
    <Stack>
      <RuleErrors error={err} />
      <ScrollTable striped withTableBorder data-testid="milestones-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>{t('fields.name')}</Table.Th>
            <Table.Th>{t('fields.amount')}</Table.Th>
            <Table.Th>{t('fields.status')}</Table.Th>
            <Table.Th>{t('milestone.evidence')}</Table.Th>
            <Table.Th>{t('billing.invoices')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((m) => (
            <Table.Tr key={m.id}>
              <Table.Td>{m.seq}</Table.Td>
              <Table.Td>
                {m.name}
                <Text size="xs" c="dimmed">
                  {t(`enums:engine.${m.billingEngine}`)}{' '}
                  {m.acDueOn ? `· ${t('milestone.acDue', { date: fmtDate(m.acDueOn) })}` : ''}
                  {m.recognizedOn
                    ? ` · ${t('milestone.recognizedOn')} ${fmtDate(m.recognizedOn)}`
                    : ''}
                </Text>
              </Table.Td>
              <Table.Td>{fmtMoney(m.amount, m.amountCurrency)}</Table.Td>
              <Table.Td>
                <EnumBadge ns="milestoneStatus" value={m.status} />
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {requiredEvidence(m.billingEngine).map((e) => (
                    <Badge
                      key={e}
                      size="xs"
                      color={m.evidence.some((x) => x.evidenceType === e) ? 'green' : 'gray'}
                      variant="light"
                    >
                      {t(`enums:evidence.${e}`)}
                    </Badge>
                  ))}
                </Group>
              </Table.Td>
              <Table.Td>
                {m.invoices.map((i) => (
                  <Group key={i.id} gap={4}>
                    <Text size="xs">
                      {i.number} · {fmtMoney(i.balance, i.amountCurrency)} · {fmtDate(i.dueOn)}
                    </Text>
                    {i.escalation.currentStep && (
                      <Badge size="xs" color="red">
                        {i.escalation.currentStep.replace('D_PLUS_', '+').replace('D_MINUS_', '−')}
                      </Badge>
                    )}
                    {hasAction(me, 'P8.payment.write') && Number(i.balance) > 0 && (
                      <Button size="compact-xs" variant="light" onClick={() => setPayFor(i)}>
                        {t('milestone.payment')}
                      </Button>
                    )}
                  </Group>
                ))}
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {m.status === 'PLANNED' && hasAction(me, 'P8.milestone.ready') && (
                    <Button size="compact-xs" onClick={() => ready.mutate(m.id)}>
                      {t('milestone.ready')}
                    </Button>
                  )}
                  {['PLANNED', 'READY'].includes(m.status) &&
                    hasAction(me, 'P8.evidence.write') && (
                      <Button size="compact-xs" variant="light" onClick={() => setEvidenceFor(m)}>
                        {t('milestone.addEvidence')}
                      </Button>
                    )}
                  {m.status === 'READY' && canDo(me, 'P8', 'write') && (
                    <Button size="compact-xs" color="green" onClick={() => accept.mutate(m.id)}>
                      {t('milestone.accept')}
                    </Button>
                  )}
                  {m.status === 'ACCEPTED' && hasAction(me, 'P8.sendToFinance') && (
                    <Button size="compact-xs" onClick={() => send.mutate(m.id)}>
                      {t('milestone.sendToFinance')}
                    </Button>
                  )}
                  {m.status === 'SENT_TO_FINANCE' && hasAction(me, 'P8.invoice.write') && (
                    <Button size="compact-xs" onClick={() => setInvoiceFor(m)}>
                      {t('milestone.invoice')}
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      {(q.data ?? []).length === 0 && (
        <Paper p="md" withBorder>
          <Text c="dimmed">{t('ui.empty')}</Text>
        </Paper>
      )}
      <Modal
        opened={Boolean(evidenceFor)}
        onClose={() => setEvidenceFor(null)}
        title={t('milestone.addEvidence')}
        size="lg"
      >
        {evidenceFor && (
          <EvidenceModal m={evidenceFor} opp={opp} onClose={() => setEvidenceFor(null)} />
        )}
      </Modal>
      <Modal
        opened={Boolean(invoiceFor)}
        onClose={() => setInvoiceFor(null)}
        title={t('milestone.invoice')}
        size="lg"
      >
        {invoiceFor && invoiceFor.billingLines[0] && (
          <InvoiceModal
            lineId={invoiceFor.billingLines[0].id}
            amount={invoiceFor.billingLines[0].amount}
            currency={invoiceFor.billingLines[0].amountCurrency}
            opp={opp}
            onClose={() => setInvoiceFor(null)}
          />
        )}
      </Modal>
      <Modal
        opened={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        title={t('milestone.payment')}
      >
        {payFor && (
          <PaymentModal invoice={payFor} invalidate={inv} onClose={() => setPayFor(null)} />
        )}
      </Modal>
    </Stack>
  );
}
