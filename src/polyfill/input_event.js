import polyfill from './all'
import Platform from '../util/platform'

/* *
 * @summary A polyfill to patch 'input' event support in IE11.
 */
export default class InputEvent {
  /* *
   * Install the polyfill if needed.
   */
  static install() {
    console.debug('InputEvent.install')

    // IE11 doesn't treat the 'input' event correctly.
    // https://bit.ly/2loLsuX

    if (!Platform.isIE()) {
      // Not IE, so don't patch anything.
      return
    }

    // In our tests, we can end up with multiple independent 'shaka' namespaces.
    // So we can't compare addEventListener with the polyfill directly.
    // Instead, store the original in a globally accessible place and check if
    // that has been used yet.
    // eslint-disable-next-line no-restricted-syntax
    if (HTMLInputElement.prototype['originalAddEventListener']) {
      // The polyfill was already installed.
      return
    }

    console.info('Patching input event support on IE.')

    // eslint-disable-next-line no-restricted-syntax
    HTMLInputElement.prototype['originalAddEventListener'] =
        // eslint-disable-next-line no-restricted-syntax
        HTMLInputElement.prototype.addEventListener

    // eslint-disable-next-line no-restricted-syntax
    HTMLInputElement.prototype['addEventListener'] =
        // eslint-disable-next-line no-restricted-syntax
        polyfill.InputEvent.addEventListener_
  }

  /* *
   * Add an event listener to this object and translate the event types to those
   * that work on IE11.
   *
   * @param {string} type
   * @param {EventListener|function(!Event):(boolean|undefined)} listener
   * @param {(!AddEventListenerOptions|boolean)=} options
   * @this {HTMLInputElement}
   * @private
   */
  static addEventListener_(type, listener, options) {
    if (type === 'input') {
      // Based on the type of input element, translate the HTML5 'input' event
      // to one that IE11 will actually dispatch.

      switch (this.type) {
        // For range inputs, we use the 'change' event.
        case 'range':
          type = 'change'
          break
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    HTMLInputElement.prototype['originalAddEventListener'].call(
      this, type, listener, options)
  }
}

polyfill.register(InputEvent.install)
