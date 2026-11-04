import {
  ActionIcon,
  AppShell,
  Burger,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Text,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuilding,
  IconCalendarRepeat,
  IconChartLine,
  IconChecklist,
  IconClockHour4,
  IconFileDiff,
  IconSettings,
  IconTruckDelivery,
  IconUsersGroup,
  IconUserPlus,
  IconFileInvoice,
  IconHeartbeat,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconSun,
  IconTargetArrow,
  IconTicket,
  IconUser,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { canDo, useMe } from '../auth/useMe';
import { LanguageSwitch } from './LanguageSwitch';
import { NotificationBell } from './NotificationBell';

export function AppLayout() {
  const { t } = useTranslation();
  const [opened, { toggle }] = useDisclosure();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const loc = useLocation();
  const items = [
    {
      to: '/',
      label: t('nav.resumen'),
      icon: IconLayoutDashboard,
      show: canDo(me, 'DASH', 'view'),
    },
    { to: '/cuentas', label: t('nav.accounts'), icon: IconBuilding, show: canDo(me, 'P1', 'view') },
    { to: '/oportunidades', label: t('nav.opportunities'), icon: IconTargetArrow, show: true },
    { to: '/aprobaciones', label: t('nav.approvals'), icon: IconChecklist, show: true },
    {
      to: '/facturacion',
      label: t('nav.billing'),
      icon: IconFileInvoice,
      show: canDo(me, 'P8', 'view'),
    },
    { to: '/salud', label: t('nav.health'), icon: IconHeartbeat, show: canDo(me, 'DASH', 'view') },
    {
      to: '/incidentes',
      label: t('nav.incidents'),
      icon: IconTicket,
      show: canDo(me, 'P10', 'view'),
    },
    {
      to: '/traspasos',
      label: t('p2:nav.handoffs'),
      icon: IconTruckDelivery,
      show: canDo(me, 'P9', 'view'),
    },
    {
      to: '/renovaciones',
      label: t('p2:nav.renewals'),
      icon: IconCalendarRepeat,
      show: canDo(me, 'P10', 'view'),
    },
    { to: '/crs', label: t('p2:nav.crs'), icon: IconFileDiff, show: canDo(me, 'P11', 'view') },
    {
      to: '/pronostico',
      label: t('p2:nav.forecast'),
      icon: IconChartLine,
      show: canDo(me, 'P12', 'view'),
    },
    {
      to: '/distribuidores',
      label: t('p2:nav.distributors'),
      icon: IconUsersGroup,
      show: canDo(me, 'P13', 'view'),
    },
    {
      to: '/incorporacion',
      label: t('p2:nav.onboarding'),
      icon: IconUserPlus,
      show: true,
    },
    {
      to: '/capacidad',
      label: t('p2:nav.capacity'),
      icon: IconClockHour4,
      show: canDo(me, 'P16', 'view'),
    },
    { to: '/bitacora', label: t('nav.audit'), icon: IconHistory, show: canDo(me, 'ADM', 'view') },
    {
      to: '/administracion',
      label: t('p2:nav.admin'),
      icon: IconSettings,
      show:
        canDo(me, 'ADM', 'write') ||
        canDo(me, 'P1', 'approve') ||
        Boolean(me?.actionRoles?.['FX.write']),
    },
  ];
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    window.location.href = '/';
  };
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700}>{t('app.title')}</Text>
            <Text size="sm" c="dimmed" visibleFrom="md">
              · {t('app.office')}
            </Text>
          </Group>
          <Group gap="xs">
            <NotificationBell />
            <LanguageSwitch persist />
            <Tooltip label={colorScheme === 'dark' ? t('ui.lightMode') : t('ui.darkMode')}>
              <ActionIcon
                variant="default"
                size="lg"
                onClick={toggleColorScheme}
                aria-label="theme"
                data-testid="theme-toggle"
              >
                {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label="user">
                  <IconUser size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me?.fullName}</Menu.Label>
                <Menu.Item disabled>
                  {me?.roles.map((r) => t(`enums:role.${r}`)).join(', ')}
                </Menu.Item>
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>
                  {t('actions.logout')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {items
            .filter((i) => i.show)
            .map((i) => (
              <NavLink
                key={i.to}
                component={RouterLink}
                to={i.to}
                label={i.label}
                leftSection={<i.icon size={18} />}
                active={i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)}
                onClick={() => opened && toggle()}
              />
            ))}
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
