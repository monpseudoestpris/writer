import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Writer',
  description: 'AI-powered writing critiques from famous personalities',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}