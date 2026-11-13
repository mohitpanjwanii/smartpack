import { Capacitor } from '@capacitor/core';

/** Take an invoice photo with the phone camera (native only). Returns null if cancelled. */
export async function takeInvoicePhoto(): Promise<Blob | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 90,
      width: 2400,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (!photo.webPath) return null;
    return await (await fetch(photo.webPath)).blob();
  } catch (err) {
    if (/cancel/i.test(String(err))) return null;
    throw err;
  }
}

export function canUseCamera(): boolean {
  return Capacitor.isNativePlatform();
}
