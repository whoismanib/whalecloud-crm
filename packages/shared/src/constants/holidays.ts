// Default holiday calendars (ADM-08). Editable by Admin; seeded into `holidays`.
// China dates follow the State Council pattern and must be verified against the official
// notice each year (make-up working weekends go to `extraWorkdays`).

export interface CalendarSeed {
  id: 'CL' | 'CN';
  name: string;
  timezone: string;
  weekend: number[];
  holidays: { date: string; name: string }[];
  extraWorkdays: string[];
}

export const CL_CALENDAR: CalendarSeed = {
  id: 'CL',
  name: 'Chile',
  timezone: 'America/Santiago',
  weekend: [0, 6],
  holidays: [
    { date: '2026-01-01', name: 'Año Nuevo' },
    { date: '2026-04-03', name: 'Viernes Santo' },
    { date: '2026-04-04', name: 'Sábado Santo' },
    { date: '2026-05-01', name: 'Día del Trabajo' },
    { date: '2026-05-21', name: 'Glorias Navales' },
    { date: '2026-06-21', name: 'Día de los Pueblos Indígenas' },
    { date: '2026-06-29', name: 'San Pedro y San Pablo' },
    { date: '2026-07-16', name: 'Virgen del Carmen' },
    { date: '2026-08-15', name: 'Asunción de la Virgen' },
    { date: '2026-09-18', name: 'Independencia Nacional' },
    { date: '2026-09-19', name: 'Glorias del Ejército' },
    { date: '2026-10-12', name: 'Encuentro de Dos Mundos' },
    { date: '2026-10-31', name: 'Iglesias Evangélicas y Protestantes' },
    { date: '2026-11-01', name: 'Todos los Santos' },
    { date: '2026-12-08', name: 'Inmaculada Concepción' },
    { date: '2026-12-25', name: 'Navidad' },
    { date: '2027-01-01', name: 'Año Nuevo' },
    { date: '2027-03-26', name: 'Viernes Santo' },
    { date: '2027-03-27', name: 'Sábado Santo' },
    { date: '2027-05-01', name: 'Día del Trabajo' },
    { date: '2027-05-21', name: 'Glorias Navales' },
    { date: '2027-06-21', name: 'Día de los Pueblos Indígenas' },
    { date: '2027-06-28', name: 'San Pedro y San Pablo' },
    { date: '2027-07-16', name: 'Virgen del Carmen' },
    { date: '2027-08-15', name: 'Asunción de la Virgen' },
    { date: '2027-09-18', name: 'Independencia Nacional' },
    { date: '2027-09-19', name: 'Glorias del Ejército' },
    { date: '2027-10-11', name: 'Encuentro de Dos Mundos' },
    { date: '2027-10-31', name: 'Iglesias Evangélicas y Protestantes' },
    { date: '2027-11-01', name: 'Todos los Santos' },
    { date: '2027-12-08', name: 'Inmaculada Concepción' },
    { date: '2027-12-25', name: 'Navidad' },
  ],
  extraWorkdays: [],
};

export const CN_CALENDAR: CalendarSeed = {
  id: 'CN',
  name: 'China',
  timezone: 'Asia/Shanghai',
  weekend: [0, 6],
  holidays: [
    { date: '2026-01-01', name: '元旦' },
    { date: '2026-01-02', name: '元旦' },
    { date: '2026-01-03', name: '元旦' },
    ...range('2026-02-15', 9, '春节'),
    ...range('2026-04-04', 3, '清明节'),
    ...range('2026-05-01', 5, '劳动节'),
    ...range('2026-06-19', 3, '端午节'),
    ...range('2026-09-25', 3, '中秋节'),
    ...range('2026-10-01', 7, '国庆节'),
    ...range('2027-01-01', 3, '元旦'),
    ...range('2027-02-06', 8, '春节'),
    ...range('2027-04-03', 3, '清明节'),
    ...range('2027-05-01', 5, '劳动节'),
    ...range('2027-06-09', 3, '端午节'),
    ...range('2027-09-15', 3, '中秋节'),
    ...range('2027-10-01', 7, '国庆节'),
  ],
  extraWorkdays: ['2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
};

function range(start: string, days: number, name: string): { date: string; name: string }[] {
  const out: { date: string; name: string }[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    out.push({ date: d.toISOString().slice(0, 10), name });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function toBusinessCalendar(seed: CalendarSeed) {
  return {
    weekend: seed.weekend,
    holidays: new Set(seed.holidays.map((h) => h.date)),
    extraWorkdays: new Set(seed.extraWorkdays),
  };
}
