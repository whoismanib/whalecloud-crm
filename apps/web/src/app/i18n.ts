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
    'es-CL': { common: esCommon, enums: esEnums, errors: esErrors },
    en: { common: enCommon, enums: enEnums, errors: enErrors },
    'zh-CN': { common: zhCommon, enums: zhEnums, errors: zhErrors },
  },
  lng: initialLng(),
  fallbackLng: 'es-CL',
  ns: ['common', 'enums', 'errors'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

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
