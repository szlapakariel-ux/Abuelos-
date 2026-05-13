import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cuidado Mayor',
  description: 'Registro de cuidados para adultos mayores',
  manifest: '/manifest.json',
  applicationName: 'Cuidado Mayor',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Cuidado Mayor' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0F766E',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
