import polyfill from './all'
/* *
 * @summary A polyfill to unify fullscreen APIs across browsers.
 * Many browsers have prefixed fullscreen methods on Element and document.
 * See {@link https://mzl.la/2K0xcHo Using fullscreen mode} on MDN for more
 * information.
 */
export default class Fullscreen {
  /* *
   * Install the polyfill if needed.
   */
  static install() {
    if (!Document) {
      // Avoid errors on very old browsers.
      return
    }

    // eslint-disable-next-line no-restricted-syntax
    let proto = Element.prototype
    proto.requestFullscreen = proto.requestFullscreen ||
                              proto.mozRequestFullScreen ||
                              proto.msRequestFullscreen ||
                              proto.webkitRequestFullscreen

    // eslint-disable-next-line no-restricted-syntax
    proto = Document.prototype
    proto.exitFullscreen = proto.exitFullscreen ||
                           proto.mozCancelFullScreen ||
                           proto.msExitFullscreen ||
                           proto.webkitExitFullscreen

    if (!('fullscreenElement' in document)) {
      Object.defineProperty(document, 'fullscreenElement', {
        get: () => {
          return document.mozFullScreenElement ||
                 document.msFullscreenElement ||
                 document.webkitFullscreenElement
        }
      })
      Object.defineProperty(document, 'fullscreenEnabled', {
        get: () => {
          return document.mozFullScreenEnabled ||
                 document.msFullscreenEnabled ||
                 document.webkitFullscreenEnabled
        }
      })
    }

    const proxy = Fullscreen.proxyEvent_
    document.addEventListener('webkitfullscreenchange', proxy)
    document.addEventListener('webkitfullscreenerror', proxy)
    document.addEventListener('mozfullscreenchange', proxy)
    document.addEventListener('mozfullscreenerror', proxy)
    document.addEventListener('MSFullscreenChange', proxy)
    document.addEventListener('MSFullscreenError', proxy)
  }

  /* *
   * Proxy fullscreen events after changing their name.
   * @param {!Event} event
   * @private
   */
  static proxyEvent_(event) {
    const eventType = event.type.replace(/^(webkit|moz|MS)/, '').toLowerCase()

    let newEvent
    // IE 11 does not have an Event constructor
    if (typeof (Event) === 'function') {
      newEvent = new Event(eventType, /* * @type {EventInit} */(event))
    } else {
      newEvent = document.createEvent('Event')
      newEvent.initEvent(eventType, event.bubbles, event.cancelable)
    }

    event.target.dispatchEvent(newEvent)
  }
}

polyfill.register(Fullscreen.install)
