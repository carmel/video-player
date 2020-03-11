// import IReleasable from '../util/i_releasable'
import MultiMap from '../util/multi_map'

/**
 * @summary
 * An EventManager maintains a collection of 'event
 * bindings' between event targets and event listeners.
 *
 * @implements {IReleasable}
 * @export
 */
export default class EventManager {
  constructor() {
    /**
     * Maps an event type to an array of event bindings.
     * @private {MultiMap.<!EventManager.Binding_>}
     */
    this.bindingMap_ = new MultiMap()
  }
  /**
   * Detaches all event listeners.
   * @override
   * @export
   */
  release() {
    this.removeAll()
    this.bindingMap_ = null
  }
  /**
   * Attaches an event listener to an event target.
   * @param {EventTarget} target The event target.
   * @param {string} type The event type.
   * @param {EventManager.ListenerType} listener The event listener.
   * @param {(boolean|!AddEventListenerOptions)=} options An object that
   *    specifies characteristics about the event listener.
   *    The passive option, if true, indicates that this function will never
   *    call preventDefault(), which improves scrolling performance.
   * @export
   */
  listen(target, type, listener, options) {
    if (!this.bindingMap_) {
      return
    }

    const binding =
        new EventManager.Binding_(target, type, listener, options)
    this.bindingMap_.push(type, binding)
  }
  /**
   * Attaches an event listener to an event target.  The listener will be
   * removed when the first instance of the event is fired.
   * @param {EventTarget} target The event target.
   * @param {string} type The event type.
   * @param {EventManager.ListenerType} listener The event listener.
   * @param {(boolean|!AddEventListenerOptions)=} options An object that
   *    specifies characteristics about the event listener.
   *    The passive option, if true, indicates that this function will never
   *    call preventDefault(), which improves scrolling performance.
   * @export
   */
  listenOnce(target, type, listener, options) {
    // Install a shim listener that will stop listening after the first event.
    const shim = (event) => {
      // Stop listening to this event.
      this.unlisten(target, type, shim)
      // Call the original listener.
      listener(event)
    }
    this.listen(target, type, shim, options)
  }
  /**
   * Detaches an event listener from an event target.
   * @param {EventTarget} target The event target.
   * @param {string} type The event type.
   * @param {EventManager.ListenerType=} listener The event listener.
   * @export
   */
  unlisten(target, type, listener) {
    if (!this.bindingMap_) {
      return
    }

    const list = this.bindingMap_.get(type) || []

    for (const binding of list) {
      if (binding.target === target) {
        if (listener === binding.listener || !listener) {
          binding.unlisten()
          this.bindingMap_.remove(type, binding)
        }
      }
    }
  }
  /**
   * Detaches all event listeners from all targets.
   * @export
   */
  removeAll() {
    if (!this.bindingMap_) {
      return
    }

    const list = this.bindingMap_.getAll()

    for (const binding of list) {
      binding.unlisten()
    }

    this.bindingMap_.clear()
  }
}
/**
 * @typedef {function(!Event)}
 * @export
 */
EventManager.ListenerType
/**
 * Creates a new Binding_ and attaches the event listener to the event target.
 *
 * @private
 */
EventManager.Binding_ = class {
  /**
   * @param {EventTarget} target The event target.
   * @param {string} type The event type.
   * @param {EventManager.ListenerType} listener The event listener.
   * @param {(boolean|!AddEventListenerOptions)=} options An object that
   *    specifies characteristics about the event listener.
   *    The passive option, if true, indicates that this function will never
   *    call preventDefault(), which improves scrolling performance.
   */
  constructor(target, type, listener, options) {
    /** @type {EventTarget} */
    this.target = target

    /** @type {string} */
    this.type = type

    /** @type {?EventManager.ListenerType} */
    this.listener = listener

    /** @type {(boolean|!AddEventListenerOptions)} */
    this.options =
        EventManager.Binding_.convertOptions_(target, options)

    this.target.addEventListener(type, listener, this.options)
  }
  /**
   * Detaches the event listener from the event target. This does nothing if
   * the event listener is already detached.
   * @export
   */
  unlisten() {
    console.assert(this.target, 'Missing target')
    this.target.removeEventListener(this.type, this.listener, this.options)

    this.target = null
    this.listener = null
    this.options = false
  }

  /**
   * Converts the provided options value into a value accepted by the browser.
   * Some browsers (e.g. IE11 and Tizen) don't support passing options as an
   * object.  So this detects this case and converts it.
   *
   * @param {EventTarget} target
   * @param {(boolean|!AddEventListenerOptions)=} value
   * @return {(boolean|!AddEventListenerOptions)}
   * @private
   */
  static convertOptions_(target, value) {
    if (value === undefined) {
      return false
    } else if (typeof value === 'boolean') {
      return value
    } else {
      // Ignore the 'passive' option since it is just an optimization and
      // doesn't affect behavior.  Assert there aren't any other settings to
      // ensure we don't have different behavior on different browsers by
      // ignoring an important option.
      const ignored = new Set(['passive', 'capture'])
      const keys = Object.keys(value).filter((k) => !ignored.has(k))
      console.assert(
        keys.length === 0,
        'Unsupported flag(s) to addEventListener: ' + keys.join(','))

      const supports =
          EventManager.Binding_.doesSupportObject_(target)
      if (supports) {
        return value
      } else {
        return value['capture'] || false
      }
    }
  }

  /**
   * Checks whether the browser supports passing objects as the third argument
   * to addEventListener.  This caches the result value in a static field to
   * avoid a bunch of checks.
   *
   * @param {EventTarget} target
   * @return {boolean}
   * @private
   */
  static doesSupportObject_(target) {
    // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#Safely_detecting_option_support
    let supports = EventManager.Binding_.supportsObject_
    if (supports === undefined) {
      supports = false
      try {
        const options = {}
        // This defines a getter that will set this variable if called.  So if
        // the browser gets this property, it supports using an object.  If the
        // browser doesn't get these fields, it won't support objects.
        const prop = {
          get: () => {
            supports = true
            return false
          }
        }
        Object.defineProperty(options, 'passive', prop)
        Object.defineProperty(options, 'capture', prop)

        const call = () => {}
        target.addEventListener('test', call, options)
        target.removeEventListener('test', call, options)
      } catch (e) {
        supports = false
      }
      EventManager.Binding_.supportsObject_ = supports
    }
    return supports || false // 'false' fallback needed for compiler.
  }
}

/** @private {(boolean|undefined)} */
EventManager.Binding_.supportsObject_ = undefined
