# Deploy en Railway — Cuidado Mayor MVP

Guía paso a paso para dejar el sistema corriendo en Railway con datos de demo.

---

## Prerrequisitos

- Cuenta Railway (railway.app)
- Repo en GitHub conectado a Railway
- Servicio PostgreSQL en Railway (o externo)
- Cuenta Cloudflare con bucket R2 creado
- Cuenta Resend con dominio verificado
- Cron externo (Railway Cron, cron-job.org, Render Cron, etc.)

---

## 1. Crear el proyecto en Railway

1. `New Project` → `Deploy from GitHub repo`
2. Seleccionar el repositorio
3. Railway detecta automáticamente Next.js

---

## 2. Agregar PostgreSQL

1. En el proyecto: `+ New` → `Database` → `PostgreSQL`
2. Railway genera `DATABASE_URL` automáticamente y la inyecta al servicio
3. Verificar que la variable esté disponible en el servicio web

---

## 3. Variables de entorno

En Railway → tu servicio → **Variables**, agregar:

```
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=https://<tu-subdominio>.up.railway.app
APP_BASE_URL=https://<tu-subdominio>.up.railway.app
CRON_SECRET=<openssl rand -base64 24>

CLOUDFLARE_R2_ACCOUNT_ID=<desde Cloudflare dashboard>
CLOUDFLARE_R2_ACCESS_KEY_ID=<token API R2 con permisos Object Read+Write>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<secret del token R2>
CLOUDFLARE_R2_BUCKET_NAME=cuidado-mayor-files

RESEND_API_KEY=re_<tu clave de Resend>
RESEND_FROM=no-reply@<tu-dominio-verificado-en-resend>
```

> `DATABASE_URL` la provee Railway automáticamente si usás su PostgreSQL.
> Si usás DB externa, agregarla manualmente.

### Generar valores seguros (desde terminal local)

```bash
# AUTH_SECRET
openssl rand -base64 32

# CRON_SECRET
openssl rand -base64 24
```

---

## 4. Configuración de build y start

Railway detecta los comandos del `package.json`. Verificar en Settings → Deploy:

| Campo | Valor |
|-------|-------|
| Build Command | `npm run build` |
| Start Command | `npm run start` |

`npm run build` ejecuta `prisma generate && next build`.
`npm run start` ejecuta `next start`.

> Si Railway no los detecta, configurarlos manualmente en Settings.

---

## 5. Primer deploy

1. Push al branch principal (o trigger manual en Railway)
2. Railway ejecuta `npm install && npm run build`
3. Si el build es exitoso, levanta el servicio con `npm run start`
4. Verificar en Logs que no haya errores de variables faltantes

---

## 6. Migraciones de base de datos

### Opción A — Railway Console (recomendado para primer deploy)

1. En el servicio web → `Settings` → `Deploy` → sección **Procfile / Custom Commands**
2. O usar Railway CLI:

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Correr migración en el servicio
railway run npm run db:deploy
```

### Opción B — Deploy command override (primer deploy)

Temporalmente cambiar el Build Command a:
```
npm run build && npm run db:deploy
```

Luego de la primera migración, revertir a `npm run build`.

### Verificar estado de migraciones

```bash
railway run npx prisma migrate status
```

---

## 7. Seed de datos demo

**Solo para demo — destruye datos existentes.**

```bash
railway run npm run db:seed
```

Esto crea 6 usuarios demo, 3 pacientes, medicaciones, registros, historial y alertas.

**Credenciales demo (contraseña: `Demo1234!`)**

| Email | Rol | Descripción |
|-------|-----|-------------|
| `admin@familia-demo.local` | FAMILY_ADMIN | Administradora familia García |
| `julian@familia-demo.local` | FAMILY_MEMBER | Familiar observador (solo lee) |
| `maria@familia-demo.local` | CAREGIVER | Cuidadora familia García |
| `admin@agencia-demo.local` | AGENCY_ADMIN | Admin agencia Cuidados del Sol |
| `ana@agencia-demo.local` | CAREGIVER | Cuidadora paciente Alberto |
| `beatriz@agencia-demo.local` | CAREGIVER | Cuidadora paciente Carmen |

---

## 8. Cloudflare R2 — configuración

### Crear bucket

1. Cloudflare Dashboard → R2 Object Storage → Create Bucket
2. Nombre: el valor de `CLOUDFLARE_R2_BUCKET_NAME`
3. **No activar** acceso público

### Crear API Token

1. R2 → Manage R2 API Tokens → Create API Token
2. Permisos: `Object Read & Write` para el bucket específico
3. Copiar Access Key ID y Secret Access Key → variables de entorno

### Verificar

Subir un archivo desde la app (Historial médico → nuevo evento → adjuntar archivo).
Intentar acceder directamente a la URL de R2 → debe dar 403.
Descargar desde la app → debe funcionar (signed URL de 5 minutos).

---

## 9. Resend — configuración

### Dominio

1. Resend Dashboard → Domains → Add Domain
2. Agregar los registros DNS que Resend indica
3. Esperar verificación (puede tardar hasta 24h con algunos DNS)

### Para demo rápida sin dominio propio

Usar el dominio sandbox de Resend (`onboarding@resend.dev`) solo llega al email del dueño de la cuenta. Para demo real configurar dominio propio.

### Verificar

```bash
# Disparar reporte diario manualmente
curl -X POST https://<tu-app>.up.railway.app/api/jobs/send-daily-reports \
  -H "x-cron-secret: <CRON_SECRET>"
```

Revisar logs de Resend en su dashboard para confirmar entrega.

---

## 10. Cron jobs

### Opción A — Railway Cron Service (recomendado)

1. En el proyecto Railway: `+ New` → `Cron Job`
2. Configurar dos crons:

**Generar alertas** (cada 30 min):
```
*/30 * * * *
```
Comando:
```bash
curl -s -X POST $APP_BASE_URL/api/jobs/generate-alerts -H "x-cron-secret: $CRON_SECRET"
```

**Reporte diario** (8:00 AM Argentina = 11:00 UTC):
```
0 11 * * *
```
Comando:
```bash
curl -s -X POST $APP_BASE_URL/api/jobs/send-daily-reports -H "x-cron-secret: $CRON_SECRET"
```

### Opción B — cron-job.org (servicio externo gratuito)

1. Crear cuenta en cron-job.org
2. Crear 2 jobs con las URLs y el header `x-cron-secret`

### Verificar manualmente

```bash
# Alertas
curl -X POST https://<app>.up.railway.app/api/jobs/generate-alerts \
  -H "x-cron-secret: <CRON_SECRET>"
# Respuesta: {"ok":true,"alertsCreated":N,"alertsAutoResolved":M,...}

# Reportes
curl -X POST https://<app>.up.railway.app/api/jobs/send-daily-reports \
  -H "x-cron-secret: <CRON_SECRET>"
# Respuesta: {"ok":true,"emailsSent":N,"emailsSkipped":M,...}
```

---

## 11. Smoke test post-deploy

Verificar en orden después de cada deploy:

### Básico
- [ ] `https://<app>.up.railway.app` → redirige a `/login`
- [ ] Login con `admin@familia-demo.local` / `Demo1234!` → llega a `/pacientes`
- [ ] Login con `admin@agencia-demo.local` → llega a `/pacientes` + ve "Panel agencia" en header

### Cuidadora
- [ ] Login como `maria@familia-demo.local`
- [ ] Ver paciente Rosa Martínez → ver medicación del día
- [ ] Registrar una presión → aparece en el dashboard
- [ ] NO ver la sección "Administración" en el dashboard del paciente

### Admin familiar
- [ ] Login como `admin@familia-demo.local`
- [ ] Ver sección "Administración" con todos los botones incluyendo "Ver auditoría"
- [ ] Auditoría: ver logs con filtros funcionando
- [ ] Resolver una alerta con motivo
- [ ] Intentar subir archivo en historial médico → (puede fallar si R2 no está configurado)

### Admin agencia
- [ ] Login como `admin@agencia-demo.local`
- [ ] Panel agencia → ver métricas: 2 pacientes, 2 cuidadoras
- [ ] Ver alerta crítica de Alberto en rojo
- [ ] Ver "Sin registros hoy" en Alberto
- [ ] Ir a `/agencia/cuidadoras` → ver Ana con 0 registros, Beatriz con registros del día
- [ ] Navegar a paciente Carmen → ver todo al día

### Seguridad
- [ ] Acceder a `/agencia/dashboard` como cuidadora → redirige a `/pacientes`
- [ ] Acceder a `/pacientes/<id-ajeno>/auditoria` → 404 (sin acceso)
- [ ] Intentar URL directa de R2 → 403 Forbidden
- [ ] Cerrar sesión → volver a `/login`

### Cron
- [ ] `POST /api/jobs/generate-alerts` sin header → 401
- [ ] `POST /api/jobs/generate-alerts` con header correcto → 200 + JSON

---

## 12. Comandos de referencia rápida

```bash
# Deploy desde CLI
railway up

# Ver logs en tiempo real
railway logs

# Ejecutar comando en el servicio desplegado
railway run <comando>

# Migraciones
railway run npm run db:deploy

# Seed demo
railway run npm run db:seed

# Typecheck
npm run typecheck

# Build local (requiere DATABASE_URL)
npm run build
```

---

## 13. Estructura de costos estimada (Railway)

| Servicio | Costo estimado |
|----------|---------------|
| Web service (Hobby) | $5/mes |
| PostgreSQL (Hobby) | $5/mes |
| Egress (archivos R2) | $0.09/GB |
| Resend (100 emails/día gratis) | $0 plan free |
| Cloudflare R2 (10 GB gratis) | $0 para demo |

**Total mínimo demo: ~$10/mes**
