import polyfill from './all'

/* *
 * @summary A polyfill to silence the play() Promise in HTML5 video.
 */
export default class VideoPlayPromise {
  /* *
   * Install the polyfill if needed.
   */
  static install() {
    console.debug('VideoPlayPromise.install')

    if (HTMLMediaElement) {
      // eslint-disable-next-line no-restricted-syntax
      const originalPlay = HTMLMediaElement.prototype.play
      // eslint-disable-next-line no-restricted-syntax
      HTMLMediaElement.prototype.play = function() {
        // eslint-disable-next-line no-restricted-syntax
        const p = originalPlay.apply(this)
        if (p) {
          // This browser is returning a Promise from play().
          // If the play() call fails or is interrupted, the Promise will be
          // rejected.  Some apps, however, don't listen to this Promise,
          // especially since it is not available cross-browser.  If the Promise
          // is rejected without anyone listening for the failure, an error will
          // appear in the JS console.
          // To avoid confusion over this innocuous 'error', we will install a
          // catch handler on the Promise.  This does not prevent the app from
          // also catching failures and handling them.  It only prevents the
          // console message.
          p.catch(() => {})
        }
        return p
      }
    }
  }
}
polyfill.register(VideoPlayPromise.install)
