import DBConnection from './db_connection'

/* *
 * The implementation of the EME session storage cell.
 *
 * @implements {shaka.extern.EmeSessionStorageCell}
 */
export default class EmeSessionStorageCell {
  /* *
   * @param {IDBDatabase} connection
   * @param {string} store
   */
  constructor(connection, store) {
    /* * @private {!DBConnection} */
    this.connection_ = new DBConnection(connection)

    /* * @private {string} */
    this.store_ = store
  }

  /* * @override */
  destroy() { return this.connection_.destroy() }

  /* * @override */
  async getAll() {
    /* * @type {!DBOperation} */
    const op = this.connection_.startReadOnlyOperation(this.store_)
    /* * @type {!Array.<shaka.extern.EmeSessionDB>} */
    const values = []

    await op.forEachEntry((key, value) => {
      values.push(value)
    })

    await op.promise()
    return values
  }

  /* * @override */
  add(sessions) {
    const op = this.connection_.startReadWriteOperation(this.store_)
    const store = op.store()

    for (const session of sessions) {
      store.add(session)
    }

    return op.promise()
  }

  /* * @override */
  async remove(sessionIds) {
    /* * @type {!DBOperation} */
    const op = this.connection_.startReadWriteOperation(this.store_)

    await op.forEachEntry((key, value, cursor) => {
      if (sessionIds.includes(value.sessionId)) {
        cursor.delete()
      }
    })

    await op.promise()
  }
}
