import {
  Alert,
  Anchor,
  Button,
  Center,
  Code,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { LoginSchema, MfaVerifySchema } from '@wcrm/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { api, ApiError } from '../api/client';
import { LanguageSwitch } from '../components/LanguageSwitch';

export function LoginPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<null | { enrolled: boolean; secret?: string; uri?: string }>(null);
  const form = useForm<z.input<typeof LoginSchema>>({ resolver: zodResolver(LoginSchema) });
  const mfaForm = useForm<z.input<typeof MfaVerifySchema>>({
    resolver: zodResolver(MfaVerifySchema),
  });

  const onLogin = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await api.post<{ mfaRequired: boolean; enrolled: boolean }>('/auth/login', values);
      if (r.mfaRequired) {
        if (!r.enrolled) {
          const s = await api.post<{ secretBase32: string; otpauthUri: string }>('/auth/mfa/setup');
          setMfa({ enrolled: false, secret: s.secretBase32, uri: s.otpauthUri });
        } else setMfa({ enrolled: true });
        return;
      }
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? t(`errors:http.${e.code}`) : t('ui.error'));
    }
  });

  const onVerify = mfaForm.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/mfa/verify', values);
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? t(`errors:http.${e.code}`) : t('ui.error'));
    }
  });

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w={400} radius="lg">
        <Stack>
          <div>
            <Title order={3}>{t('app.title')}</Title>
            <Text c="dimmed" size="sm">
              {t('app.office')}
            </Text>
          </div>
          {error && (
            <Alert color="red" data-testid="login-error">
              {error}
            </Alert>
          )}
          {!mfa ? (
            <form onSubmit={onLogin}>
              <Stack>
                <TextInput
                  label={t('login.email')}
                  autoComplete="username"
                  {...form.register('email')}
                />
                <PasswordInput
                  label={t('login.password')}
                  autoComplete="current-password"
                  {...form.register('password')}
                />
                <Button type="submit" loading={form.formState.isSubmitting}>
                  {t('login.submit')}
                </Button>
              </Stack>
            </form>
          ) : (
            <form onSubmit={onVerify}>
              <Stack>
                <Title order={5}>{t('login.mfaTitle')}</Title>
                {!mfa.enrolled && (
                  <Text size="sm">
                    {t('login.mfaSetup')}: <Code>{mfa.secret}</Code>
                    <br />
                    <Anchor size="xs" href={mfa.uri}>
                      otpauth://
                    </Anchor>
                  </Text>
                )}
                <TextInput
                  label={t('login.mfaCode')}
                  inputMode="numeric"
                  {...mfaForm.register('code')}
                />
                <Button type="submit">{t('actions.verify')}</Button>
              </Stack>
            </form>
          )}
          <Text size="xs" c="dimmed">
            {t('login.demoHint')}
          </Text>
          <LanguageSwitch />
        </Stack>
      </Paper>
    </Center>
  );
}
