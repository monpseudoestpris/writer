import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Writer',
  description: 'Votre atelier d’écriture : créez vos histoires, explorez vos idées et faites grandir votre plume.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
