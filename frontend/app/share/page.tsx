import { redirect } from 'next/navigation';

// Each event now has its own QR code on the host dashboard
export default function SharePage() {
  redirect('/host');
}
