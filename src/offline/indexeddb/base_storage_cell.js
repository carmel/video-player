import DBConnection from './db_connection'
import Error from '../../util/error'

/* *
 * StorageCellBase is a base class for all stores that use IndexedDB.
 *
 * @implements {shaka.extern.StorageCell}
 */
export default class BaseStorageCell {
  /* *
   * @param {IDBDatabase} connection
   * @param {string} segmentStore
   * @param {string} manifestStore
   */
  constructor(connection, segmentStore, manifestStore) {
    /* * @protected {!DBConnection} */
    this.connection_ = new DBConnection(connection)

    /* * @protected {string} */
    this.segmentStore_ = segmentStore

    /* * @protected {string} */
    this.manifestStore_ = manifestStore
  }

  /* * @override */
  destroy() {
    return this.connection_.destroy()
  }

  /* * @override */
  hasFixedKeySpace() {
    // By default, all IDB stores are read-only.  The latest one will need to
    // override this default to be read-write.
    return true
  }

  /* * @override */
  addSegments(segments) {
    // By default, reject all additions.
    return this.rejectAdd(this.segmentStore_)
  }

  /* * @override */
  removeSegments(keys, onRemove) {
    return this.remove_(this.segmentStore_, keys, onRemove)
  }

  /* * @override */
  async getSegments(keys) {
    const rawSegments = await this.get_(this.segmentStore_, keys)
    return rawSegments.map((s) => this.convertSegmentData(s))
  }

  /* * @override */
  addManifests(manifests) {
    // By default, reject all additions.
    return this.rejectAdd(this.manifestStore_)
  }

  /* * @override */
  updateManifestExpiration(key, newExpiration) {
    const op = this.connection_.startReadWriteOperation(this.manifestStore_)
    const store = op.store()
    store.get(key).onsuccess = (e) => {
      const manifest = e.target.result
      // If we can't find the value, then there is nothing for us to update.
      if (manifest) {
        manifest.expiration = newExpiration
        store.put(manifest, key)
      }
    }

    return op.promise()
  }

  /* * @override */
  removeManifests(keys, onRemove) {
    return this.remove_(this.manifestStore_, keys, onRemove)
  }

  /* * @override */
  async getManifests(keys) {
    const rawManifests = await this.get_(this.manifestStore_, keys)
    return rawManifests.map((m) => this.convertManifest(m))
  }

  /* * @override */
  async getAllManifests() {
    /* * @type {!DBOperation} */
    const op = this.connection_.startReadOnlyOperation(this.manifestStore_)

    /* * @type {!Map.<number, shaka.extern.ManifestDB>} */
    const values = new Map()

    await op.forEachEntry((/* * number */ key, /* * ? */ value) => {
      values.set(key, this.convertManifest(value))
    })

    await op.promise()
    return values
  }

  /* *
   * @param {?} old
   * @return {shaka.extern.SegmentDataDB}
   * @protected
   */
  convertSegmentData(old) {
    // Conversion is specific to each subclass.  By default, do nothing.
    return /* * @type {shaka.extern.SegmentDataDB} */(old)
  }

  /* *
   * @param {?} old
   * @return {shaka.extern.ManifestDB}
   * @protected
   */
  convertManifest(old) {
    // Conversion is specific to each subclass.  By default, do nothing.
    return /* * @type {shaka.extern.ManifestDB} */(old)
  }

  /* *
   * @param {string} storeName
   * @return {!Promise}
   * @protected
   */
  rejectAdd(storeName) {
    return Promise.reject(new Error(
      Error.Severity.CRITICAL,
      Error.Category.STORAGE,
      Error.Code.NEW_KEY_OPERATION_NOT_SUPPORTED,
      'Cannot add new value to ' + storeName))
  }

  /* *
   * @param {string} storeName
   * @param {!Array.<T>} values
   * @return {!Promise.<!Array.<number>>}
   * @template T
   * @protected
   */
  async add(storeName, values) {
    const op = this.connection_.startReadWriteOperation(storeName)
    const store = op.store()

    /* * @type {!Array.<number>} */
    const keys = []

    // Write each segment out. When each request completes, the key will
    // be in |event.target.result| as can be seen in
    // https://w3c.github.io/IndexedDB/#key-generator-construct.
    for (const value of values) {
      const request = store.add(value)
      request.onsuccess = (event) => {
        const key = event.target.result
        keys.push(key)
      }
    }

    // Wait until the operation completes or else |keys| will not be fully
    // populated.
    await op.promise()
    return keys
  }

  /* *
   * @param {string} storeName
   * @param {!Array.<number>} keys
   * @param {function(number)} onRemove
   * @return {!Promise}
   * @private
   */
  remove_(storeName, keys, onRemove) {
    const op = this.connection_.startReadWriteOperation(storeName)
    const store = op.store()

    for (const key of keys) {
      store.delete(key).onsuccess = () => onRemove(key)
    }

    return op.promise()
  }

  /* *
   * @param {string} storeName
   * @param {!Array.<number>} keys
   * @return {!Promise.<!Array.<T>>}
   * @template T
   * @private
   */
  async get_(storeName, keys) {
    const op = this.connection_.startReadOnlyOperation(storeName)
    const store = op.store()

    const values = {}
    /* * @type {!Array.<number>} */
    const missing = []

    // Use a map to store the objects so that we can reorder the results to
    // match the order of |keys|.
    for (const key of keys) {
      const request = store.get(key)
      request.onsuccess = () => {
        // Make sure a defined value was found. Indexeddb treats no-value found
        // as a success with an undefined result.
        if (request.result === undefined) {
          missing.push(key)
        }

        values[key] = request.result
      }
    }

    // Wait until the operation completes or else values may be missing from
    // |values|. Use the original key list to convert the map to a list so that
    // the order will match.
    await op.promise()
    if (missing.length) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.STORAGE,
        Error.Code.KEY_NOT_FOUND,
        'Could not find values for ' + missing
      )
    }

    return keys.map((key) => values[key])
  }
}
