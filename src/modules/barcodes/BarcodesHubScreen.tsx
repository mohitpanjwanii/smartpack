import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { can } from '../../domain/permissions';

export function BarcodesHubScreen() {
  const { user } = useSession();
  const { push } = useNav();
  return (
    <div className="screen">
      <ScreenHeader title="Barcodes" />
      <p className="subtle">Every packet has its own barcode. Register each one once against its product before packing.</p>
      <div className="tiles">
        <button className="tile tile-main" onClick={() => push({ name: 'barcodeRegister' })}>
          <span className="tile-name">Register packets</span>
          <span className="tile-note">Pick a product, then scan its packets one after another</span>
        </button>
        <button className="tile" onClick={() => push({ name: 'barcodeLookup' })}>
          <span className="tile-name">Check a barcode</span>
          <span className="tile-note">See which product it is and its status</span>
        </button>
        {can(user.role, 'barcodes.import') && (
          <button className="tile" onClick={() => push({ name: 'barcodeImport' })}>
            <span className="tile-name">Import barcode list</span>
            <span className="tile-note">From Excel or CSV</span>
          </button>
        )}
      </div>
    </div>
  );
}
