import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canDeleteMedicalRecords, getPatientAccess, canUploadFilesFor } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import { formatDateTime } from '@/lib/date';
import {
  MEDICAL_EVENT_LABEL,
  MEDICAL_EVENT_EMOJI,
  FILE_CATEGORY_LABEL,
  formatFileSize,
} from '@/lib/files';

export default async function MedicalHistoryPage({ params }: { params: { patientId: string } }) {
  const session = await auth();
  if (!session) redirect('/login');
  const access = await getPatientAccess(session.user.id, params.patientId);
  if (!access) notFound();

  const [events, looseFiles] = await Promise.all([
    prisma.medicalEvent.findMany({
      where: { patientId: params.patientId },
      orderBy: { date: 'desc' },
      include: {
        uploadedBy: { select: { name: true } },
        files: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, mimeType: true, sizeBytes: true, category: true },
        },
      },
    }),
    prisma.medicalFile.findMany({
      where: { patientId: params.patientId, medicalEventId: null },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { name: true } } },
    }),
  ]);

  const canUpload = canUploadFilesFor(access);
  const canDelete = canDeleteMedicalRecords(access);

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-slate-600">
            <Link href={`/pacientes/${params.patientId}`} className="hover:text-brand">← Volver</Link>
          </p>
          <h1 className="text-xl font-bold mt-1">Historial médico</h1>
        </div>
        {canUpload && (
          <div className="flex gap-2">
            <Link
              href={`/pacientes/${params.patientId}/historial/archivo-nuevo`}
              className="btn-secondary"
            >
              + Archivo suelto
            </Link>
            <Link
              href={`/pacientes/${params.patientId}/historial/nuevo`}
              className="btn-primary"
            >
              + Nuevo evento
            </Link>
          </div>
        )}
      </div>

      {events.length === 0 && looseFiles.length === 0 && (
        <div className="card text-center py-10 text-slate-600">
          <p>Todavía no hay eventos médicos cargados.</p>
          {canUpload && (
            <Link
              href={`/pacientes/${params.patientId}/historial/nuevo`}
              className="btn-primary mt-4 inline-flex"
            >
              Cargar primer evento
            </Link>
          )}
        </div>
      )}

      {events.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">Línea temporal</h2>
          <div className="space-y-3">
            {events.map((ev) => (
              <article key={ev.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="text-2xl shrink-0" aria-hidden>
                      {MEDICAL_EVENT_EMOJI[ev.type]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">{MEDICAL_EVENT_LABEL[ev.type]}</p>
                      <p className="text-sm text-slate-600">{formatDate(ev.date, { dateStyle: 'long' })}</p>
                      {(ev.professional || ev.institution) && (
                        <p className="text-sm text-slate-700 mt-1">
                          {[ev.professional, ev.institution].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                  {canUpload && (
                    <div className="flex items-center gap-2 text-sm shrink-0">
                      <Link
                        href={`/pacientes/${params.patientId}/historial/${ev.id}/editar`}
                        className="text-brand hover:underline"
                      >
                        Editar
                      </Link>
                      {canDelete && (
                        <Link
                          href={`/pacientes/${params.patientId}/historial/${ev.id}/borrar`}
                          className="text-danger hover:underline"
                        >
                          Borrar
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  {ev.reason && <Detail label="Motivo" text={ev.reason} />}
                  {ev.summary && <Detail label="Resumen" text={ev.summary} />}
                  {ev.indications && <Detail label="Indicaciones" text={ev.indications} />}
                  {ev.nextAppointment && (
                    <Detail label="Próximo control" text={formatDate(ev.nextAppointment, { dateStyle: 'long' })} />
                  )}
                  {ev.notes && <Detail label="Observaciones" text={ev.notes} />}
                </div>

                {ev.files.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
                      Archivos ({ev.files.length})
                    </p>
                    <ul className="space-y-1">
                      {ev.files.map((f) => (
                        <li key={f.id} className="flex items-center justify-between gap-2">
                          <FileLink
                            id={f.id}
                            name={f.name}
                            mimeType={f.mimeType}
                            sizeBytes={f.sizeBytes}
                            category={FILE_CATEGORY_LABEL[f.category]}
                          />
                          {canUpload && (
                            <Link
                              href={`/pacientes/${params.patientId}/archivos/${f.id}/editar`}
                              className="text-xs text-brand hover:underline shrink-0"
                            >
                              Editar
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-slate-500 mt-3">
                  Cargado por {ev.uploadedBy.name} · {formatDateTime(ev.createdAt)}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {looseFiles.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">Archivos sin evento asociado</h2>
          <div className="space-y-2">
            {looseFiles.map((f) => (
              <div key={f.id} className="card">
                <div className="flex items-center justify-between gap-2">
                  <FileLink
                    id={f.id}
                    name={f.name}
                    mimeType={f.mimeType}
                    sizeBytes={f.sizeBytes}
                    category={FILE_CATEGORY_LABEL[f.category]}
                  />
                  {canUpload && (
                    <Link
                      href={`/pacientes/${params.patientId}/archivos/${f.id}/editar`}
                      className="text-xs text-brand hover:underline shrink-0"
                    >
                      Editar
                    </Link>
                  )}
                </div>
                {f.description && <p className="text-sm text-slate-600 mt-1">{f.description}</p>}
                <p className="text-xs text-slate-500 mt-1">
                  Subido por {f.uploadedBy.name} · {formatDateTime(f.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Detail({ label, text }: { label: string; text: string }) {
  return (
    <p>
      <span className="text-slate-500">{label}:</span> <span className="whitespace-pre-line">{text}</span>
    </p>
  );
}

function FileLink({
  id, name, mimeType, sizeBytes, category,
}: { id: string; name: string; mimeType: string; sizeBytes: number; category: string }) {
  const emoji = mimeType === 'application/pdf' ? '📄' : '🖼️';
  return (
    <a
      href={`/api/files/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-brand hover:underline"
    >
      <span aria-hidden>{emoji}</span>
      <span className="min-w-0 truncate">{name}</span>
      <span className="text-xs text-slate-500 shrink-0">· {category} · {formatFileSize(sizeBytes)}</span>
    </a>
  );
}
