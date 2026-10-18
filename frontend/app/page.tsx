import { redirect } from 'next/navigation';

// No landing page yet: the upload page is the app's entry point (and where the QR code should point)
export default function Home() {
  redirect('/upload');
}
