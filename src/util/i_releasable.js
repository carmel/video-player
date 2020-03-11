/**
 * An interface to standardize how objects release internal references
 * synchronously. If an object needs to asynchronously release references, then
 * it should use 'shaka.util.IDestroyable'.
 *
 * @interface
 * @export
 */
export default class IReleasable {
  /**
   * Request that this object release all internal references.
   *
   * @exportInterface
   */
  release() {}
}
