import ArrayUtils from './array_utils'
// import IDestroyable from './i_destroyable'
/* *
 * A utility for cleaning up AbortableOperations, to help simplify common
 * patterns and reduce code duplication.
 *
 * @implements {IDestroyable}
 */
export default class OperationManager {
  constructor() {
    /* * @private {!Array.<!shaka.extern.IAbortableOperation>} */
    this.operations_ = []
  }

  /* *
   * Manage an operation.  This means aborting it on destroy() and removing it
   * from the management set when it complete.
   *
   * @param {!shaka.extern.IAbortableOperation} operation
   */
  manage(operation) {
    this.operations_.push(operation.finally(() => {
      ArrayUtils.remove(this.operations_, operation)
    }))
  }

  /* * @override */
  destroy() {
    const cleanup = []
    for (const op of this.operations_) {
      // Catch and ignore any failures.  This silences error logs in the
      // JavaScript console about uncaught Promise failures.
      op.promise.catch(() => {})

      // Now abort the operation.
      cleanup.push(op.abort())
    }

    this.operations_ = []
    return Promise.all(cleanup)
  }
}
