import Iterables from '../util/iterables'
/* *
 * @summary A one-stop installer for all polyfills.
 * @see http://enwp.org/polyfill
 * @exportInterface
 */
export default class polyfill {
  /* *
   * Install all polyfills.
   * @export
   */
  static installAll() {
    for (const polyfill of polyfill.polyfills_) {
      try {
        polyfill.callback()
      } catch (error) {
        console.warn('Error installing polyfill!', error)
      }
    }
  }

  /* *
   * Registers a new polyfill to be installed.
   *
   * @param {function()} polyfill
   * @param {number=} priority An optional number priority.  Higher priorities
   *   will be executed before lower priority ones.  Default is 0.
   * @export
   */
  static register(polyfill, priority) {
    const newItem = { priority: priority || 0, callback: polyfill }
    const enumerate = (it) => Iterables.enumerate(it)
    for (const { i, item } of enumerate(polyfill.polyfills_)) {
      if (item.priority < newItem.priority) {
        polyfill.polyfills_.splice(i, 0, newItem)
        return
      }
    }
    polyfill.polyfills_.push(newItem)
  }
}
/* *
 * Contains the polyfills that will be installed.
 * @private {!Array.<{priority: number, callback: function()}>}
 */
polyfill.polyfills_ = []
