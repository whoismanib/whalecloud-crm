import { expect, test, type Page } from '@playwright/test';
import {
  A1_COMPLETE,
  apiOf,
  data,
  lineAt,
  login,
  milestonesPct,
  openOpportunity,
  pick,
  qualification,
  todayCl,
  uniq,
} from './support/helpers';

/**
 * P1 → P8 happy path (BACKLOG CORE-01/02, P1-01, P2-01..03, P5-01..03, P6-01/02/06, P14-02,
 * P7-02/05/06, P9-02, P8-01..07, CORE-06): new account + opportunity in the UI, qualification,
 * A1 price request, China sheet with margins → committee approval, compliance, contract, hand-off,
 * milestone AC + reception → invoice (China Finance) → payment → stage 11 Cobrada.
 */
test.describe.configure({ mode: 'serial' });

const stage = (page: Page) =>
  page
    .locator('.mantine-Badge-root')
    .filter({ hasText: /^\d{1,2} \p{L}/u })
    .first();

async function advanceTo(page: Page, label: string) {
  await page.getByRole('tab', { name: 'Resumen', exact: true }).click();
  const btn = page.getByTestId('advance-btn');
  await expect(btn).toHaveText(`Avanzar a ${label}`);
  await btn.click();
  await expect(stage(page)).toHaveText(new RegExp(`^${label}$`, 'i'));
}

test('P1→P8: from a new account to stage 11 Cobrada', async ({ page }) => {
  test.setTimeout(240_000);
  const accountName = uniq('E2E Cliente');
  const oppName = uniq('E2E OSS fase 1');
  const today = todayCl();
  let oppId = '';
  let accountId = '';

  await test.step('P1 (AM, UI): create the account and the opportunity at stage 0', async () => {
    await login(page, 'am');
    await page.getByRole('link', { name: 'Cuentas' }).click();
    await page.getByRole('button', { name: 'Nueva cuenta' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Nombre', { exact: true }).fill(accountName);
    await pick(page, 'Vertical', 'Telecom OSS y aseguramiento');
    await pick(page, 'Tipo de cliente', 'Nuevo');
    await pick(page, 'Entidad que factura', /Chile SpA/);
    await dlg.getByRole('button', { name: 'Crear' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByTestId('accounts-table')).toContainText(accountName);

    const api = await apiOf(page);
    const accounts: { id: string; name: string }[] = await data(api.get('/accounts'));
    accountId = accounts.find((a) => a.name === accountName)!.id;
    // contact with the economic-buyer role (P2-03)
    await data(
      api.post(`/accounts/${accountId}/contacts`, {
        firstName: 'Rosa',
        lastName: 'Díaz',
        jobTitle: 'Gerente General',
        buyingRoles: ['ECONOMIC_BUYER'],
      }),
    );

    await page.getByRole('link', { name: 'Oportunidades' }).click();
    await page.getByRole('button', { name: 'Nueva oportunidad' }).click();
    const odlg = page.getByRole('dialog');
    await odlg.getByLabel('Nombre', { exact: true }).fill(oppName);
    await pick(page, 'Cuenta', accountName);
    await pick(page, 'Contacto', 'Rosa Díaz');
    await pick(page, 'Motor de facturación', 'A · Proyecto por hitos');
    await odlg.getByLabel('Monto', { exact: true }).fill('400000');
    await odlg.getByLabel('Fecha de cierre').fill(todayCl(45));
    await odlg.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByTestId('opp-title')).toHaveText(oppName);
    await expect(stage(page)).toHaveText(/^0 Lead$/i);
    oppId = page.url().split('/').pop()!;
  });

  await test.step('P2 (AM): BANT + pain/sponsor/criteria/decision date → stages 1, 2, 3', async () => {
    const api = await apiOf(page);
    await data(api.put(`/opportunities/${oppId}/qualification`, qualification(0)));
    const o = await data(api.get(`/opportunities/${oppId}`));
    await data(
      api.patch(`/opportunities/${oppId}`, {
        rowVersion: o.rowVersion,
        pain: 'Plataforma sin soporte',
        sponsorContactId: o.contacts[0].id,
        decisionCriteria: 'TCO a 5 años y referencias',
        decisionDate: todayCl(30),
      }),
    );
    await page.reload();
    await advanceTo(page, '1 Calificada');
    await advanceTo(page, '2 Descubrimiento');
    await advanceTo(page, '3 Solución o demo');
  });

  await test.step('P5 (AM, UI): submit the A1 price request → stage 4', async () => {
    const api = await apiOf(page);
    const pr = await data(api.post(`/opportunities/${oppId}/price-requests`, { type: 'PROJECT' }));
    await data(api.patch(`/price-requests/${pr.id}`, A1_COMPLETE('400000')));
    await data(api.put(`/price-requests/${pr.id}/expected-milestones`, milestonesPct([100])));
    await openOpportunity(page, oppId, 'Solicitud de precio (A1)');
    await page.getByTestId('submit-pr').click();
    await expect(stage(page)).toHaveText(/^4 Precio solicitado$/i);
  });

  await test.step('P5 (China Sales): sheet v1.0 with margins per line', async () => {
    await login(page, 'lin');
    const api = await apiOf(page);
    const prs: { id: string; opportunityId: string }[] = await data(api.get('/price-requests'));
    const pr = prs.find((p) => p.opportunityId === oppId)!;
    await data(
      api.post(`/price-requests/${pr.id}/sheet-versions`, {
        versionLabel: '1.0',
        currency: 'USD',
        lineItems: [
          lineAt(1, 'OWN_SOFTWARE', 240000, 0.7),
          lineAt(2, 'IMPLEMENTATION', 160000, 0.65),
        ],
        cashflowMilestones: milestonesPct([100]),
        tcMilestones: milestonesPct([100]),
        tcTerms: { offerValidityDays: 30, paymentTermDays: 45 },
      }),
    );
  });

  await test.step('P6 (AM, UI): lines ≥ target → committee band; request approval', async () => {
    await login(page, 'am');
    await openOpportunity(page, oppId, 'Líneas y margen');
    await expect(page.getByText('68,0%').first()).toBeVisible(); // (240k·0.7 + 160k·0.65) / 400k
    await page.getByRole('tab', { name: 'Aprobación', exact: true }).click();
    const preview = page.getByTestId('approval-preview');
    await expect(preview).toContainText('Comité de precios China');
    await page.getByTestId('request-approval').click();
    await expect(page.getByText('Pendiente').first()).toBeVisible();
  });

  await test.step('P6 (China Sales, UI inbox): the committee step is approved', async () => {
    await login(page, 'lin');
    await page.getByRole('link', { name: 'Aprobaciones' }).click();
    const card = page.getByTestId('approvals-inbox').locator('.mantine-Paper-root', {
      hasText: oppName,
    });
    await expect(card).toContainText('Margen · comité');
    await card.getByPlaceholder('Comentario').fill('Acta comité de precios');
    await card.getByTestId('approve-btn').click();
    await expect(card).toHaveCount(0);
  });

  await test.step('P14 checklist (AM → Legal → CM) and P7 proposal / negotiation', async () => {
    await login(page, 'am');
    const am = await apiOf(page);
    const c = await data(am.post(`/opportunities/${oppId}/compliance-checklists`));
    await data(
      am.put(
        `/compliance-checklists/${c.id}/items`,
        c.items.map((i: { itemCode: string }) => ({ itemCode: i.itemCode, answer: 'NO' })),
      ),
    );
    await data(am.post(`/compliance-checklists/${c.id}/submit`));
    await login(page, 'legal');
    await data(
      (await apiOf(page)).post(`/compliance-checklists/${c.id}/review`, { status: 'REVIEWED' }),
    );
    await login(page, 'cm');
    await data((await apiOf(page)).post(`/compliance-checklists/${c.id}/approve`));

    await login(page, 'am');
    await openOpportunity(page, oppId);
    await expect(
      page.getByText('68,0 % / 68,0 %').or(page.getByText('68,0% / 68,0%')),
    ).toBeVisible();
    await advanceTo(page, '5 Propuesta enviada');
    await advanceTo(page, '6 Negociación y aprobación');
  });

  await test.step('P7 (AM): signed contract with standard name → 7 Ganada; P9 hand-off → 8', async () => {
    const api = await apiOf(page);
    const cat = await data(api.get('/catalogs'));
    const entity = cat.billingEntities.find((b: { code: string }) => b.code === 'WC_CL_SPA');
    const contract = await data(
      api.post('/contracts', {
        accountId,
        opportunityId: oppId,
        type: 'SOW',
        number: 'SOW-E2E-01',
        title: 'SOW E2E',
        billingEntityId: entity.id,
        billingEngine: 'A',
        amount: '400000',
        currency: 'USD',
      }),
    );
    await data(
      api.post(`/contracts/${contract.id}/sign`, {
        signedOn: today,
        repositoryUrl: 'https://repo.example.com/e2e/sow',
        standardName: `CL_E2E_SOW_SOW-E2E-01_v1_${today}.pdf`,
        chinaSystemId: 'CN-E2E-0001',
      }),
    );
    await page.reload();
    await advanceTo(page, '7 Ganada');

    const userId = (role: string) =>
      cat.users.find((u: { roles: string[] }) => u.roles.includes(role)).id;
    await data(
      api.post(`/opportunities/${oppId}/handoff`, {
        meetingAt: today,
        attendeeUserIds: [userId('LOCAL_DELIVERY'), userId('CHINA_DELIVERY')],
        zmpProjectId: 'ZMP-E2E-1',
        commercialSheetReviewed: true,
        sowReviewed: true,
        milestonesReviewed: true,
        acceptanceCriteriaReviewed: true,
      }),
    );
    await page.reload();
    await advanceTo(page, '8 En entrega');

    // P7-06: milestones from the approved T&C (UI button)
    await page.getByRole('tab', { name: 'Contrato', exact: true }).click();
    await page.getByRole('button', { name: 'Crear hitos desde la T&C aprobada' }).click();
    await page.getByRole('tab', { name: 'Hitos', exact: true }).click();
    await expect(page.getByTestId('milestones-table')).toContainText('US$400.000');
    await expect(page.getByTestId('milestones-table')).toContainText('Planificado');
  });

  await test.step('P8: delivery marks ready; AM adds AC + reception evidence and accepts', async () => {
    await login(page, 'clDelivery');
    await openOpportunity(page, oppId, 'Hitos');
    await page.getByRole('button', { name: 'Entregable listo' }).click();
    await expect(page.getByTestId('milestones-table')).toContainText('Listo');

    await login(page, 'am');
    const api = await apiOf(page);
    const [m] = await data(api.get(`/milestones?opportunityId=${oppId}`));
    const docs: Record<string, string> = {
      ACCEPTANCE_EMAIL: 'OTHER',
      MSA: 'MSA',
      SIGNED_AC: 'AC',
      RECEPTION: 'REC',
    };
    for (const [type, kind] of Object.entries(docs)) {
      await data(
        api.post(`/milestones/${m.id}/evidence`, {
          evidenceType: type,
          url: `https://repo.example.com/e2e/${type.toLowerCase()}`,
          standardName: `CL_E2E_${kind}_H1_v1_${today}.pdf`,
          receivedOn: today,
          signatureType: type === 'SIGNED_AC' ? 'HANDWRITTEN_SCAN' : undefined,
        }),
      );
    }
    await openOpportunity(page, oppId, 'Hitos');
    await page.getByRole('button', { name: 'Aceptar hito' }).click();
    await expect(page.getByTestId('milestones-table')).toContainText('Aceptado');
    await expect(stage(page)).toHaveText(/^9 Aceptada$/i);
    await page.getByRole('button', { name: 'Enviar a Finanzas China' }).click();
    await expect(page.getByTestId('milestones-table')).toContainText('En Finanzas');
    // RBAC (P8-05): only China Finance registers invoices
    await expect(page.getByRole('button', { name: 'Registrar factura' })).toHaveCount(0);
  });

  await test.step('P8 (China Finance, UI): invoice → payment → 11 Cobrada', async () => {
    await login(page, 'finance');
    await openOpportunity(page, oppId, 'Hitos');
    await page.getByRole('button', { name: 'Registrar factura' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Número').fill(uniq('F-E2E').replace(' ', '-'));
    await dlg.getByRole('button', { name: 'Registrar factura' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByTestId('milestones-table')).toContainText('Facturado');
    await expect(stage(page)).toHaveText(/^10 Facturada$/i);

    await page.getByRole('button', { name: 'Registrar pago' }).click();
    const pay = page.getByRole('dialog');
    await pay.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(pay).toBeHidden();
    await expect(page.getByTestId('milestones-table')).toContainText('Cobrado');
    await expect(stage(page)).toHaveText(/^11 Cobrada$/i);

    // ADM-10: every stage change is in the immutable audit trail of the opportunity
    const timeline = await data(
      (await apiOf(page)).get(`/opportunities/${oppId}/timeline?category=STAGE`),
    );
    const stages = timeline.flatMap((e: { changes: { field: string; new: unknown }[] | null }) =>
      (e.changes ?? []).filter((c) => c.field === 'stage').map((c) => Number(c.new)),
    );
    expect(stages).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  });
});
