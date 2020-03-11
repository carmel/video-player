import polyfill from './all'

/**
 * @summary A polyfill to stub out
 * {@link https://bit.ly/EmeMar15 EME draft 12 March 2015} on browsers without
 * EME.
 * All methods will fail.
 */
export default class PatchedMediaKeysNop {
  /**
   * Installs the polyfill if needed.
   */
  static install() {
    if (!window.HTMLVideoElement ||
        (navigator.requestMediaKeySystemAccess &&
         // eslint-disable-next-line no-restricted-syntax
         MediaKeySystemAccess.prototype.getConfiguration)) {
      return
    }
    console.info('EME not available.')

    // Alias.
    const PatchedMediaKeysNop = PatchedMediaKeysNop

    // Install patches.
    navigator.requestMediaKeySystemAccess =
        PatchedMediaKeysNop.requestMediaKeySystemAccess
    // Delete mediaKeys to work around strict mode compatibility issues.
    // eslint-disable-next-line no-restricted-syntax
    delete HTMLMediaElement.prototype['mediaKeys']
    // Work around read-only declaration for mediaKeys by using a string.
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype['mediaKeys'] = null
    // eslint-disable-next-line no-restricted-syntax
    HTMLMediaElement.prototype.setMediaKeys = PatchedMediaKeysNop.setMediaKeys
    // These are not usable, but allow Player.isBrowserSupported to pass.
    window.MediaKeys = PatchedMediaKeysNop.MediaKeys
    window.MediaKeySystemAccess = PatchedMediaKeysNop.MediaKeySystemAccess
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
    console.debug('PatchedMediaKeysNop.requestMediaKeySystemAccess')
    console.assert(this === navigator,
      'bad "this" for requestMediaKeySystemAccess')

    return Promise.reject(new Error(
      'The key system specified is not supported.'))
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
    console.debug('PatchedMediaKeysNop.setMediaKeys')
    console.assert(this instanceof HTMLMediaElement,
      'bad "this" for setMediaKeys')

    if (mediaKeys == null) {
      return Promise.resolve()
    }

    return Promise.reject(new Error('MediaKeys not supported.'))
  }
}
/**
 * An unusable constructor for MediaKeys.
 * @implements {MediaKeys}
 */
PatchedMediaKeysNop.MediaKeys = class {
  constructor() {
    throw new TypeError('Illegal constructor.')
  }

  /** @override */
  createSession() {}

  /** @override */
  setServerCertificate() {}
}
/**
 * An unusable constructor for MediaKeySystemAccess.
 * @implements {MediaKeySystemAccess}
 */
PatchedMediaKeysNop.MediaKeySystemAccess = class {
  constructor() {
    /** @override */
    this.keySystem = '' // For the compiler.

    throw new TypeError('Illegal constructor.')
  }

  /** @override */
  getConfiguration() {}

  /** @override */
  createMediaKeys() {}
}

// A low priority ensures this is the last and acts as a fallback.
polyfill.register(PatchedMediaKeysNop.install, -10)
