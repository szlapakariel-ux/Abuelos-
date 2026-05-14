-- Migración: agregar CaregiverShift para módulo de turnos de cuidado
-- Idempotente: usa IF NOT EXISTS y DO $$ ... EXCEPTION WHEN duplicate_object

-- Enums
DO $$ BEGIN
  CREATE TYPE "ShiftType" AS ENUM ('DAY', 'NIGHT', 'FULL_24H', 'REPLACEMENT', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'MISSED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabla principal
CREATE TABLE IF NOT EXISTS "CaregiverShift" (
    "id"               TEXT NOT NULL,
    "patientId"        TEXT NOT NULL,
    "caregiverId"      TEXT NOT NULL,
    "shiftType"        "ShiftType" NOT NULL,
    "startPlannedAt"   TIMESTAMP(3) NOT NULL,
    "endPlannedAt"     TIMESTAMP(3) NOT NULL,
    "status"           "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes"            TEXT,

    "startedAt"        TIMESTAMP(3),
    "startedById"      TEXT,
    "startDiffMinutes" INTEGER,

    "endedAt"          TIMESTAMP(3),
    "endedById"        TEXT,
    "endDiffMinutes"   INTEGER,

    "correctionNote"   TEXT,
    "correctedById"    TEXT,
    "correctedAt"      TIMESTAMP(3),

    "createdById"      TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaregiverShift_pkey" PRIMARY KEY ("id")
);

-- Índices
CREATE INDEX IF NOT EXISTS "CaregiverShift_patientId_startPlannedAt_idx"
  ON "CaregiverShift"("patientId", "startPlannedAt");

CREATE INDEX IF NOT EXISTS "CaregiverShift_caregiverId_startPlannedAt_idx"
  ON "CaregiverShift"("caregiverId", "startPlannedAt");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "CaregiverShift" ADD CONSTRAINT "CaregiverShift_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CaregiverShift" ADD CONSTRAINT "CaregiverShift_caregiverId_fkey"
    FOREIGN KEY ("caregiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CaregiverShift" ADD CONSTRAINT "CaregiverShift_startedById_fkey"
    FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CaregiverShift" ADD CONSTRAINT "CaregiverShift_endedById_fkey"
    FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CaregiverShift" ADD CONSTRAINT "CaregiverShift_correctedById_fkey"
    FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CaregiverShift" ADD CONSTRAINT "CaregiverShift_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
