import { Capacitor } from '@capacitor/core';

/**
 * Camera barcode scanning through Google ML Kit (works offline on Android
 * and iPhone). In the desktop browser preview there is no camera scanner;
 * screens fall back to the typed / hardware-scanner input instead.
 */
export function isCameraScanAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export class ScanCancelled extends Error {}

/** Open the camera, read one barcode, and return its text. */
export async function scanOnce(): Promise<string> {
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
  const { supported } = await BarcodeScanner.isSupported();
  if (!supported) throw new Error('This phone does not support camera barcode scanning');

  const perm = await BarcodeScanner.requestPermissions();
  if (perm.camera !== 'granted' && perm.camera !== 'limited') {
    throw new Error('Camera permission is off. Allow camera access for SmartPack in phone Settings.');
  }

  if (Capacitor.getPlatform() === 'android') {
    // Android uses Google's scanner module, downloaded once by Play Services.
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      throw new Error('Setting up the camera scanner for first use. Try again in a few seconds.');
    }
  }

  const { barcodes } = await BarcodeScanner.scan();
  const value = barcodes[0]?.rawValue ?? barcodes[0]?.displayValue;
  if (!value) throw new ScanCancelled('Scan cancelled');
  return value;
}
