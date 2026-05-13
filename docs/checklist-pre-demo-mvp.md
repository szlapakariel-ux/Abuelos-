# Checklist pre-demo MVP — Cuidado Mayor

Validar cada ítem antes de mostrar el sistema a un cliente o inversor.

---

## 1. Variables de entorno (Railway)

Configurar en Railway → Variables del proyecto.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | URL de conexión PostgreSQL | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `AUTH_SECRET` | Secret de NextAuth (mín. 32 chars aleatorios) | `openssl rand -base64 32` |
| `AUTH_URL` | URL pública del deploy | `https://cuidadomayor.up.railway.app` |
| `APP_BASE_URL` | Igual que AUTH_URL (para links en emails) | `https://cuidadomayor.up.railway.app` |
| `CRON_SECRET` | Secret para proteger endpoints de cron | `openssl rand -base64 24` |
| `CLOUDFLARE_R2_ACCOUNT_ID` | Account ID de Cloudflare | (desde Cloudflare dashboard) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | API token R2 | (desde Cloudflare R2) |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | API secret R2 | (desde Cloudflare R2) |
| `CLOUDFLARE_R2_BUCKET_NAME` | Nombre del bucket R2 | `cuidado-mayor-files` |
| `RESEND_API_KEY` | API key de Resend para emails | `re_...` |
| `RESEND_FROM` | Email remitente verificado en Resend | `no-reply@cuidadomayor.com` |

### Opcionales

| Variable | Descripción |
|----------|-------------|
| `NODE_ENV` | Railway la setea automáticamente en `production` |

---

## 2. Base de datos

### Migraciones

```bash
# En la máquina de deploy o desde Railway console
npx prisma migrate deploy
```

- Verificar que todas las migraciones en `prisma/migrations/` estén aplicadas.
- Confirmar con `npx prisma migrate status`.

### Validación del schema

```bash
npx prisma validate
npx prisma generate
```

### Índices críticos

Los siguientes índices deben existir (ya declarados en schema):
- `AuditLog` → `[userId, createdAt]`, `[entityType, entityId]`
- `Alert` → `[patientId, status]`, `[patientId, type, sourceId, status]` (si se agregó el compuesto)
- `PatientUser` → `[userId]`
- `MedicationLog` → `[medicationId, scheduledFor]`

---

## 3. Seed de demo

Crear datos ficticios antes de la demo. **Nunca usar datos reales.**

### Organización de agencia

```
Organización: "Agencia Demo"
Tipo: AGENCY

Usuarios:
- admin@agenciademo.com / Demo1234! → AGENCY_ADMIN
- cuidadora1@agenciademo.com / Demo1234! → CAREGIVER
- cuidadora2@agenciademo.com / Demo1234! → CAREGIVER
- familiar@agenciademo.com / Demo1234! → FAMILY_ADMIN
```

### Pacientes demo

```
1. "Rosa Martínez" (78 años)
   - Medicación: Enalapril 10mg (mañana/noche), Metformina 500mg (mediodía)
   - Rangos BP: configurados (120/80 normal, 140/90 revisión, 160/100 alerta)
   - Cuidadora asignada: cuidadora1
   - Alerta abierta de presión para demostración

2. "Alberto Gómez" (82 años)
   - Medicación: Aspirina 100mg (mañana), Losartán 50mg (noche)
   - Sin rangos configurados (para mostrar warning)
   - Cuidadora asignada: cuidadora2
   - Sin registros hoy (para mostrar alerta en panel agencia)
```

### Organización familiar (demo separada)

```
Organización: "Familia Demo"
Tipo: FAMILY

Usuarios:
- admin@familiademo.com / Demo1234! → FAMILY_ADMIN
- cuidadora@familiademo.com / Demo1234! → CAREGIVER
- hijo@familiademo.com / Demo1234! → FAMILY_MEMBER

Paciente: "Carmen López" (85 años)
- Medicación completa
- Historial médico con al menos 1 evento y 1 archivo
- Registros de los últimos 7 días
```

---

## 4. Cloudflare R2

- [ ] Bucket creado con nombre correcto (`CLOUDFLARE_R2_BUCKET_NAME`)
- [ ] API token con permisos de lectura/escritura/eliminación
- [ ] El bucket NO es público (acceso solo por signed URLs)
- [ ] Verificar subida de un archivo desde la app (historial médico)
- [ ] Verificar que el archivo no sea accesible directamente desde la URL de R2

---

## 5. Resend (emails)

- [ ] Dominio verificado en Resend (o usar el dominio sandbox de pruebas)
- [ ] Email remitente (`RESEND_FROM`) pertenece al dominio verificado
- [ ] Probar envío manual: `POST /api/jobs/send-daily-reports` con header `x-cron-secret`
- [ ] Verificar que el email llega y los links apuntan a la URL correcta de la app

---

## 6. Cron jobs (Railway Cron o externo)

Railway Cron o servicios como cron-job.org pueden llamar a estos endpoints.

### Endpoints

| Endpoint | Frecuencia sugerida | Descripción |
|----------|---------------------|-------------|
| `POST /api/jobs/generate-alerts` | Cada 30 min | Detecta y auto-resuelve alertas |
| `POST /api/jobs/send-daily-reports` | 1 vez/día (ej. 8:00 AM) | Envía resumen diario por email |

### Header requerido

```
x-cron-secret: <valor de CRON_SECRET>
```

### Verificación manual

```bash
curl -X POST https://tu-app.up.railway.app/api/jobs/generate-alerts \
  -H "x-cron-secret: TU_CRON_SECRET"
# Respuesta esperada: {"ok":true,"alertsCreated":N,...}

curl -X POST https://tu-app.up.railway.app/api/jobs/send-daily-reports \
  -H "x-cron-secret: TU_CRON_SECRET"
# Respuesta esperada: {"ok":true,"emailsSent":N,...}
```

---

## 7. Usuarios demo — flujos a verificar

### Flujo cuidadora (menos de 30 segundos por acción)

1. Login como `cuidadora1@agenciademo.com`
2. Ver lista de pacientes asignados
3. Entrar al paciente → ver medicación pendiente del día
4. Marcar una toma como TOMÓ ✓
5. Registrar presión arterial
6. Registrar comida
7. Registrar estado general
8. Logout

### Flujo familiar (admin)

1. Login como `admin@familiademo.com`
2. Ver dashboard del paciente con alertas abiertas
3. Ver auditoría del paciente
4. Resolver una alerta manualmente
5. Ver historial médico → subir un archivo PDF
6. Configurar rangos médicos
7. Invitar a un nuevo familiar por email
8. Verificar que el email de invitación llega

### Flujo agencia (admin)

1. Login como `admin@agenciademo.com`
2. Ver Panel de agencia → métricas generales
3. Verificar alertas críticas destacadas en rojo
4. Navegar a un paciente con alertas desde el panel
5. Ver cuidadoras → actividad del día
6. Verificar que se ve el paciente sin registros hoy

---

## 8. Pruebas mínimas antes de mostrar

### Funcionalidad crítica

- [ ] Login y logout funcionan
- [ ] Redirección a /login si no hay sesión
- [ ] Cuidadora NO puede acceder a /agencia/dashboard
- [ ] Familiar NO puede ver auditoría (solo admin)
- [ ] Familiar NO puede reabrir alertas (solo admin)
- [ ] Archivos NO son accesibles sin autenticación (probar URL directa de R2)

### Medicación

- [ ] Registrar toma (TOMÓ / NO TOMÓ / RECHAZÓ / DEMORADO)
- [ ] Ver medicación pendiente del día actualizada
- [ ] Alerta MED_NOT_REGISTERED se crea después de 30 min sin registrar
- [ ] Alerta se auto-resuelve cuando se registra la toma

### Presión arterial

- [ ] Registrar presión → se clasifica según rangos del paciente
- [ ] Presión ALERTA → genera alerta en dashboard
- [ ] Warning visible si no hay rangos configurados

### Alertas

- [ ] Alertas críticas aparecen en rojo en dashboard del paciente
- [ ] Alertas críticas aparecen primero en panel de agencia
- [ ] Resolver/ignorar alerta → desaparece de abiertas
- [ ] Reabrir alerta (solo admin)
- [ ] Alertas se filtran por OPEN / RESOLVED / IGNORED / ALL

### Historial médico y archivos

- [ ] Crear evento médico con archivo adjunto
- [ ] Ver archivo → URL firmada funciona (no expira antes de click)
- [ ] Editar metadata de archivo
- [ ] Intentar borrar evento con archivos → flujo bloqueado correcto

### Email

- [ ] Reporte diario llega con datos correctos
- [ ] Links del email apuntan a la URL pública (no localhost)
- [ ] Email de invitación llega y el token funciona

### Panel de agencia

- [ ] Métricas actualizadas (pacientes, cuidadoras, alertas)
- [ ] Paciente sin registros hoy → badge "Sin registros hoy"
- [ ] Paciente con alerta crítica → fondo rojo
- [ ] Cuidadoras → registros del día actualizados en tiempo real
- [ ] Auditoría por paciente → logs visibles con filtros

---

## 9. Verificaciones técnicas finales

```bash
# En el proyecto local antes de hacer deploy
npx prisma validate
npx prisma generate
npx tsc --noEmit

# Build de producción (detecta errores de Next.js)
npm run build
```

### Si el build falla

- Verificar variables de entorno presentes (algunas son requeridas en build time)
- Revisar errores de TypeScript
- Confirmar que no hay imports rotos

---

## 10. Qué NO está en MVP (no demostrar)

- Integración WhatsApp / SMS
- IA / RAG sobre historial médico
- OCR de recetas
- Exportación de reportes (PDF, Excel)
- Analytics avanzados
- App nativa iOS/Android (es PWA)
- Multi-organización por usuario
- Facturación / pagos

---

## Estado del MVP al momento de este checklist

| Módulo | Estado |
|--------|--------|
| Auth (login, sesiones, invitaciones) | ✅ Completo |
| Gestión de pacientes (crear, editar) | ✅ Completo |
| Rangos médicos por paciente | ✅ Completo |
| Medicación (configurar, registrar tomas) | ✅ Completo |
| Presión arterial (registrar, clasificar) | ✅ Completo |
| Alimentación (registrar comidas) | ✅ Completo |
| Estado general diario | ✅ Completo |
| Historial médico (eventos + archivos R2) | ✅ Completo |
| Sistema de alertas (9 tipos, auto-resolución) | ✅ Completo |
| Gestión de alertas (resolver, ignorar, reabrir) | ✅ Completo |
| Reporte diario por email (Resend) | ✅ Completo |
| Panel de agencia consolidado | ✅ Completo |
| Vista de cuidadoras (cruce cuidadora×paciente) | ✅ Completo |
| Auditoría por paciente (con filtros) | ✅ Completo |
| Permisos (roles globales + roles por paciente) | ✅ Completo |
| Archivos privados (R2 + signed URLs) | ✅ Completo |
| Cron jobs (alertas + reportes) | ✅ Completo |
| Preferencias email por usuario (toggle) | ⏳ Pendiente |
| Resolución masiva de alertas | ⏳ Pendiente |
| Email al resolver alerta crítica | ⏳ Pendiente |
| Auditoría de acciones de la agencia | ⏳ Pendiente (parcial) |
