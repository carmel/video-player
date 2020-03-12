import polyfill from './all'
import BufferUtils from '../util/buffer_utils'
import EventManager from '../util/event_manager'
import FakeEvent from '../util/FakeEvent'
import FakeEventTarget from '../util/fake_event_target'
import PublicPromise from '../util/public_promise'
import StringUtils from '../util/string_utils'
import Timer from '../util/timer'
import Uint8ArrayUtils from '../util/uint8array_utils'
/* *
 * @summary A polyfill to implement
 * {@link https://bit.ly/EmeMar15 EME draft 12 March 2015} on top of
 * webkit-prefixed {@link https://bit.ly/Eme01b EME v0.1b}.
 */
export default class PatchedMediaKeysWebkit {
  /* *
   * Installs the polyfill if needed.
   */
  static install() {
    // Alias.
    const PatchedMediaKeysWebkit = PatchedMediaKeysWebkit
    const prefixApi = PatchedMediaKeysWebkit.prefixApi_

    if (!HTMLVideoElement ||
        (navigator.requestMediaKeySystemAccess &&
         // eslint-disable-next-line no-restricted-syntax
         MediaKeySystemAccess.prototype.getConfiguration)) {
      return
    }
    // eslint-disable-next-line no-restricted-syntax
    if (HTMLMediaElement.prototype.webkitGenerateKeyRequest) {
      console.info('Using webkit-prefixed EME v0.1b')
      PatchedMediaKeysWebkit.prefix_ = 'webkit'
      // eslint-disable-next-line no-restricted-syntax
    } else if (HTMLMediaElement.prototype.generateKeyRequest) {
      console.info('Using nonprefixed EME v0.1b')
    } else {
      return
    }

    console.assert(
      // eslint-disable-next-line no-restricted-syntax
      HTMLMediaElement.prototype[prefixApi('generateKeyRequest')],
      'PatchedMediaKeysWebkit APIs not available!')

    // Install patches.
    navigator.requestMediaKeySystemAccess =
        PatchedMediaKeysWebkit.requestMediaKeySystemAccess
    // Delete mediaKeys to work around strict mode compatibility issues.
    // eslint-disable-next-line no-restricted-syntax
    delete HTMLMediaElement.prototype['mediaKeys']
    // Work around read-only declaration for mediaKeys by using a string.
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype['mediaKeys'] = null
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype.setMediaKeys = PatchedMediaKeysWebkit.setMediaKeys
    window.MediaKeys = PatchedMediaKeysWebkit.MediaKeys
    window.MediaKeySystemAccess = PatchedMediaKeysWebkit.MediaKeySystemAccess
  }

  /* *
   * Prefix the api with the stored prefix.
   *
   * @param {string} api
   * @return {string}
   * @private
   */
  static prefixApi_(api) {
    const prefix = PatchedMediaKeysWebkit.prefix_
    if (prefix) {
      return prefix + api.charAt(0).toUpperCase() + api.slice(1)
    }
    return api
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
    console.debug('PatchedMediaKeysWebkit.requestMediaKeySystemAccess')
    console.assert(this === navigator,
      'bad `this` for requestMediaKeySystemAccess')

    // Alias.
    const PatchedMediaKeysWebkit = PatchedMediaKeysWebkit
    try {
      const access = new PatchedMediaKeysWebkit.MediaKeySystemAccess(
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
    console.debug('PatchedMediaKeysWebkit.setMediaKeys')
    console.assert(this instanceof HTMLMediaElement,
      'bad `this` for setMediaKeys')

    // Alias.
    const PatchedMediaKeysWebkit = PatchedMediaKeysWebkit

    const newMediaKeys =
    /* * @type {PatchedMediaKeysWebkit.MediaKeys} */ (
        mediaKeys)
    const oldMediaKeys =
    /* * @type {PatchedMediaKeysWebkit.MediaKeys} */ (
        this.mediaKeys)

    if (oldMediaKeys && oldMediaKeys !== newMediaKeys) {
      console.assert(
        oldMediaKeys instanceof PatchedMediaKeysWebkit.MediaKeys,
        'non-polyfill instance of oldMediaKeys')
      // Have the old MediaKeys stop listening to events on the video tag.
      oldMediaKeys.setMedia(null)
    }

    delete this['mediaKeys'] // In case there is an existing getter.
    this['mediaKeys'] = mediaKeys // Work around the read-only declaration.

    if (newMediaKeys) {
      console.assert(
        newMediaKeys instanceof PatchedMediaKeysWebkit.MediaKeys,
        'non-polyfill instance of newMediaKeys')
      newMediaKeys.setMedia(this)
    }

    return Promise.resolve()
  }

  /* *
   * For some of this polyfill's implementation, we need to query a video
   * element.  But for some embedded systems, it is memory-expensive to create
   * multiple video elements.  Therefore, we check the document to see if we can
   * borrow one to query before we fall back to creating one temporarily.
   *
   * @return {!HTMLVideoElement}
   * @private
   */
  static getVideoElement_() {
    const videos = document.getElementsByTagName('video')
    const video = videos.length ? videos[0] : document.createElement('video')
    return /* * @type {!HTMLVideoElement} */(video)
  }
}
/* *
 * An implementation of MediaKeySystemAccess.
 *
 * @implements {MediaKeySystemAccess}
 */
PatchedMediaKeysWebkit.MediaKeySystemAccess = class {
  /* *
   * @param {string} keySystem
   * @param {!Array.<!MediaKeySystemConfiguration>} supportedConfigurations
   */
  constructor(keySystem, supportedConfigurations) {
    console.debug('PatchedMediaKeysWebkit.MediaKeySystemAccess')

    /* * @type {string} */
    this.keySystem = keySystem

    /* * @private {string} */
    this.internalKeySystem_ = keySystem

    /* * @private {!MediaKeySystemConfiguration} */
    this.configuration_

    // This is only a guess, since we don't really know from the prefixed API.
    let allowPersistentState = false

    if (keySystem === 'org.w3.clearkey') {
      // ClearKey's string must be prefixed in v0.1b.
      this.internalKeySystem_ = 'webkit-org.w3.clearkey'
      // ClearKey doesn't support persistence.
      allowPersistentState = false
    }

    let success = false
    const tmpVideo = PatchedMediaKeysWebkit.getVideoElement_()
    for (const cfg of supportedConfigurations) {
      // Create a new config object and start adding in the pieces which we
      // find support for.  We will return this from getConfiguration() if
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

      // v0.1b tests for key system availability with an extra argument on
      // canPlayType.
      let ranAnyTests = false
      if (cfg.audioCapabilities) {
        for (const cap of cfg.audioCapabilities) {
          if (cap.contentType) {
            ranAnyTests = true
            // In Chrome <= 40, if you ask about Widevine-encrypted audio
            // support, you get a false-negative when you specify codec
            // information. Work around this by stripping codec info for audio
            // types.
            const contentType = cap.contentType.split(';')[0]
            if (tmpVideo.canPlayType(contentType, this.internalKeySystem_)) {
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
            if (tmpVideo.canPlayType(
              cap.contentType, this.internalKeySystem_)) {
              newCfg.videoCapabilities.push(cap)
              success = true
            }
          }
        }
      }

      if (!ranAnyTests) {
        // If no specific types were requested, we check all common types to
        // find out if the key system is present at all.
        success =
            tmpVideo.canPlayType('video/mp4', this.internalKeySystem_) ||
            tmpVideo.canPlayType('video/webm', this.internalKeySystem_)
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

    let message = 'Unsupported keySystem'
    if (keySystem === 'org.w3.clearkey' || keySystem === 'com.widevine.alpha') {
      message = 'None of the requested configurations were supported.'
    }
    const unsupportedError = new Error(message)
    unsupportedError.name = 'NotSupportedError'
    unsupportedError.code = DOMException.NOT_SUPPORTED_ERR
    throw unsupportedError
  }

  /* * @override */
  createMediaKeys() {
    console.debug(
      'PatchedMediaKeysWebkit.MediaKeySystemAccess.createMediaKeys')

    // Alias.
    const PatchedMediaKeysWebkit = PatchedMediaKeysWebkit
    const mediaKeys =
    new PatchedMediaKeysWebkit.MediaKeys(this.internalKeySystem_)
    return Promise.resolve(/* * @type {!MediaKeys} */ (mediaKeys))
  }

  /* * @override */
  getConfiguration() {
    console.debug(
      'PatchedMediaKeysWebkit.MediaKeySystemAccess.getConfiguration')
    return this.configuration_
  }
}
/* *
 * An implementation of MediaKeys.
 *
 * @implements {MediaKeys}
 */
PatchedMediaKeysWebkit.MediaKeys = class {
  /* *
   * @param {string} keySystem
   */
  constructor(keySystem) {
    console.debug('PatchedMediaKeysWebkit.MediaKeys')

    /* * @private {string} */
    this.keySystem_ = keySystem

    /* * @private {HTMLMediaElement} */
    this.media_ = null

    /* * @private {!EventManager} */
    this.eventManager_ = new EventManager()

    /* *
     * @private {Array.<!PatchedMediaKeysWebkit.MediaKeySession>}
     */
    this.newSessions_ = []

    /* *
     * @private {!Map.<string,
     *                 !PatchedMediaKeysWebkit.MediaKeySession>}
     */
    this.sessionMap_ = new Map()
  }

  /* *
   * @param {HTMLMediaElement} media
   * @protected
   */
  setMedia(media) {
    this.media_ = media

    // Remove any old listeners.
    this.eventManager_.removeAll()

    const prefix = PatchedMediaKeysWebkit.prefix_
    if (media) {
      // Intercept and translate these prefixed EME events.
      this.eventManager_.listen(media, prefix + 'needkey',
      /* * @type {EventManager.ListenerType} */
        (event) => this.onWebkitNeedKey_(event))

      this.eventManager_.listen(media, prefix + 'keymessage',
      /* * @type {EventManager.ListenerType} */
        (event) => this.onWebkitKeyMessage_(event))

      this.eventManager_.listen(media, prefix + 'keyadded',
      /* * @type {EventManager.ListenerType} */
        (event) => this.onWebkitKeyAdded_(event))

      this.eventManager_.listen(media, prefix + 'keyerror',
      /* * @type {EventManager.ListenerType} */
        (event) => this.onWebkitKeyError_(event))
    }
  }

  /* * @override */
  createSession(sessionType) {
    console.debug('PatchedMediaKeysWebkit.MediaKeys.createSession')

    sessionType = sessionType || 'temporary'
    if (sessionType !== 'temporary' && sessionType !== 'persistent-license') {
      throw new TypeError('Session type ' + sessionType +
                      ' is unsupported on this platform.')
    }

    // Alias.
    const PatchedMediaKeysWebkit = PatchedMediaKeysWebkit

    // Unprefixed EME allows for session creation without a video tag or src.
    // Prefixed EME requires both a valid HTMLMediaElement and a src.
    const media = this.media_ || /* * @type {!HTMLMediaElement} */(
      document.createElement('video'))
    if (!media.src) {
      media.src = 'about:blank'
    }

    const session = new PatchedMediaKeysWebkit.MediaKeySession(
      media, this.keySystem_, sessionType)
    this.newSessions_.push(session)
    return session
  }

  /* * @override */
  setServerCertificate(serverCertificate) {
    console.debug('PatchedMediaKeysWebkit.MediaKeys.setServerCertificate')

    // There is no equivalent in v0.1b, so return failure.
    return Promise.resolve(false)
  }

  /* *
   * @param {!MediaKeyEvent} event
   * @private
   */
  onWebkitNeedKey_(event) {
    console.debug('PatchedMediaKeysWebkit.onWebkitNeedKey_', event)
    console.assert(this.media_, 'media_ not set in onWebkitNeedKey_')

    const event2 =
    /* * @type {!CustomEvent} */ (document.createEvent('CustomEvent'))
    event2.initCustomEvent('encrypted', false, false, null)

    // not used by v0.1b EME, but given a valid value
    event2.initDataType = 'webm'
    event2.initData = event.initData

    this.media_.dispatchEvent(event2)
  }

  /* *
   * @param {!MediaKeyEvent} event
   * @private
   */
  onWebkitKeyMessage_(event) {
    console.debug('PatchedMediaKeysWebkit.onWebkitKeyMessage_', event)

    const session = this.findSession_(event.sessionId)
    if (!session) {
      console.error('Session not found', event.sessionId)
      return
    }

    const isNew = session.keyStatuses.getStatus() === undefined

    const event2 = new FakeEvent('message', {
      messageType: isNew ? 'licenserequest' : 'licenserenewal',
      message: event.message
    })

    session.generated()
    session.dispatchEvent(event2)
  }

  /* *
   * @param {!MediaKeyEvent} event
   * @private
   */
  onWebkitKeyAdded_(event) {
    console.debug('PatchedMediaKeysWebkit.onWebkitKeyAdded_', event)

    const session = this.findSession_(event.sessionId)
    console.assert(
      session, 'unable to find session in onWebkitKeyAdded_')
    if (session) {
      session.ready()
    }
  }

  /* *
   * @param {!MediaKeyEvent} event
   * @private
   */
  onWebkitKeyError_(event) {
    console.debug('PatchedMediaKeysWebkit.onWebkitKeyError_', event)

    const session = this.findSession_(event.sessionId)
    console.assert(
      session, 'unable to find session in onWebkitKeyError_')
    if (session) {
      session.handleError(event)
    }
  }

  /* *
   * @param {string} sessionId
   * @return {PatchedMediaKeysWebkit.MediaKeySession}
   * @private
   */
  findSession_(sessionId) {
    let session = this.sessionMap_.get(sessionId)
    if (session) {
      console.debug(
        'PatchedMediaKeysWebkit.MediaKeys.findSession_', session)
      return session
    }

    session = this.newSessions_.shift()
    if (session) {
      session.sessionId = sessionId
      this.sessionMap_.set(sessionId, session)
      console.debug(
        'PatchedMediaKeysWebkit.MediaKeys.findSession_', session)
      return session
    }

    return null
  }
}
/* *
 * An implementation of MediaKeySession.
 *
 * @implements {MediaKeySession}
 */
PatchedMediaKeysWebkit.MediaKeySession =
    class extends FakeEventTarget {
      /* *
       * @param {!HTMLMediaElement} media
       * @param {string} keySystem
       * @param {string} sessionType
       */
      constructor(media, keySystem, sessionType) {
        console.debug('PatchedMediaKeysWebkit.MediaKeySession')
        super()

        /* * @private {!HTMLMediaElement} */
        this.media_ = media

        /* * @private {boolean} */
        this.initialized_ = false

        /* * @private {PublicPromise} */
        this.generatePromise_ = null

        /* * @private {PublicPromise} */
        this.updatePromise_ = null

        /* * @private {string} */
        this.keySystem_ = keySystem

        /* * @private {string} */
        this.type_ = sessionType

        /* * @type {string} */
        this.sessionId = ''

        /* * @type {number} */
        this.expiration = NaN

        /* * @type {!PublicPromise} */
        this.closed = new PublicPromise()

        /* * @type {!PatchedMediaKeysWebkit.MediaKeyStatusMap} */
        this.keyStatuses =
        new PatchedMediaKeysWebkit.MediaKeyStatusMap()
      }

      /* *
       * Signals that the license request has been generated.  This resolves the
       * 'generateRequest' promise.
       *
       * @protected
       */
      generated() {
        console.debug('PatchedMediaKeysWebkit.MediaKeySession.generated')

        if (this.generatePromise_) {
          this.generatePromise_.resolve()
          this.generatePromise_ = null
        }
      }

      /* *
       * Signals that the session is 'ready', which is the terminology used in
       * older versions of EME.  The new signal is to resolve the 'update'
       * promise.  This translates between the two.
       *
       * @protected
       */
      ready() {
        console.debug('PatchedMediaKeysWebkit.MediaKeySession.ready')

        this.updateKeyStatus_('usable')

        if (this.updatePromise_) {
          this.updatePromise_.resolve()
        }
        this.updatePromise_ = null
      }

      /* *
       * Either rejects a promise, or dispatches an error event, as appropriate.
       *
       * @param {!MediaKeyEvent} event
       */
      handleError(event) {
        console.debug(
          'PatchedMediaKeysWebkit.MediaKeySession.handleError', event)

        // This does not match the DOMException we get in current WD EME, but it
        // will at least provide some information which can be used to look into
        // the problem.
        const error = new Error('EME v0.1b key error')
        error.errorCode = event.errorCode
        error.errorCode.systemCode = event.systemCode

        // The presence or absence of sessionId indicates whether this
        // corresponds to generateRequest() or update().
        if (!event.sessionId && this.generatePromise_) {
          error.method = 'generateRequest'
          if (event.systemCode === 45) {
            error.message = 'Unsupported session type.'
          }
          this.generatePromise_.reject(error)
          this.generatePromise_ = null
        } else if (event.sessionId && this.updatePromise_) {
          error.method = 'update'
          this.updatePromise_.reject(error)
          this.updatePromise_ = null
        } else {
          // This mapping of key statuses is imperfect at best.
          const code = event.errorCode.code
          const systemCode = event.systemCode
          if (code === window.MediaKeyError['MEDIA_KEYERR_OUTPUT']) {
            this.updateKeyStatus_('output-restricted')
          } else if (systemCode === 1) {
            this.updateKeyStatus_('expired')
          } else {
            this.updateKeyStatus_('internal-error')
          }
        }
      }

      /* *
       * Logic which is shared between generateRequest() and load(), both of
       * which are ultimately implemented with webkitGenerateKeyRequest in
       * prefixed EME.
       *
       * @param {?BufferSource} initData
       * @param {?string} offlineSessionId
       * @return {!Promise}
       * @private
       */
      generate_(initData, offlineSessionId) {
        if (this.initialized_) {
          const error = new Error('The session is already initialized.')
          return Promise.reject(error)
        }

        this.initialized_ = true

        /* * @type {!Uint8Array} */
        let mangledInitData

        try {
          if (this.type_ === 'persistent-license') {
            if (!offlineSessionId) {
              console.assert(initData, 'expecting init data')
              // Persisting the initial license.
              // Prefix the init data with a tag to indicate persistence.
              const prefix = StringUtils.toUTF8('PERSISTENT|')
              mangledInitData =
                  Uint8ArrayUtils.concat(prefix, initData)
            } else {
              // Loading a stored license.
              // Prefix the init data (which is really a session ID) with a tag
              // to indicate that we are loading a persisted session.
              mangledInitData = BufferUtils.toUint8(
                StringUtils.toUTF8('LOAD_SESSION|' + offlineSessionId))
            }
          } else {
            // Streaming.
            console.assert(this.type_ === 'temporary',
              'expected temporary session')
            console.assert(!offlineSessionId,
              'unexpected offline session ID')
            console.assert(initData, 'expecting init data')
            mangledInitData = BufferUtils.toUint8(initData)
          }

          console.assert(mangledInitData, 'init data not set!')
        } catch (exception) {
          return Promise.reject(exception)
        }

        console.assert(this.generatePromise_ === null,
          'generatePromise_ should be null')
        this.generatePromise_ = new PublicPromise()

        // Because we are hacking media.src in createSession to better emulate
        // unprefixed EME's ability to create sessions and license requests
        // without a video tag, we can get ourselves into trouble.  It seems
        // that sometimes, the setting of media.src hasn't been processed by
        // some other thread, and GKR can throw an exception.  If this occurs,
        // wait 10 ms and try again at most once.  This situation should only
        // occur when init data is available ahead of the 'needkey' event.

        const prefixApi = PatchedMediaKeysWebkit.prefixApi_
        const generateKeyRequestName = prefixApi('generateKeyRequest')
        try {
          this.media_[generateKeyRequestName](this.keySystem_, mangledInitData)
        } catch (exception) {
          if (exception.name !== 'InvalidStateError') {
            this.generatePromise_ = null
            return Promise.reject(exception)
          }

          const timer = new Timer(() => {
            try {
              this.media_[generateKeyRequestName](
                this.keySystem_, mangledInitData)
            } catch (exception2) {
              this.generatePromise_.reject(exception2)
              this.generatePromise_ = null
            }
          })

          timer.tickAfter(/*  seconds= */ 0.01)
        }

        return this.generatePromise_
      }

      /* *
       * An internal version of update which defers new calls while old ones are
       * in progress.
       *
       * @param {!PublicPromise} promise  The promise associated with
       *   this call.
       * @param {BufferSource} response
       * @private
       */
      update_(promise, response) {
        if (this.updatePromise_) {
          // We already have an update in-progress, so defer this one until
          // after the old one is resolved.  Execute this whether the original
          // one succeeds or fails.
          this.updatePromise_.then(() => this.update_(promise, response))
            .catch(() => this.update_(promise, response))
          return
        }

        this.updatePromise_ = promise

        let key
        let keyId

        if (this.keySystem_ === 'webkit-org.w3.clearkey') {
          // The current EME version of clearkey wants a structured JSON
          // response. The v0.1b version wants just a raw key.  Parse the JSON
          // response and extract the key and key ID.
          const StringUtils = StringUtils
          const Uint8ArrayUtils = Uint8ArrayUtils
          const licenseString = StringUtils.fromUTF8(response)
          const jwkSet = /* * @type {JWKSet} */ (JSON.parse(licenseString))
          const kty = jwkSet.keys[0].kty
          if (kty !== 'oct') {
            // Reject the promise.
            this.updatePromise_.reject(new Error(
              'Response is not a valid JSON Web Key Set.'))
            this.updatePromise_ = null
          }
          key = Uint8ArrayUtils.fromBase64(jwkSet.keys[0].k)
          keyId = Uint8ArrayUtils.fromBase64(jwkSet.keys[0].kid)
        } else {
          // The key ID is not required.
          key = BufferUtils.toUint8(response)
          keyId = null
        }

        const prefixApi = PatchedMediaKeysWebkit.prefixApi_
        const addKeyName = prefixApi('addKey')
        try {
          this.media_[addKeyName](this.keySystem_, key, keyId, this.sessionId)
        } catch (exception) {
          // Reject the promise.
          this.updatePromise_.reject(exception)
          this.updatePromise_ = null
        }
      }

      /* *
       * Update key status and dispatch a 'keystatuseschange' event.
       *
       * @param {string} status
       * @private
       */
      updateKeyStatus_(status) {
        this.keyStatuses.setStatus(status)
        const event = new FakeEvent('keystatuseschange')
        this.dispatchEvent(event)
      }

      /* * @override */
      generateRequest(initDataType, initData) {
        console.debug(
          'PatchedMediaKeysWebkit.MediaKeySession.generateRequest')
        return this.generate_(initData, null)
      }

      /* * @override */
      load(sessionId) {
        console.debug('PatchedMediaKeysWebkit.MediaKeySession.load')
        if (this.type_ === 'persistent-license') {
          return this.generate_(null, sessionId)
        } else {
          return Promise.reject(new Error('Not a persistent session.'))
        }
      }

      /* * @override */
      update(response) {
        console.debug(
          'PatchedMediaKeysWebkit.MediaKeySession.update', response)
        console.assert(this.sessionId, 'update without session ID')

        const nextUpdatePromise = new PublicPromise()
        this.update_(nextUpdatePromise, response)
        return nextUpdatePromise
      }

      /* * @override */
      close() {
        console.debug('PatchedMediaKeysWebkit.MediaKeySession.close')

        // This will remove a persistent session, but it's also the only way to
        // free CDM resources on v0.1b.
        if (this.type_ !== 'persistent-license') {
          // sessionId may reasonably be null if no key request has been
          // generated yet.  Unprefixed EME will return a rejected promise in
          // this case.  We will use the same error message that Chrome 41 uses
          // in its EME implementation.
          if (!this.sessionId) {
            this.closed.reject(new Error('The session is not callable.'))
            return this.closed
          }

          // This may throw an exception, but we ignore it because we are only
          // using it to clean up resources in v0.1b.  We still consider the
          // session closed. We can't let the exception propagate because
          // MediaKeySession.close() should not throw.
          const prefixApi = PatchedMediaKeysWebkit.prefixApi_
          const cancelKeyRequestName = prefixApi('cancelKeyRequest')
          try {
            this.media_[cancelKeyRequestName](this.keySystem_, this.sessionId)
          } catch (exception) {
            console.log(exception)
          }
        }

        // Resolve the 'closed' promise and return it.
        this.closed.resolve()
        return this.closed
      }

      /* * @override */
      remove() {
        console.debug('PatchedMediaKeysWebkit.MediaKeySession.remove')

        if (this.type_ !== 'persistent-license') {
          return Promise.reject(new Error('Not a persistent session.'))
        }

        return this.close()
      }
    }
/* *
 * An implementation of MediaKeyStatusMap.
 * This fakes a map with a single key ID.
 *
 * @todo Consolidate the MediaKeyStatusMap types in these polyfills.
 * @implements {MediaKeyStatusMap}
 */
PatchedMediaKeysWebkit.MediaKeyStatusMap = class {
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
    console.assert(false, 'Not used!  Provided only for compiler.')
  }

  /* *
   * @suppress {missingReturn}
   * @override
   */
  keys() {
    console.assert(false, 'Not used!  Provided only for compiler.')
  }

  /* *
   * @suppress {missingReturn}
   * @override
   */
  values() {
    console.assert(false, 'Not used!  Provided only for compiler.')
  }
}
/* *
 * Store api prefix.
 *
 * @private {string}
 */
PatchedMediaKeysWebkit.prefix_ = ''
polyfill.register(PatchedMediaKeysWebkit.install)
