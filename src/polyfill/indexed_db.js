import polyfill from './all'
import Platform from '../util/platform'
/* *
 * @summary A polyfill to patch IndexedDB bugs.
 */
export default class IndexedDB {
  /* *
   * Install the polyfill if needed.
   */
  static install() {
    console.debug('IndexedDB.install')

    let disableIDB = false
    if (Platform.isChromecast()) {
      console.debug('Removing IndexedDB from ChromeCast')
      disableIDB = true
    } else {
      try {
        // This is necessary to avoid Closure compiler over optimize this
        // block and remove it if it looks like a noop
        if (window.indexedDB) {
          disableIDB = false
        }
      } catch (e) {
        console.debug(
          'Removing IndexedDB due to an exception when accessing it')
        disableIDB = true
      }
    }

    if (disableIDB) {
      delete window.indexedDB
      console.assert(
        !indexedDB, 'Failed to override indexedDB')
    }
  }
}

polyfill.register(IndexedDB.install)
