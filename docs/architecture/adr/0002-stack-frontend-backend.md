# 0002 — Stack: React + Vite + TypeScript (SPA) y Node 22 + Fastify + TypeScript

- Estado: Aceptada
- Fecha: 2026-11-04

## Contexto y problema
Un solo agente de ingeniería debe implementar P1–P16 + tablero en una pasada. Usuarios en Chile y China continental sin VPN: el navegador no puede depender de servicios de Google ni CDN públicos. Se requieren i18n es/zh/en, validación compartida y tests.

## Factores de decisión
- Un lenguaje en todo el stack y tipos compartidos.
- Cero dependencias externas en runtime del navegador.
- Rendimiento y validación de esquemas en el servidor.
- Curva de implementación baja.

## Opciones consideradas
- Frontend: **React 18 + Vite + TS (SPA)** · Next.js (SSR) · Vue.
- Backend: **Fastify 5** · Express 4/5 · NestJS.
- UI: **Mantine v7** · MUI · Ant Design · Tailwind + shadcn.

## Decisión
- **Web**: React 18, Vite 5, TypeScript 5 strict, React Router 6 (data router), TanStack Query 5, TanStack Table 8, react-hook-form + `@hookform/resolvers/zod`, Mantine v7 (+ `@mantine/dates`), Recharts, i18next + react-i18next, date-fns + date-fns-tz, `qrcode` (QR TOTP local). Fuentes Inter + Noto Sans SC auto-hospedadas.
- **API**: Node 22 LTS, Fastify 5, `fastify-type-provider-zod`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/multipart`, `@fastify/swagger` (+ UI solo no-prod), pino, `otplib`, `@node-rs/argon2`, `decimal.js`, `exceljs`, `pdfmake`, `nodemailer`, `pg-boss`.
- Build API con `tsup` (bundlea `@wcrm/shared`); web con Vite.

### Justificación
- SPA estática servida por nginx desde el mismo origen: no requiere servidor Node para render, CSP `'self'` estricta, fácil de cachear; SEO irrelevante (app interna). Next.js añade complejidad sin beneficio.
- Fastify: validación por esquema integrada (Zod → JSON Schema → OpenAPI), mejor rendimiento y tipado que Express, menos ceremonia que NestJS.
- Mantine: componentes completos (tablas, formularios, fechas, notificaciones), CSS-in-JS sin CDN, temas claros; Ant Design también es válido (popular en China) pero más pesado.

### Consecuencias
- (+) Tipos y esquemas compartidos de extremo a extremo; un solo `npm test`.
- (+) Bundle auditable: `check:no-external` en CI garantiza cero dominios externos.
- (−) Sin SSR: primera carga depende del bundle → code-splitting por ruta, meta < 300 KB gzip inicial.
