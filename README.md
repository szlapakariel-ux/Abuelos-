# Cuidado Mayor

App web responsive (mobile-first / PWA) para registro de cuidados de adultos mayores.
Pensada para familias particulares y agencias de cuidado, con UX simple para cuidadoras con bajo conocimiento tecnológico.

## Estado actual — MVP fase 0/1

Esta es la **base del proyecto** con las pantallas iniciales del flujo administrativo.

### Implementado
- Stack: Next.js 14 (App Router) + TypeScript + TailwindCSS + Prisma + PostgreSQL
- Autenticación: NextAuth v5 (credenciales email/password) con roles
- Schema de datos completo (todos los módulos del MVP)
- Registro de cuenta (familia o agencia)
- Crear paciente
- Configurar medicación (con horarios mañana/mediodía/tarde/noche)
- Invitar personas por email con roles (admin / cuidadora / familiar)
- Aceptar invitaciones
- Dashboard de paciente
- Cloudflare R2 para archivos médicos (lib lista, pantallas a sumar)
- Resend para email de invitación

### Pendiente (siguientes microetapas)
- Pantalla de medicación del día con botones de toma (cuidadora)
- Cargar presión / alimentación / estado general
- Historial médico + subida de archivos a R2
- Alertas + cron de medicación no registrada y vencimiento de recetas
- Panel agencia
- Reportes diarios por email

## Setup local

```bash
# 1. Variables de entorno
cp .env.example .env.local
# completar DATABASE_URL, AUTH_SECRET, R2_*, RESEND_API_KEY

# 2. Dependencias
npm install

# 3. Base de datos
npm run db:migrate
npm run db:seed   # opcional, datos ficticios

# 4. Dev server
npm run dev
```

Abrir http://localhost:3000

Credenciales del seed (datos ficticios):
- Admin familia: `admin@demo.local` / `demo1234`
- Cuidadora:    `cuidadora@demo.local` / `demo1234`

## Deploy en Railway

1. Crear un proyecto en Railway.
2. Agregar servicio **PostgreSQL**. Copiar `DATABASE_URL` a las variables del servicio web.
3. Crear servicio desde este repo. Railway detecta `railway.json` y corre:
   - Build: `npm ci && npm run build` (incluye `prisma generate`)
   - Start: `npm run db:deploy && npm start` (aplica migraciones en cada deploy)
4. Configurar las demás variables de `.env.example` en Railway.
5. En **Cloudflare R2**: crear bucket y API token con permisos de Object Read/Write.

## Estructura

```
src/
├── app/
│   ├── (auth)/            # login, register, aceptar invitación
│   ├── (app)/             # rutas protegidas
│   │   ├── pacientes/
│   │   │   ├── nuevo/
│   │   │   └── [patientId]/
│   │   │       ├── medicacion/configurar/
│   │   │       └── usuarios/
│   └── api/
│       ├── auth/[...nextauth]/
│       └── register/
├── lib/
│   ├── prisma.ts
│   ├── auth.ts            # NextAuth config + roles
│   ├── permissions.ts     # autorización por paciente
│   ├── storage.ts         # Cloudflare R2 (signed URLs)
│   ├── email.ts           # Resend
│   └── utils.ts
└── middleware.ts          # protección de rutas
prisma/
├── schema.prisma
└── seed.ts                # solo datos ficticios
```

## Roles

| Rol global       | Descripción                                 |
|------------------|---------------------------------------------|
| `AGENCY_ADMIN`   | Administra agencia y todos sus pacientes    |
| `FAMILY_ADMIN`   | Administra su grupo familiar                |
| `CAREGIVER`      | Cuidadora con pantalla simplificada         |
| `FAMILY_MEMBER`  | Familiar con acceso de lectura              |

Adicionalmente, cada usuario tiene un **rol por paciente** (`PatientUser.patientRole`) que define qué puede hacer en ese paciente puntual.

## Seguridad

- Contraseñas con bcrypt.
- Sesiones JWT 8h.
- Acceso a cada paciente validado via `getPatientAccess()` en cada request.
- Archivos médicos privados en R2, accedidos por signed URLs temporales.
- Variables sensibles solo en env vars (no hardcodear).
- Seeds usan datos **ficticios**; nunca datos reales.

## LLM (futuro, no implementado)

La arquitectura está preparada para un módulo RAG por paciente:
- Datos estructurados ya indexables (Prisma).
- `AuditLog` con histórico de cada acción.
- Restricción: solo responder con datos internos del paciente, nunca consejos médicos.
