'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

type OrgType = 'FAMILY' | 'AGENCY';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState<OrgType>('FAMILY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, orgName, orgType }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No pudimos crear la cuenta');
      }
      await signIn('credentials', { email, password, redirect: false });
      router.push('/pacientes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10 bg-slate-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-brand">Crear cuenta</h1>
          <p className="text-slate-600 mt-1">Para familias y agencias de cuidado</p>
        </div>
        <form onSubmit={onSubmit} className="card space-y-4">
          <div>
            <label className="label">¿Cómo te vamos a registrar?</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrgType('FAMILY')}
                className={`btn ${orgType === 'FAMILY' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Familia
              </button>
              <button
                type="button"
                onClick={() => setOrgType('AGENCY')}
                className={`btn ${orgType === 'AGENCY' ? 'btn-primary' : 'btn-secondary'}`}
              >
                Agencia
              </button>
            </div>
          </div>

          <div>
            <label className="label">Tu nombre</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="label">{orgType === 'FAMILY' ? 'Nombre de la familia' : 'Nombre de la agencia'}</label>
            <input
              className="input"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder={orgType === 'FAMILY' ? 'Familia García' : 'Cuidados del Sur'}
            />
          </div>

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div>
            <label className="label">Contraseña</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          {error && <p className="field-error">{error}</p>}

          <button type="submit" className="btn-primary btn-lg w-full" disabled={loading}>
            {loading ? 'Creando…' : 'Crear cuenta'}
          </button>

          <p className="text-center text-sm text-slate-600">
            ¿Ya tenés cuenta?{' '}
            <Link href="/login" className="text-brand font-semibold">Entrar</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
