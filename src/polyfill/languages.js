import polyfill from './all'

/**
 * @summary A polyfill to provide navigator.languages on all browsers.
 * This is necessary for IE and possibly others we have yet to discover.
 */
export default class Languages {
  /**
   * Install the polyfill if needed.
   */
  static install() {
    if (navigator.languages) {
      // No need.
      return
    }

    Object.defineProperty(navigator, 'languages', {
      get: () => {
        // If the browser provides a single language (all that we've seen), then
        // make an array out of that.  Otherwise, return English.
        if (navigator.language) {
          return [navigator.language]
        }
        return ['en']
      }
    })
  }
}
polyfill.register(Languages.install)
