-- Migración: agregar EmailLog para trazabilidad de emails enviados
-- Aplica solo si la tabla no existe (idempotente con IF NOT EXISTS)

-- CreateEnum (solo si no existe)
DO $$ BEGIN
  CREATE TYPE "EmailLogStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "emailType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailLogStatus" NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailLog_patientId_createdAt_idx" ON "EmailLog"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");

-- AddForeignKey (solo si no existe)
DO $$ BEGIN
  ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
