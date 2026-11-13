import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

/** Keeps a copy of every invoice photo/PDF on the phone, linked to its order. */
export async function saveInvoiceFile(blob: Blob, name: string): Promise<{ path: string; mimeType: string }> {
  const ext = name.toLowerCase().endsWith('.pdf') || blob.type === 'application/pdf' ? 'pdf' : blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `invoices/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${ext}`;
  const data = await blobToBase64(blob);
  await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
  return { path, mimeType: blob.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg') };
}

export async function loadInvoiceFileUrl(path: string, mimeType: string | null): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  }
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
  return typeof data === 'string' ? `data:${mimeType ?? 'image/jpeg'};base64,${data}` : URL.createObjectURL(data);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
