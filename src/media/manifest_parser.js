import Uri from '../util/uri'
import { NetworkingEngine } from '../net/networking_engine'
import Error from '../util/error'
import Platform from '../util/platform'

/* *
 * @summary An interface to register manifest parsers.
 * @exportDoc
 */
export default class ManifestParser {
  /* *
   * Registers a manifest parser by file extension.
   *
   * @param {string} extension The file extension of the manifest.
   * @param {shaka.extern.ManifestParser.Factory} parserFactory The factory
   *   used to create parser instances.
   * @export
   */
  static registerParserByExtension(extension, parserFactory) {
    ManifestParser.parsersByExtension[extension] = parserFactory
  }

  /* *
   * Registers a manifest parser by MIME type.
   *
   * @param {string} mimeType The MIME type of the manifest.
   * @param {shaka.extern.ManifestParser.Factory} parserFactory The factory
   *   used to create parser instances.
   * @export
   */
  static registerParserByMime(mimeType, parserFactory) {
    ManifestParser.parsersByMime[mimeType] = parserFactory
  }

  /* *
   * Unregisters a manifest parser by MIME type.
   *
   * @param {string} mimeType The MIME type of the manifest.
   * @export
   */
  static unregisterParserByMime(mimeType) {
    delete ManifestParser.parsersByMime[mimeType]
  }
  /* *
   * Returns a map of manifest support for well-known types.
   *
   * @return {!Object.<string, boolean>}
   */
  static probeSupport() {
    const ManifestParser = ManifestParser
    const support = {}

    // Make sure all registered parsers are shown, but only for MSE-enabled
    // platforms where our parsers matter.
    if (Platform.supportsMediaSource()) {
      for (const type in ManifestParser.parsersByMime) {
        support[type] = true
      }
      for (const type in ManifestParser.parsersByExtension) {
        support[type] = true
      }
    }

    // Make sure all well-known types are tested as well, just to show an
    // explicit false for things people might be expecting.
    const testMimeTypes = [
      // DASH
      'application/dash+xml',
      // HLS
      'application/x-mpegurl',
      'application/vnd.apple.mpegurl',
      // SmoothStreaming
      'application/vnd.ms-sstr+xml'
    ]
    const testExtensions = {
      // DASH
      'mpd': 'application/dash+xml',
      // HLS
      'm3u8': 'application/x-mpegurl',
      // SmoothStreaming
      'ism': 'application/vnd.ms-sstr+xml'
    }

    for (const type of testMimeTypes) {
      // Only query our parsers for MSE-enabled platforms.  Otherwise, query a
      // temporary media element for native support for these types.
      if (Platform.supportsMediaSource()) {
        support[type] = !!ManifestParser.parsersByMime[type]
      } else {
        support[type] = Platform.supportsMediaType(type)
      }
    }

    for (const extension in testExtensions) {
      // Only query our parsers for MSE-enabled platforms.  Otherwise, query a
      // temporary media element for native support for these MIME type for the
      // extension.
      if (Platform.supportsMediaSource()) {
        support[extension] = !!ManifestParser.parsersByExtension[extension]
      } else {
        const type = testExtensions[extension]
        support[extension] = Platform.supportsMediaType(type)
      }
    }

    return support
  }
  /* *
   * Get a factory that can create a manifest parser that should be able to
   * parse the manifest at |uri|.
   *
   * @param {string} uri
   * @param {!NetworkingEngine} netEngine
   * @param {shaka.extern.RetryParameters} retryParams
   * @param {?string} mimeType
   * @return {!Promise.<shaka.extern.ManifestParser.Factory>}
   */
  static async getFactory(uri, netEngine, retryParams, mimeType) {
    const ManifestParser = ManifestParser

    // Try using the MIME type we were given.
    if (mimeType) {
      const factory = ManifestParser.parsersByMime[mimeType.toLowerCase()]
      if (factory) {
        return factory
      }

      console.warning(
        'Could not determine manifest type using MIME type ', mimeType)
    }

    const extension = ManifestParser.getExtension(uri)
    if (extension) {
      const factory = ManifestParser.parsersByExtension[extension]
      if (factory) {
        return factory
      }

      console.warning(
        'Could not determine manifest type for extension ', extension)
    } else {
      console.warning('Could not find extension for ', uri)
    }

    if (!mimeType) {
      mimeType = await ManifestParser.getMimeType(uri, netEngine, retryParams)

      if (mimeType) {
        const factory = ManifestParser.parsersByMime[mimeType]
        if (factory) {
          return factory
        }

        console.warning('Could not determine manifest type using MIME type',
          mimeType)
      }
    }

    throw new Error(
      Error.Severity.CRITICAL,
      Error.Category.MANIFEST,
      Error.Code.UNABLE_TO_GUESS_MANIFEST_TYPE,
      uri)
  }
  /* *
   * @param {string} uri
   * @param {!NetworkingEngine} netEngine
   * @param {shaka.extern.RetryParameters} retryParams
   * @return {!Promise.<string>}
   */
  static async getMimeType(uri, netEngine, retryParams) {
    const type = NetworkingEngine.RequestType.MANIFEST

    const request = NetworkingEngine.makeRequest([uri], retryParams)
    request.method = 'HEAD'

    const response = await netEngine.request(type, request).promise

    // https://bit.ly/2K9s9kf says this header should always be available,
    // but just to be safe:
    const mimeType = response.headers['content-type']
    return mimeType ? mimeType.toLowerCase().split(';').shift() : ''
  }
  /* *
   * @param {string} uri
   * @return {string}
   */
  static getExtension(uri) {
    const uriObj = new Uri(uri)
    const uriPieces = uriObj.getPath().split('/')
    const uriFilename = uriPieces.pop()
    const filenamePieces = uriFilename.split('.')

    // Only one piece means there is no extension.
    if (filenamePieces.length === 1) {
      return ''
    }

    return filenamePieces.pop().toLowerCase()
  }
  /* *
   * Determines whether or not this URI and MIME type are supported by our own
   * manifest parsers on this platform.  This takes into account whether or not
   * MediaSource is available, as well as which parsers are registered to the
   * system.
   *
   * @param {string} uri
   * @param {string} mimeType
   * @return {boolean}
   */
  static isSupported(uri, mimeType) {
    // Without MediaSource, our own parsers are useless.
    if (!Platform.supportsMediaSource()) {
      return false
    }

    if (mimeType in ManifestParser.parsersByMime) {
      return true
    }

    const extension = ManifestParser.getExtension(uri)
    if (extension in ManifestParser.parsersByExtension) {
      return true
    }

    return false
  }
}
/* *
 * Contains the parser factory functions indexed by MIME type.
 *
 * @type {!Object.<string, shaka.extern.ManifestParser.Factory>}
 */
ManifestParser.parsersByMime = {}
/* *
 * Contains the parser factory functions indexed by file extension.
 *
 * @type {!Object.<string, shaka.extern.ManifestParser.Factory>}
 */
ManifestParser.parsersByExtension = {}
