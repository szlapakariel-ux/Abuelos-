import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/lib/auth';
import { GlobalRole } from '@prisma/client';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  const isAgency = session.user.globalRole === GlobalRole.AGENCY_ADMIN;

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3">
          <Link href="/pacientes" className="font-bold text-brand text-lg">Cuidado Mayor</Link>
          <div className="flex items-center gap-3 text-sm">
            {isAgency && (
              <Link href="/agencia" className="text-slate-600 hover:text-brand font-medium hidden sm:inline">
                Panel agencia
              </Link>
            )}
            <span className="text-slate-700 hidden md:inline">{session.user.name}</span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button type="submit" className="text-slate-600 hover:text-danger font-medium">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
