import { NetworkingEngine } from '../net/networking_engine'
import OfflineUri from './offline_uri'
import StorageMuxer from './storage_muxer'
import AbortableOperation from '../util/abortable_operation'
import Error from '../util/error'

/* *
 * @summary A plugin that handles requests for offline content.
 * @export
 */
export default class OfflineScheme {
  /* *
   * @param {string} uri
   * @param {shaka.extern.Request} request
   * @param {NetworkingEngine.RequestType} requestType
   * @param {shaka.extern.ProgressUpdated} progressUpdated Called when a
   *   progress event happened.
   * @return {!shaka.extern.IAbortableOperation.<shaka.extern.Response>}
   * @export
   */
  static plugin(uri, request, requestType, progressUpdated) {
    const offlineUri = OfflineUri.parse(uri)

    if (offlineUri && offlineUri.isManifest()) {
      return OfflineScheme.getManifest_(uri)
    }

    if (offlineUri && offlineUri.isSegment()) {
      return OfflineScheme.getSegment_(
        offlineUri.key(), offlineUri)
    }

    return AbortableOperation.failed(
      new Error(
        Error.Severity.CRITICAL,
        Error.Category.NETWORK,
        Error.Code.MALFORMED_OFFLINE_URI,
        uri))
  }

  /* *
   * @param {string} uri
   * @return {!shaka.extern.IAbortableOperation.<shaka.extern.Response>}
   * @private
   */
  static getManifest_(uri) {
    /* * @type {shaka.extern.Response} */
    const response = {
      uri: uri,
      originalUri: uri,
      data: new ArrayBuffer(0),
      headers: { 'content-type': 'application/x-offline-manifest' }
    }

    return AbortableOperation.completed(response)
  }

  /* *
   * @param {number} id
   * @param {!OfflineUri} uri
   * @return {!shaka.extern.IAbortableOperation.<shaka.extern.Response>}
   * @private
   */
  static getSegment_(id, uri) {
    console.assert(
      uri.isSegment(),
      'Only segment uri\'s should be given to getSegment')

    /* * @type {!StorageMuxer} */
    const muxer = new StorageMuxer()

    return AbortableOperation.completed(undefined)
      .chain(() => muxer.init())
      .chain(() => muxer.getCell(uri.mechanism(), uri.cell()))
      .chain((cell) => cell.getSegments([uri.key()]))
      .chain((segments) => {
        const segment = segments[0]

        return {
          uri: uri,
          data: segment.data,
          headers: {}
        }
      })
      .finally(() => muxer.destroy())
  }
}

NetworkingEngine.registerScheme(
  'offline', OfflineScheme.plugin)
