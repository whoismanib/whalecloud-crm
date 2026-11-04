import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import esCommon from '@wcrm/shared/i18n/es-CL/common.json';
import esEnums from '@wcrm/shared/i18n/es-CL/enums.json';
import esErrors from '@wcrm/shared/i18n/es-CL/errors.json';
import enCommon from '@wcrm/shared/i18n/en/common.json';
import enEnums from '@wcrm/shared/i18n/en/enums.json';
import enErrors from '@wcrm/shared/i18n/en/errors.json';
import zhCommon from '@wcrm/shared/i18n/zh-CN/common.json';
import zhEnums from '@wcrm/shared/i18n/zh-CN/enums.json';
import zhErrors from '@wcrm/shared/i18n/zh-CN/errors.json';
import esP2 from '@wcrm/shared/i18n/es-CL/p2.json';
import enP2 from '@wcrm/shared/i18n/en/p2.json';
import zhP2 from '@wcrm/shared/i18n/zh-CN/p2.json';
import esP3 from '@wcrm/shared/i18n/es-CL/p3.json';
import enP3 from '@wcrm/shared/i18n/en/p3.json';
import zhP3 from '@wcrm/shared/i18n/zh-CN/p3.json';

export const LANGS = [
  { value: 'es-CL', label: 'Español (Chile)' },
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
];

const LS_KEY = 'wcrm.locale';
function initialLng(): string {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && LANGS.some((l) => l.value === saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return 'es-CL';
}

void i18n.use(initReactI18next).init({
  resources: {
    'es-CL': { common: esCommon, enums: esEnums, errors: esErrors, p2: esP2, p3: esP3 },
    en: { common: enCommon, enums: enEnums, errors: enErrors, p2: enP2, p3: enP3 },
    'zh-CN': { common: zhCommon, enums: zhEnums, errors: zhErrors, p2: zhP2, p3: zhP3 },
  },
  lng: initialLng(),
  fallbackLng: 'es-CL',
  ns: ['common', 'enums', 'errors', 'p2', 'p3'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});
if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

let appliedForUser: string | null = null;

/**
 * ADM-05 / QA-003: the profile language wins once per signed-in user (login or reload); later
 * changes come from the header selector, which also saves the preference on the server.
 */
export function applyUserLocale(userId: string, locale: string | null | undefined) {
  if (appliedForUser === userId) return;
  appliedForUser = userId;
  if (locale && LANGS.some((l) => l.value === locale) && locale !== i18n.language) {
    setLanguage(locale);
  }
}

export function setLanguage(lng: string) {
  void i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(LS_KEY, lng);
  } catch {
    /* ignore */
  }
}

export default i18n;
