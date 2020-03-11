import DBOperation from './db_operation'
import ArrayUtils from '../../util/array_utils'

/**
 * DBConnection is used to manage an IndexedDB connection. It can create new
 * operations. If the connection is killed (via |destroy|) all pending
 * operations will be cancelled.
 */
export default class DBConnection {
  /**
   * @param {IDBDatabase} connection A connection to an IndexedDB instance.
   */
  constructor(connection) {
    /** @private {IDBDatabase} */
    this.connection_ = connection
    /** @private {!Array.<DBOperation>} */
    this.pending_ = []
  }

  /**
   * @return {!Promise}
   */
  destroy() {
    return Promise.all(this.pending_.map((op) => {
      return op.abort()
    }))
  }

  /**
   * @param {string} store The name of the store that the operation should
   *                       occur on.
   * @return {!DBOperation}
   */
  startReadOnlyOperation(store) {
    return this.startOperation_(store, 'readonly')
  }

  /**
   * @param {string} store The name of the store that the operation should
   *                       occur on.
   * @return {!DBOperation}
   */
  startReadWriteOperation(store) {
    return this.startOperation_(store, 'readwrite')
  }

  /**
   * @param {string} store The name of the store that the operation should
   *                       occur on.
   * @param {string} type The type of operation being performed on the store.
   *                      This determines what commands may be performed. This
   *                      can either be 'readonly' or 'readwrite'.
   * @return {!DBOperation}
   * @private
   */
  startOperation_(store, type) {
    const transaction = this.connection_.transaction([store], type)
    const operation =
        new DBOperation(transaction, store)

    this.pending_.push(operation)

    // Once the operation is done (regardless of outcome) stop tracking it.
    operation.promise().then(
      () => this.stopTracking_(operation),
      () => this.stopTracking_(operation)
    )

    return operation
  }

  /**
   * @param {!DBOperation} operation
   * @private
   */
  stopTracking_(operation) {
    ArrayUtils.remove(this.pending_, operation)
  }
}
