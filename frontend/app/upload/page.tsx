import UploadForm from './UploadForm';
import Gallery from './Gallery'; // 🌟 Add this import

export default function UploadPage() {
  return (
    <main style={{ padding: '20px' }}>
      <UploadForm />
      <hr style={{ maxWidth: '800px', margin: '40px auto', border: '0', borderTop: '1px solid #eee' }} />
      <Gallery /> {/* 🌟 Render it right here */}
    </main>
  );
}
