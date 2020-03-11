import DrmEngine from '../media/drm_engine'
import polyfill from './all'
import BufferUtils from '../util/buffer_utils'
import EventManager from '../util/event_manager'
import FakeEvent from '../util/fake_event'
import FakeEventTarget from '../util/fake_event_target'
import Pssh from '../util/pssh'
import PublicPromise from '../util/public_promise'

/**
 * @summary A polyfill to implement
 * {@link https://bit.ly/EmeMar15 EME draft 12 March 2015}
 * on top of ms-prefixed
 * {@link https://www.w3.org/TR/2014/WD-encrypted-media-20140218/ EME v20140218}
 */
export default class PatchedMediaKeysMs {
  /**
   * Installs the polyfill if needed.
   */
  static install() {
    if (!window.HTMLVideoElement || !window.MSMediaKeys ||
        (navigator.requestMediaKeySystemAccess &&
         // eslint-disable-next-line no-restricted-syntax
         MediaKeySystemAccess.prototype.getConfiguration)) {
      return
    }
    console.info('Using ms-prefixed EME v20140218')

    // Alias
    const PatchedMediaKeysMs = PatchedMediaKeysMs

    // Delete mediaKeys to work around strict mode compatibility issues.
    // eslint-disable-next-line no-restricted-syntax
    delete HTMLMediaElement.prototype['mediaKeys']
    // Work around read-only declaration for mediaKeys by using a string.
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype['mediaKeys'] = null

    // Install patches
    window.MediaKeys = PatchedMediaKeysMs.MediaKeys
    window.MediaKeySystemAccess = PatchedMediaKeysMs.MediaKeySystemAccess
    navigator.requestMediaKeySystemAccess =
        PatchedMediaKeysMs.requestMediaKeySystemAccess
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype.setMediaKeys =
        PatchedMediaKeysMs.MediaKeySystemAccess.setMediaKeys
  }

  /**
   * An implementation of navigator.requestMediaKeySystemAccess.
   * Retrieves a MediaKeySystemAccess object.
   *
   * @this {!Navigator}
   * @param {string} keySystem
   * @param {!Array.<!MediaKeySystemConfiguration>} supportedConfigurations
   * @return {!Promise.<!MediaKeySystemAccess>}
   */
  static requestMediaKeySystemAccess(keySystem, supportedConfigurations) {
    console.debug('PatchedMediaKeysMs.requestMediaKeySystemAccess')
    console.assert(this === navigator,
      'bad "this" for requestMediaKeySystemAccess')

    // Alias.
    const PatchedMediaKeysMs = PatchedMediaKeysMs
    try {
      const access = new PatchedMediaKeysMs.MediaKeySystemAccess(
        keySystem, supportedConfigurations)
      return Promise.resolve(/** @type {!MediaKeySystemAccess} */ (access))
    } catch (exception) {
      return Promise.reject(exception)
    }
  }

  /**
   * Handler for the native media elements msNeedKey event.
   *
   * @this {!HTMLMediaElement}
   * @param {!MediaKeyEvent} event
   * @private
   */
  static onMsNeedKey_(event) {
    console.debug('PatchedMediaKeysMs.onMsNeedKey_', event)
    if (!event.initData) {
      return
    }

    // NOTE: Because "this" is a real EventTarget, on IE, the event we dispatch
    // here must also be a real Event.
    const event2 =
    /** @type {!CustomEvent} */ (document.createEvent('CustomEvent'))
    event2.initCustomEvent('encrypted', false, false, null)
    event2.initDataType = 'cenc'
    event2.initData = Pssh.normaliseInitData(event.initData)

    this.dispatchEvent(event2)
  }
}
/**
 * An implementation of MediaKeySystemAccess.
 *
 * @implements {MediaKeySystemAccess}
 */
PatchedMediaKeysMs.MediaKeySystemAccess = class {
  /**
   * @param {string} keySystem
   * @param {!Array.<!MediaKeySystemConfiguration>} supportedConfigurations
   */
  constructor(keySystem, supportedConfigurations) {
    console.debug('PatchedMediaKeysMs.MediaKeySystemAccess')

    /** @type {string} */
    this.keySystem = keySystem

    /** @private {!MediaKeySystemConfiguration} */
    this.configuration_

    const allowPersistentState = false

    let success = false
    for (const cfg of supportedConfigurations) {
      // Create a new config object and start adding in the pieces which we
      // find support for.  We will return this from getConfiguration() if
      // asked.
      /** @type {!MediaKeySystemConfiguration} */
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

      // PatchedMediaKeysMs tests for key system availability through
      // MSMediaKeys.isTypeSupported
      let ranAnyTests = false
      if (cfg.audioCapabilities) {
        for (const cap of cfg.audioCapabilities) {
          if (cap.contentType) {
            ranAnyTests = true
            const contentType = cap.contentType.split(';')[0]
            if (window.MSMediaKeys.isTypeSupported(this.keySystem, contentType)) {
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
            if (window.MSMediaKeys.isTypeSupported(this.keySystem, contentType)) {
              newCfg.videoCapabilities.push(cap)
              success = true
            }
          }
        }
      }

      if (!ranAnyTests) {
        // If no specific types were requested, we check all common types to
        // find out if the key system is present at all.
        success = window.MSMediaKeys.isTypeSupported(this.keySystem, 'video/mp4')
      }
      if (cfg.persistentState === 'required') {
        if (allowPersistentState) {
          newCfg.persistentState = 'required'
          newCfg.sessionTypes = ['persistent-license']
        } else {
          success = false
        }
      }

      if (success) {
        this.configuration_ = newCfg
        return
      }
    } // for each cfg in supportedConfigurations

    // As per the spec, this should be a DOMException, but there is not a
    // public constructor for this.
    const unsupportedKeySystemError = new Error('Unsupported keySystem')
    unsupportedKeySystemError.name = 'NotSupportedError'
    unsupportedKeySystemError.code = DOMException.NOT_SUPPORTED_ERR
    throw unsupportedKeySystemError
  }

  /** @override */
  createMediaKeys() {
    console.debug(
      'PatchedMediaKeysMs.MediaKeySystemAccess.createMediaKeys')

    // Alias
    const PatchedMediaKeysMs = PatchedMediaKeysMs

    const mediaKeys = new PatchedMediaKeysMs.MediaKeys(this.keySystem)
    return Promise.resolve(/** @type {!MediaKeys} */ (mediaKeys))
  }

  /** @override */
  getConfiguration() {
    console.debug(
      'PatchedMediaKeysMs.MediaKeySystemAccess.getConfiguration')
    return this.configuration_
  }

  /**
   * An implementation of HTMLMediaElement.prototype.setMediaKeys.
   * Attaches a MediaKeys object to the media element.
   *
   * @this {!HTMLMediaElement}
   * @param {MediaKeys} mediaKeys
   * @return {!Promise}
   */
  static setMediaKeys(mediaKeys) {
    console.debug('PatchedMediaKeysMs.setMediaKeys')
    console.assert(this instanceof HTMLMediaElement,
      'bad "this" for setMediaKeys')

    // Alias
    const PatchedMediaKeysMs = PatchedMediaKeysMs

    const newMediaKeys =
    /** @type {PatchedMediaKeysMs.MediaKeys} */ (
        mediaKeys)
    const oldMediaKeys =
    /** @type {PatchedMediaKeysMs.MediaKeys} */ (
        this.mediaKeys)

    if (oldMediaKeys && oldMediaKeys !== newMediaKeys) {
      console.assert(oldMediaKeys instanceof PatchedMediaKeysMs.MediaKeys,
        'non-polyfill instance of oldMediaKeys')
      // Have the old MediaKeys stop listening to events on the video tag.
      oldMediaKeys.setMedia(null)
    }

    delete this['mediaKeys'] // in case there is an existing getter
    this['mediaKeys'] = mediaKeys // work around read-only declaration

    if (newMediaKeys) {
      console.assert(newMediaKeys instanceof PatchedMediaKeysMs.MediaKeys,
        'non-polyfill instance of newMediaKeys')
      return newMediaKeys.setMedia(this)
    }

    return Promise.resolve()
  }
}
/**
 * An implementation of MediaKeys.
 *
 * @implements {MediaKeys}
 */
PatchedMediaKeysMs.MediaKeys = class {
  /** @param {string} keySystem */
  constructor(keySystem) {
    console.debug('PatchedMediaKeysMs.MediaKeys')

    /** @private {!MSMediaKeys} */
    this.nativeMediaKeys_ = new window.MSMediaKeys(keySystem)

    /** @private {!EventManager} */
    this.eventManager_ = new EventManager()
  }

  /** @override */
  createSession(sessionType) {
    console.debug('PatchedMediaKeysMs.MediaKeys.createSession')

    sessionType = sessionType || 'temporary'
    // For now, only the 'temporary' type is supported.
    if (sessionType !== 'temporary') {
      throw new TypeError('Session type ' + sessionType +
      ' is unsupported on this platform.')
    }

    // Alias
    const PatchedMediaKeysMs = PatchedMediaKeysMs

    return new PatchedMediaKeysMs.MediaKeySession(
      this.nativeMediaKeys_, sessionType)
  }

  /** @override */
  setServerCertificate(serverCertificate) {
    console.debug('PatchedMediaKeysMs.MediaKeys.setServerCertificate')

    // There is no equivalent in PatchedMediaKeysMs, so return failure.
    return Promise.resolve(false)
  }

  /**
   * @param {HTMLMediaElement} media
   * @protected
   * @return {!Promise}
   */
  setMedia(media) {
    // Alias
    const PatchedMediaKeysMs = PatchedMediaKeysMs

    // Remove any old listeners.
    this.eventManager_.removeAll()

    // It is valid for media to be null; null is used to flag that event
    // handlers need to be cleaned up.
    if (!media) {
      return Promise.resolve()
    }

    // Intercept and translate these prefixed EME events.
    this.eventManager_.listen(media, 'msneedkey',
    /** @type {EventManager.ListenerType} */
      (PatchedMediaKeysMs.onMsNeedKey_))

    const self = this
    const setMediaKeysDeferred = () => {
      media.msSetMediaKeys(self.nativeMediaKeys_)
      media.removeEventListener('loadedmetadata', setMediaKeysDeferred)
    }

    // Wrap native HTMLMediaElement.msSetMediaKeys with a Promise.
    try {
      // IE11/Edge requires that readyState >=1 before mediaKeys can be set,
      // so check this and wait for loadedmetadata if we are not in the
      // correct state
      if (media.readyState >= 1) {
        media.msSetMediaKeys(this.nativeMediaKeys_)
      } else {
        media.addEventListener('loadedmetadata', setMediaKeysDeferred)
      }

      return Promise.resolve()
    } catch (exception) {
      return Promise.reject(exception)
    }
  }
}
/**
 * An implementation of MediaKeySession.
 *
 * @implements {MediaKeySession}
 */
PatchedMediaKeysMs.MediaKeySession =
    class extends FakeEventTarget {
      /**
       * @param {MSMediaKeys} nativeMediaKeys
       * @param {string} sessionType
       */
      constructor(nativeMediaKeys, sessionType) {
        console.debug('PatchedMediaKeysMs.MediaKeySession')
        super()

        // The native MediaKeySession, which will be created in
        // generateRequest.
        /** @private {MSMediaKeySession} */
        this.nativeMediaKeySession_ = null

        /** @private {MSMediaKeys} */
        this.nativeMediaKeys_ = nativeMediaKeys

        // Promises that are resolved later
        /** @private {PublicPromise} */
        this.generateRequestPromise_ = null

        /** @private {PublicPromise} */
        this.updatePromise_ = null

        /** @private {!EventManager} */
        this.eventManager_ = new EventManager()

        /** @type {string} */
        this.sessionId = ''

        /** @type {number} */
        this.expiration = NaN

        /** @type {!PublicPromise} */
        this.closed = new PublicPromise()

        /** @type {!PatchedMediaKeysMs.MediaKeyStatusMap} */
        this.keyStatuses =
        new PatchedMediaKeysMs.MediaKeyStatusMap()
      }

      /** @override */
      generateRequest(initDataType, initData) {
        console.debug('PatchedMediaKeysMs.MediaKeySession.generateRequest')

        this.generateRequestPromise_ = new PublicPromise()

        try {
          // This EME spec version requires a MIME content type as the 1st param
          // to createSession, but doesn't seem to matter what the value is.

          // NOTE: IE11 takes either Uint8Array or ArrayBuffer, but Edge 12 only
          // accepts Uint8Array.
          this.nativeMediaKeySession_ = this.nativeMediaKeys_.createSession(
            'video/mp4', BufferUtils.toUint8(initData), null)

          // Attach session event handlers here.
          this.eventManager_.listen(this.nativeMediaKeySession_, 'mskeymessage',
          /** @type {EventManager.ListenerType} */
            (event) => this.onMsKeyMessage_(event))
          this.eventManager_.listen(this.nativeMediaKeySession_, 'mskeyadded',
          /** @type {EventManager.ListenerType} */
            (event) => this.onMsKeyAdded_(event))
          this.eventManager_.listen(this.nativeMediaKeySession_, 'mskeyerror',
          /** @type {EventManager.ListenerType} */
            (event) => this.onMsKeyError_(event))

          this.updateKeyStatus_('status-pending')
        } catch (exception) {
          this.generateRequestPromise_.reject(exception)
        }

        return this.generateRequestPromise_
      }

      /** @override */
      load() {
        console.debug('PatchedMediaKeysMs.MediaKeySession.load')

        return Promise.reject(
          new Error('MediaKeySession.load not yet supported'))
      }

      /** @override */
      update(response) {
        console.debug('PatchedMediaKeysMs.MediaKeySession.update')

        this.updatePromise_ = new PublicPromise()

        try {
          // Pass through to the native session.
          // NOTE: IE11 takes either Uint8Array or ArrayBuffer, but Edge 12 only
          // accepts Uint8Array.
          this.nativeMediaKeySession_.update(
            BufferUtils.toUint8(response))
        } catch (exception) {
          this.updatePromise_.reject(exception)
        }

        return this.updatePromise_
      }

      /** @override */
      close() {
        console.debug('PatchedMediaKeysMs.MediaKeySession.close')

        try {
          // Pass through to the native session.
          // NOTE: IE seems to have a spec discrepancy here - v2010218 should
          // have MediaKeySession.release, but actually uses 'close'. The next
          // version of the spec is the initial Promise based one, so it's not
          // the target spec either.
          this.nativeMediaKeySession_.close()

          this.closed.resolve()
          this.eventManager_.removeAll()
        } catch (exception) {
          this.closed.reject(exception)
        }

        return this.closed
      }

      /** @override */
      remove() {
        console.debug('PatchedMediaKeysMs.MediaKeySession.remove')

        return Promise.reject(new Error('MediaKeySession.remove is only ' +
        'applicable for persistent licenses, which are not supported on ' +
        'this platform'))
      }

      /**
       * Handler for the native keymessage event on MSMediaKeySession.
       *
       * @param {!MediaKeyEvent} event
       * @private
       */
      onMsKeyMessage_(event) {
        console.debug('PatchedMediaKeysMs.onMsKeyMessage_', event)

        // We can now resolve this.generateRequestPromise, which should be
        // non-null.
        console.assert(this.generateRequestPromise_,
          'generateRequestPromise_ not set in onMsKeyMessage_')
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

      /**
       * Handler for the native keyadded event on MSMediaKeySession.
       *
       * @param {!MediaKeyEvent} event
       * @private
       */
      onMsKeyAdded_(event) {
        console.debug('PatchedMediaKeysMs.onMsKeyAdded_', event)

        // PlayReady's concept of persistent licenses makes emulation difficult
        // here. A license policy can say that the license persists, which
        // causes the CDM to store it for use in a later session.  The result
        // is that in IE11, the CDM fires 'mskeyadded' without ever firing
        // 'mskeymessage'.
        if (this.generateRequestPromise_) {
          console.debug('Simulating completion for a PR persistent license.')
          console.assert(!this.updatePromise_, 'updatePromise_ and ' +
              'generateRequestPromise_ set in onMsKeyAdded_')
          this.updateKeyStatus_('usable')
          this.generateRequestPromise_.resolve()
          this.generateRequestPromise_ = null
          return
        }

        // We can now resolve this.updatePromise, which should be non-null.
        console.assert(this.updatePromise_,
          'updatePromise_ not set in onMsKeyAdded_')
        if (this.updatePromise_) {
          this.updateKeyStatus_('usable')
          this.updatePromise_.resolve()
          this.updatePromise_ = null
        }
      }

      /**
       * Handler for the native keyerror event on MSMediaKeySession.
       *
       * @param {!MediaKeyEvent} event
       * @private
       */
      onMsKeyError_(event) {
        console.debug('PatchedMediaKeysMs.onMsKeyError_', event)

        const error = new Error('EME PatchedMediaKeysMs key error')
        error.errorCode = this.nativeMediaKeySession_.error

        if (this.generateRequestPromise_ != null) {
          this.generateRequestPromise_.reject(error)
          this.generateRequestPromise_ = null
        } else if (this.updatePromise_ != null) {
          this.updatePromise_.reject(error)
          this.updatePromise_ = null
        } else {
          // Unexpected error - map native codes to standardised key statuses.
          // Possible values of this.nativeMediaKeySession_.error.code:
          // MS_MEDIA_KEYERR_UNKNOWN        = 1
          // MS_MEDIA_KEYERR_CLIENT         = 2
          // MS_MEDIA_KEYERR_SERVICE        = 3
          // MS_MEDIA_KEYERR_OUTPUT         = 4
          // MS_MEDIA_KEYERR_HARDWARECHANGE = 5
          // MS_MEDIA_KEYERR_DOMAIN         = 6

          switch (this.nativeMediaKeySession_.error.code) {
            case window.MSMediaKeyError.MS_MEDIA_KEYERR_OUTPUT:
            case window.MSMediaKeyError.MS_MEDIA_KEYERR_HARDWARECHANGE:
              this.updateKeyStatus_('output-not-allowed')
              break
            default:
              this.updateKeyStatus_('internal-error')
              break
          }
        }
      }

      /**
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
/**
 * @summary An implementation of MediaKeyStatusMap.
 * This fakes a map with a single key ID.
 *
 * @todo Consolidate the MediaKeyStatusMap types in these polyfills.
 * @implements {MediaKeyStatusMap}
 */
PatchedMediaKeysMs.MediaKeyStatusMap = class {
  constructor() {
    /**
     * @type {number}
     */
    this.size = 0

    /**
     * @private {string|undefined}
     */
    this.status_ = undefined
  }

  /**
   * An internal method used by the session to set key status.
   * @param {string|undefined} status
   */
  setStatus(status) {
    this.size = status === undefined ? 0 : 1
    this.status_ = status
  }

  /**
   * An internal method used by the session to get key status.
   * @return {string|undefined}
   */
  getStatus() {
    return this.status_
  }

  /** @override */
  forEach(fn) {
    if (this.status_) {
      fn(this.status_, DrmEngine.DUMMY_KEY_ID.value())
    }
  }

  /** @override */
  get(keyId) {
    if (this.has(keyId)) {
      return this.status_
    }
    return undefined
  }

  /** @override */
  has(keyId) {
    const fakeKeyId = DrmEngine.DUMMY_KEY_ID.value()
    if (this.status_ && BufferUtils.equal(keyId, fakeKeyId)) {
      return true
    }
    return false
  }

  /**
   * @suppress {missingReturn}
   * @override
   */
  entries() {
    console.assert(false, 'Not used!  Provided only for the compiler.')
  }

  /**
   * @suppress {missingReturn}
   * @override
   */
  keys() {
    console.assert(false, 'Not used!  Provided only for the compiler.')
  }

  /**
   * @suppress {missingReturn}
   * @override
   */
  values() {
    console.assert(false, 'Not used!  Provided only for the compiler.')
  }
}
polyfill.register(PatchedMediaKeysMs.install)
