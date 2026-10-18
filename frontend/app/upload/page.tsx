import { redirect } from 'next/navigation';

// Uploads now belong to an event (/e/<token>); keep old /upload links and printed QR codes working
export default function UploadPage() {
  redirect('/');
}
