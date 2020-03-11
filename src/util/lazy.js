
/**
 * @summary
 * This contains a single value that is lazily generated when it is first
 * requested.  This can store any value except 'undefined'.
 *
 * @template T
 * @export
 */
export default class Lazy {
  /** @param {function():T} gen */
  constructor(gen) {
    /** @private {function():T} */
    this.gen_ = gen

    /** @private {T|undefined} */
    this.value_ = undefined
  }

  /**
   * @return {T}
   * @export
   */
  value() {
    if (this.value_ === undefined) {
      // Compiler complains about unknown fields without this cast.
      this.value_ = /** @type {*} */ (this.gen_())
      console.assert(
        this.value_ !== undefined, 'Unable to create lazy value')
    }
    return this.value_
  }
}
