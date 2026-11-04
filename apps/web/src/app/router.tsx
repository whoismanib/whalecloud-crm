import { Center, Loader } from '@mantine/core';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { LoginPage } from '../auth/LoginPage';
import { useMe } from '../auth/useMe';
import { AppLayout } from '../components/AppLayout';

const ResumenPage = lazy(() => import('../features/dashboard/ResumenPage'));
const AccountsPage = lazy(() => import('../features/accounts/AccountsPage'));
const OpportunitiesPage = lazy(() => import('../features/opportunities/OpportunitiesPage'));
const OpportunityDetailPage = lazy(() => import('../features/opportunities/OpportunityDetailPage'));
const ApprovalsPage = lazy(() => import('../features/approvals/ApprovalsPage'));
const BillingPage = lazy(() => import('../features/billing/BillingPage'));
const HealthPage = lazy(() => import('../features/health/HealthPage'));
const TicketsPage = lazy(() => import('../features/tickets/TicketsPage'));
const AuditPage = lazy(() => import('../features/audit/AuditPage'));

const Loading = () => (
  <Center mih={240}>
    <Loader />
  </Center>
);
const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

function RequireAuth() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <Loading />;
  if (!me || !me.mfaVerified) return <LoginPage />;
  return <AppLayout />;
}

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <RequireAuth />,
      children: [
        { index: true, element: page(<ResumenPage />) },
        { path: 'cuentas', element: page(<AccountsPage />) },
        { path: 'oportunidades', element: page(<OpportunitiesPage />) },
        { path: 'oportunidades/:id', element: page(<OpportunityDetailPage />) },
        { path: 'aprobaciones', element: page(<ApprovalsPage />) },
        { path: 'facturacion', element: page(<BillingPage />) },
        { path: 'salud', element: page(<HealthPage />) },
        { path: 'incidentes', element: page(<TicketsPage />) },
        { path: 'bitacora', element: page(<AuditPage />) },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);

export function AppRouter() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
