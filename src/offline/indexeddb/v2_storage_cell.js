import BaseStorageCell from './base_storage_cell'

/* *
 * The V2StorageCell is for all stores that follow the shaka.externs V2 and V3
 * offline types.  V2 was introduced in Shaka Player v2.3.0 and quickly
 * replaced with V3 in Shaka Player v2.3.2.
 *
 * Upgrading from V1 to V2 initially broke the database in a way that prevented
 * adding new records.  The problem was with the upgrade process, not with the
 * database format.  Once database upgrades were removed, we increased the
 * database version to V3 and marked V2 as read-only.  Therefore, V2 and V3
 * databases can both be read by this cell.
 *
 * @implements {shaka.extern.StorageCell}
 */
export default class V2StorageCell extends BaseStorageCell {
  /* *
   * @param {IDBDatabase} connection
   * @param {string} segmentStore
   * @param {string} manifestStore
   * @param {boolean} isFixedKey
   */
  constructor(connection, segmentStore, manifestStore, isFixedKey) {
    super(connection, segmentStore, manifestStore)

    /* * @private {boolean} */
    this.isFixedKey_ = isFixedKey
  }

  /* * @override */
  hasFixedKeySpace() {
    return this.isFixedKey_
  }

  /* * @override */
  addSegments(segments) {
    if (this.isFixedKey_) {
      return this.rejectAdd(this.segmentStore_)
    }
    return this.add(this.segmentStore_, segments)
  }

  /* * @override */
  addManifests(manifests) {
    if (this.isFixedKey_) {
      return this.rejectAdd(this.manifestStore_)
    }
    return this.add(this.manifestStore_, manifests)
  }

  /* *
   * @override
   * @param {shaka.extern.ManifestDB} old
   * @return {shaka.extern.ManifestDB}
   */
  convertManifest(old) {
    // JSON serialization turns Infinity into null, so turn it back now.
    if (old.expiration === null) {
      old.expiration = Infinity
    }
    return old
  }
}
