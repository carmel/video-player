import PublicPromise from './public_promise'

/* *
 * @summary
 * A utility class to help work with |IDestroyable| objects.
 *
 * @final
 */
export default class Destroyer {
  /* *
   * @param {function():!Promise} callback
   *    A callback to destroy an object. This callback will only be called once
   *    regardless of how many times |destroy| is called.
   */
  constructor(callback) {
    /* * @private {boolean} */
    this.destroyed_ = false

    /* * @private {!PublicPromise} */
    this.waitOnDestroy_ = new PublicPromise()

    /* * @private {function():!Promise} */
    this.onDestroy_ = callback
  }

  /* *
   * Check if |destroy| has been called. This returning |true| does not mean
   * that the promise returned by |destroy| has resolved yet.
   *
   * @return {boolean}
   * @final
   */
  destroyed() {
    return this.destroyed_
  }

  /* *
   * Request that the destroy callback be called. Will return a promise that
   * will resolve once the callback terminates. The promise will never be
   * rejected.
   *
   * @return {!Promise}
   * @final
   */
  destroy() {
    if (this.destroyed_) {
      return this.waitOnDestroy_
    }

    // We have started destroying this object, so we should never get here
    // again.
    this.destroyed_ = true

    return this.onDestroy_().then(
      () => { this.waitOnDestroy_.resolve() },
      () => { this.waitOnDestroy_.resolve() })
  }

  /* *
   * Checks if the object is destroyed and throws an error if it is.
   * @param {*=} error The inner error, if any.
   */
  ensureNotDestroyed(error) {
    if (this.destroyed_) {
      if (error && error.code === Error.Code.OBJECT_DESTROYED) {
        throw error
      } else {
        throw Destroyer.destroyedError(error)
      }
    }
  }

  /* *
   * @param {*=} error The inner error, if any.
   * @return {!Error}
   */
  static destroyedError(error) {
    return new Error(
      Error.Severity.CRITICAL,
      Error.Category.PLAYER,
      Error.Code.OBJECT_DESTROYED,
      error)
  }
}
