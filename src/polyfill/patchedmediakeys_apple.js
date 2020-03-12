import polyfill from './all'
import BufferUtils from '../util/buffer_utils'
import EventManager from '../util/event_manager'
import FakeEvent from '../util/FakeEvent'
import FakeEventTarget from '../util/fake_event_target'
import PublicPromise from '../util/public_promise'

/* *
 * @summary A polyfill to implement modern, standardized EME on top of Apple's
 * prefixed EME in Safari.
 */
export default class PatchedMediaKeysApple {
  /* *
   * Installs the polyfill if needed.
   */
  static install() {
    if (!HTMLVideoElement || !window.WebKitMediaKeys) {
      // No HTML5 video or no prefixed EME.
      return
    }

    // TODO: Prefer unprefixed EME once we know how to use it.
    // See: https://bugs.webkit.org/show_bug.cgi?id=197433
    /*
    if (navigator.requestMediaKeySystemAccess &&
        MediaKeySystemAccess.prototype.getConfiguration) {
      // Prefixed EME is preferable.
      return
    }
    */

    console.info('Using Apple-prefixed EME')

    // Alias
    const PatchedMediaKeysApple = PatchedMediaKeysApple

    // Delete mediaKeys to work around strict mode compatibility issues.
    // eslint-disable-next-line no-restricted-syntax
    delete HTMLMediaElement.prototype['mediaKeys']
    // Work around read-only declaration for mediaKeys by using a string.
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype['mediaKeys'] = null
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype.setMediaKeys =
        PatchedMediaKeysApple.setMediaKeys

    // Install patches
    window.MediaKeys = PatchedMediaKeysApple.MediaKeys
    window.MediaKeySystemAccess = PatchedMediaKeysApple.MediaKeySystemAccess
    navigator.requestMediaKeySystemAccess =
        PatchedMediaKeysApple.requestMediaKeySystemAccess
  }

  /* *
   * An implementation of navigator.requestMediaKeySystemAccess.
   * Retrieves a MediaKeySystemAccess object.
   *
   * @this {!Navigator}
   * @param {string} keySystem
   * @param {!Array.<!MediaKeySystemConfiguration>} supportedConfigurations
   * @return {!Promise.<!MediaKeySystemAccess>}
   */
  static requestMediaKeySystemAccess(keySystem, supportedConfigurations) {
    console.debug('PatchedMediaKeysApple.requestMediaKeySystemAccess')
    console.assert(this === navigator,
      'bad `this` for requestMediaKeySystemAccess')

    // Alias.
    const PatchedMediaKeysApple = PatchedMediaKeysApple
    try {
      const access = new PatchedMediaKeysApple.MediaKeySystemAccess(
        keySystem, supportedConfigurations)
      return Promise.resolve(/* * @type {!MediaKeySystemAccess} */ (access))
    } catch (exception) {
      return Promise.reject(exception)
    }
  }

  /* *
   * An implementation of HTMLMediaElement.prototype.setMediaKeys.
   * Attaches a MediaKeys object to the media element.
   *
   * @this {!HTMLMediaElement}
   * @param {MediaKeys} mediaKeys
   * @return {!Promise}
   */
  static setMediaKeys(mediaKeys) {
    console.debug('PatchedMediaKeysApple.setMediaKeys')
    console.assert(this instanceof HTMLMediaElement,
      'bad `this` for setMediaKeys')

    // Alias
    const PatchedMediaKeysApple = PatchedMediaKeysApple

    const newMediaKeys =
    /* * @type {PatchedMediaKeysApple.MediaKeys} */ (
        mediaKeys)
    const oldMediaKeys =
    /* * @type {PatchedMediaKeysApple.MediaKeys} */ (
        this.mediaKeys)

    if (oldMediaKeys && oldMediaKeys !== newMediaKeys) {
      console.assert(
        oldMediaKeys instanceof PatchedMediaKeysApple.MediaKeys,
        'non-polyfill instance of oldMediaKeys')
      // Have the old MediaKeys stop listening to events on the video tag.
      oldMediaKeys.setMedia(null)
    }

    delete this['mediaKeys'] // in case there is an existing getter
    this['mediaKeys'] = mediaKeys // work around read-only declaration

    if (newMediaKeys) {
      console.assert(
        newMediaKeys instanceof PatchedMediaKeysApple.MediaKeys,
        'non-polyfill instance of newMediaKeys')
      return newMediaKeys.setMedia(this)
    }

    return Promise.resolve()
  }

  /* *
   * Handler for the native media elements webkitneedkey event.
   *
   * @this {!HTMLMediaElement}
   * @param {!MediaKeyEvent} event
   * @private
   */
  static onWebkitNeedKey_(event) {
    console.debug('PatchedMediaKeysApple.onWebkitNeedKey_', event)

    const PatchedMediaKeysApple = PatchedMediaKeysApple
    const mediaKeys =
    /* * @type {PatchedMediaKeysApple.MediaKeys} */(
        this.mediaKeys)
    console.assert(mediaKeys instanceof PatchedMediaKeysApple.MediaKeys,
      'non-polyfill instance of newMediaKeys')

    console.assert(event.initData !== null, 'missing init data!')

    // NOTE: Because `this` is a real EventTarget, the event we dispatch here
    // must also be a real Event.
    const event2 = new Event('encrypted')
    // TODO: validate this initDataType against the unprefixed version
    event2.initDataType = 'cenc'
    event2.initData = BufferUtils.toArrayBuffer(event.initData)

    this.dispatchEvent(event2)
  }
}
/* *
 * An implementation of MediaKeySystemAccess.
 *
 * @implements {MediaKeySystemAccess}
 */
PatchedMediaKeysApple.MediaKeySystemAccess = class {
  /* *
   * @param {string} keySystem
   * @param {!Array.<!MediaKeySystemConfiguration>} supportedConfigurations
   */
  constructor(keySystem, supportedConfigurations) {
    console.debug('PatchedMediaKeysApple.MediaKeySystemAccess')

    /* * @type {string} */
    this.keySystem = keySystem

    /* * @private {!MediaKeySystemConfiguration} */
    this.configuration_

    // Optimization: WebKitMediaKeys.isTypeSupported delays responses by a
    // significant amount of time, possibly to discourage fingerprinting.
    // Since we know only FairPlay is supported here, let's skip queries for
    // anything else to speed up the process.
    if (keySystem.startsWith('com.apple.fps')) {
      for (const cfg of supportedConfigurations) {
        const newCfg = this.checkConfig_(cfg)
        if (newCfg) {
          this.configuration_ = newCfg
          return
        }
      }
    }

    // As per the spec, this should be a DOMException, but there is not a
    // public constructor for DOMException.
    const unsupportedKeySystemError = new Error('Unsupported keySystem')
    unsupportedKeySystemError.name = 'NotSupportedError'
    unsupportedKeySystemError.code = DOMException.NOT_SUPPORTED_ERR
    throw unsupportedKeySystemError
  }

  /* *
   * Check a single config for MediaKeySystemAccess.
   *
   * @param {MediaKeySystemConfiguration} cfg The requested config.
   * @return {?MediaKeySystemConfiguration} A matching config we can support, or
   *   null if the input is not supportable.
   * @private
   */
  checkConfig_(cfg) {
    if (cfg.persistentState === 'required') {
      // Not supported by the prefixed API.
      return null
    }

    // Create a new config object and start adding in the pieces which we find
    // support for.  We will return this from getConfiguration() later if
    // asked.

    /* * @type {!MediaKeySystemConfiguration} */
    const newCfg = {
      'audioCapabilities': [],
      'videoCapabilities': [],
      // It is technically against spec to return these as optional, but we
      // don't truly know their values from the prefixed API:
      'persistentState': 'optional',
      'distinctiveIdentifier': 'optional',
      // Pretend the requested init data types are supported, since we don't
      // really know that either:
      'initDataTypes': cfg.initDataTypes,
      'sessionTypes': ['temporary'],
      'label': cfg.label
    }

    // PatchedMediaKeysApple tests for key system availability through
    // WebKitMediaKeys.isTypeSupported.
    let ranAnyTests = false
    let success = false

    if (cfg.audioCapabilities) {
      for (const cap of cfg.audioCapabilities) {
        if (cap.contentType) {
          ranAnyTests = true

          const contentType = cap.contentType.split(';')[0]
          if (window.WebKitMediaKeys.isTypeSupported(this.keySystem, contentType)) {
            newCfg.audioCapabilities.push(cap)
            success = true
          }
        }
      }
    }

    if (cfg.videoCapabilities) {
      for (const cap of cfg.videoCapabilities) {
        if (cap.contentType) {
          ranAnyTests = true

          const contentType = cap.contentType.split(';')[0]
          if (window.WebKitMediaKeys.isTypeSupported(this.keySystem, contentType)) {
            newCfg.videoCapabilities.push(cap)
            success = true
          }
        }
      }
    }

    if (!ranAnyTests) {
      // If no specific types were requested, we check all common types to
      // find out if the key system is present at all.
      success = window.WebKitMediaKeys.isTypeSupported(this.keySystem, 'video/mp4')
    }

    if (success) {
      return newCfg
    }
    return null
  }

  /* * @override */
  createMediaKeys() {
    console.debug(
      'PatchedMediaKeysApple.MediaKeySystemAccess.createMediaKeys')

    // Alias
    const PatchedMediaKeysApple = PatchedMediaKeysApple

    const mediaKeys = new PatchedMediaKeysApple.MediaKeys(this.keySystem)
    return Promise.resolve(/* * @type {!MediaKeys} */ (mediaKeys))
  }

  /* * @override */
  getConfiguration() {
    console.debug(
      'PatchedMediaKeysApple.MediaKeySystemAccess.getConfiguration')
    return this.configuration_
  }
}
/* *
 * An implementation of MediaKeys.
 *
 * @implements {MediaKeys}
 */
PatchedMediaKeysApple.MediaKeys = class {
  /* * @param {string} keySystem */
  constructor(keySystem) {
    console.debug('PatchedMediaKeysApple.MediaKeys')

    /* * @private {!WebKitMediaKeys} */
    this.nativeMediaKeys_ = new window.WebKitMediaKeys(keySystem)

    /* * @private {!EventManager} */
    this.eventManager_ = new EventManager()
  }

  /* * @override */
  createSession(sessionType) {
    console.debug('PatchedMediaKeysApple.MediaKeys.createSession')

    sessionType = sessionType || 'temporary'
    // For now, only the 'temporary' type is supported.
    if (sessionType !== 'temporary') {
      throw new TypeError('Session type ' + sessionType +
      ' is unsupported on this platform.')
    }

    // Alias
    const PatchedMediaKeysApple = PatchedMediaKeysApple

    return new PatchedMediaKeysApple.MediaKeySession(
      this.nativeMediaKeys_, sessionType)
  }

  /* * @override */
  setServerCertificate(serverCertificate) {
    console.debug('PatchedMediaKeysApple.MediaKeys.setServerCertificate')
    return Promise.resolve(false)
  }

  /* *
   * @param {HTMLMediaElement} media
   * @protected
   * @return {!Promise}
   */
  setMedia(media) {
    // Alias
    const PatchedMediaKeysApple = PatchedMediaKeysApple

    // Remove any old listeners.
    this.eventManager_.removeAll()

    // It is valid for media to be null; null is used to flag that event
    // handlers need to be cleaned up.
    if (!media) {
      return Promise.resolve()
    }

    // Intercept and translate these prefixed EME events.
    this.eventManager_.listen(media, 'webkitneedkey',
    /* * @type {EventManager.ListenerType} */
      (PatchedMediaKeysApple.onWebkitNeedKey_))

    // Wrap native HTMLMediaElement.webkitSetMediaKeys with a Promise.
    try {
      // Some browsers require that readyState >=1 before mediaKeys can be
      // set, so check this and wait for loadedmetadata if we are not in the
      // correct state
      if (media.readyState >= 1) {
        media.webkitSetMediaKeys(this.nativeMediaKeys_)
      } else {
        this.eventManager_.listenOnce(media, 'loadedmetadata', () => {
          media.webkitSetMediaKeys(this.nativeMediaKeys_)
        })
      }

      return Promise.resolve()
    } catch (exception) {
      return Promise.reject(exception)
    }
  }
}
/* *
 * An implementation of MediaKeySession.
 *
 * @implements {MediaKeySession}
 */
PatchedMediaKeysApple.MediaKeySession =
      class extends FakeEventTarget {
        /* *
         * @param {WebKitMediaKeys} nativeMediaKeys
         * @param {string} sessionType
         */
        constructor(nativeMediaKeys, sessionType) {
          console.debug('PatchedMediaKeysApple.MediaKeySession')
          super()

          /* *
           * The native MediaKeySession, which will be created in
           * generateRequest.
           * @private {WebKitMediaKeySession}
           */
          this.nativeMediaKeySession_ = null

          /* * @private {WebKitMediaKeys} */
          this.nativeMediaKeys_ = nativeMediaKeys

          // Promises that are resolved later
          /* * @private {PublicPromise} */
          this.generateRequestPromise_ = null

          /* * @private {PublicPromise} */
          this.updatePromise_ = null

          /* * @private {!EventManager} */
          this.eventManager_ = new EventManager()

          /* * @type {string} */
          this.sessionId = ''

          /* * @type {number} */
          this.expiration = NaN

          /* * @type {!PublicPromise} */
          this.closed = new PublicPromise()

          /* * @type {!PatchedMediaKeysApple.MediaKeyStatusMap} */
          this.keyStatuses =
          new PatchedMediaKeysApple.MediaKeyStatusMap()
        }

        /* * @override */
        generateRequest(initDataType, initData) {
          console.debug(
            'PatchedMediaKeysApple.MediaKeySession.generateRequest')

          this.generateRequestPromise_ = new PublicPromise()

          try {
            // This EME spec version requires a MIME content type as the 1st
            // param to createSession, but doesn't seem to matter what the
            // value is.
            // It also only accepts Uint8Array, not ArrayBuffer, so explicitly
            // make initData into a Uint8Array.
            const session = this.nativeMediaKeys_.createSession(
              'video/mp4', BufferUtils.toUint8(initData))
            this.nativeMediaKeySession_ = session
            this.sessionId = session.sessionId || ''

            // Attach session event handlers here.
            this.eventManager_.listen(
              this.nativeMediaKeySession_, 'webkitkeymessage',
              /* * @type {EventManager.ListenerType} */
              (event) => this.onWebkitKeyMessage_(event))
            this.eventManager_.listen(session, 'webkitkeyadded',
              /* * @type {EventManager.ListenerType} */
              (event) => this.onWebkitKeyAdded_(event))
            this.eventManager_.listen(session, 'webkitkeyerror',
              /* * @type {EventManager.ListenerType} */
              (event) => this.onWebkitKeyError_(event))

            this.updateKeyStatus_('status-pending')
          } catch (exception) {
            this.generateRequestPromise_.reject(exception)
          }

          return this.generateRequestPromise_
        }

        /* * @override */
        load() {
          console.debug('PatchedMediaKeysApple.MediaKeySession.load')

          return Promise.reject(
            new Error('MediaKeySession.load not yet supported'))
        }

        /* * @override */
        update(response) {
          console.debug('PatchedMediaKeysApple.MediaKeySession.update')

          this.updatePromise_ = new PublicPromise()

          try {
            // Pass through to the native session.
            this.nativeMediaKeySession_.update(
              BufferUtils.toUint8(response))
          } catch (exception) {
            this.updatePromise_.reject(exception)
          }

          return this.updatePromise_
        }

        /* * @override */
        close() {
          console.debug('PatchedMediaKeysApple.MediaKeySession.close')

          try {
            // Pass through to the native session.
            this.nativeMediaKeySession_.close()

            this.closed.resolve()
            this.eventManager_.removeAll()
          } catch (exception) {
            this.closed.reject(exception)
          }

          return this.closed
        }

        /* * @override */
        remove() {
          console.debug('PatchedMediaKeysApple.MediaKeySession.remove')

          return Promise.reject(new Error('MediaKeySession.remove is only ' +
          'applicable for persistent licenses, which are not supported on ' +
          'this platform'))
        }

        /* *
         * Handler for the native keymessage event on WebKitMediaKeySession.
         *
         * @param {!MediaKeyEvent} event
         * @private
         */
        onWebkitKeyMessage_(event) {
          console.debug('PatchedMediaKeysApple.onWebkitKeyMessage_', event)

          // We can now resolve this.generateRequestPromise, which should be
          // non-null.
          console.assert(this.generateRequestPromise_,
            'generateRequestPromise_ should be set before now!')
          if (this.generateRequestPromise_) {
            this.generateRequestPromise_.resolve()
            this.generateRequestPromise_ = null
          }

          const isNew = this.keyStatuses.getStatus() === undefined

          const event2 = new FakeEvent('message', {
            messageType: isNew ? 'license-request' : 'license-renewal',
            message: BufferUtils.toArrayBuffer(event.message)
          })

          this.dispatchEvent(event2)
        }

        /* *
         * Handler for the native keyadded event on WebKitMediaKeySession.
         *
         * @param {!MediaKeyEvent} event
         * @private
         */
        onWebkitKeyAdded_(event) {
          console.debug('PatchedMediaKeysApple.onWebkitKeyAdded_', event)

          // This shouldn't fire while we're in the middle of generateRequest,
          // but if it does, we will need to change the logic to account for it.
          console.assert(!this.generateRequestPromise_,
            'Key added during generate!')

          // We can now resolve this.updatePromise, which should be non-null.
          console.assert(this.updatePromise_,
            'updatePromise_ should be set before now!')
          if (this.updatePromise_) {
            this.updateKeyStatus_('usable')
            this.updatePromise_.resolve()
            this.updatePromise_ = null
          }
        }

        /* *
         * Handler for the native keyerror event on WebKitMediaKeySession.
         *
         * @param {!MediaKeyEvent} event
         * @private
         */
        onWebkitKeyError_(event) {
          console.debug('PatchedMediaKeysApple.onWebkitKeyError_', event)

          const error = new Error('EME PatchedMediaKeysApple key error')
          error.errorCode = this.nativeMediaKeySession_.error

          if (this.generateRequestPromise_ !== null) {
            this.generateRequestPromise_.reject(error)
            this.generateRequestPromise_ = null
          } else if (this.updatePromise_ !== null) {
            this.updatePromise_.reject(error)
            this.updatePromise_ = null
          } else {
            // Unexpected error - map native codes to standardised key statuses.
            // Possible values of this.nativeMediaKeySession_.error.code:
            // MEDIA_KEYERR_UNKNOWN        = 1
            // MEDIA_KEYERR_CLIENT         = 2
            // MEDIA_KEYERR_SERVICE        = 3
            // MEDIA_KEYERR_OUTPUT         = 4
            // MEDIA_KEYERR_HARDWARECHANGE = 5
            // MEDIA_KEYERR_DOMAIN         = 6

            switch (this.nativeMediaKeySession_.error.code) {
              case window.WebKitMediaKeyError.MEDIA_KEYERR_OUTPUT:
              case window.WebKitMediaKeyError.MEDIA_KEYERR_HARDWARECHANGE:
                this.updateKeyStatus_('output-not-allowed')
                break
              default:
                this.updateKeyStatus_('internal-error')
                break
            }
          }
        }

        /* *
         * Updates key status and dispatch a 'keystatuseschange' event.
         *
         * @param {string} status
         * @private
         */
        updateKeyStatus_(status) {
          this.keyStatuses.setStatus(status)
          const event = new FakeEvent('keystatuseschange')
          this.dispatchEvent(event)
        }
      }
/* *
 * @summary An implementation of MediaKeyStatusMap.
 * This fakes a map with a single key ID.
 *
 * @todo Consolidate the MediaKeyStatusMap types in these polyfills.
 * @implements {MediaKeyStatusMap}
 */
PatchedMediaKeysApple.MediaKeyStatusMap = class {
  constructor() {
    /* *
     * @type {number}
     */
    this.size = 0

    /* *
     * @private {string|undefined}
     */
    this.status_ = undefined
  }

  /* *
   * An internal method used by the session to set key status.
   * @param {string|undefined} status
   */
  setStatus(status) {
    this.size = status === undefined ? 0 : 1
    this.status_ = status
  }

  /* *
   * An internal method used by the session to get key status.
   * @return {string|undefined}
   */
  getStatus() {
    return this.status_
  }
  /* *
   * @suppress {missingReturn}
   * @override
   */
  entries() {
    console.assert(false, 'Not used!  Provided only for the compiler.')
  }

  /* *
   * @suppress {missingReturn}
   * @override
   */
  keys() {
    console.assert(false, 'Not used!  Provided only for the compiler.')
  }

  /* *
   * @suppress {missingReturn}
   * @override
   */
  values() {
    console.assert(false, 'Not used!  Provided only for the compiler.')
  }
}

polyfill.register(PatchedMediaKeysApple.install)
