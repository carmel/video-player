import ManifestParser from '../media/manifest_parser'
import ManifestConverter from './manifest_converter'
import OfflineUri from './offline_uri'
import StorageMuxer from './storage_muxer'
import Error from '../util/error'

/* *
 * @summary Creates a new offline manifest parser.
 * @implements {shaka.extern.ManifestParser}
 */
export default class OfflineManifestParser {
  constructor() {
    /* * @private {OfflineUri} */
    this.uri_ = null
  }

  /* * @override */
  configure(config) {
    // No-op
  }

  /* * @override */
  async start(uriString, playerInterface) {
    /* * @type {OfflineUri} */
    const uri = OfflineUri.parse(uriString)
    this.uri_ = uri

    if (uri === null || !uri.isManifest()) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.NETWORK,
        Error.Code.MALFORMED_OFFLINE_URI,
        uriString)
    }

    /* * @type {!StorageMuxer} */
    const muxer = new StorageMuxer()

    try {
      await muxer.init()

      const cell = await muxer.getCell(uri.mechanism(), uri.cell())

      const manifests = await cell.getManifests([uri.key()])
      const manifest = manifests[0]

      const converter = new ManifestConverter(
        uri.mechanism(), uri.cell())

      return converter.fromManifestDB(manifest)
    } finally {
      await muxer.destroy()
    }
  }

  /* * @override */
  stop() {
    return Promise.resolve()
  }

  /* * @override */
  update() {
    // No-op
  }

  /* * @override */
  async onExpirationUpdated(sessionId, expiration) {
    console.assert(
      this.uri_,
      'Should not get update event before start has been called')

    /* * @type {!OfflineUri} */
    const uri = this.uri_

    /* * @type {!StorageMuxer} */
    const muxer = new StorageMuxer()

    try {
      await muxer.init()

      const cell = await muxer.getCell(uri.mechanism(), uri.cell())

      const manifests = await cell.getManifests([uri.key()])
      const manifest = manifests[0]

      const foundSession = manifest.sessionIds.includes(sessionId)
      const newExpiration = manifest.expiration === undefined ||
                        manifest.expiration > expiration

      if (foundSession && newExpiration) {
        console.debug('Updating expiration for stored content')
        await cell.updateManifestExpiration(uri.key(), expiration)
      }
    } catch (e) {
      // Ignore errors with update.
      console.error('There was an error updating', uri, e)
    } finally {
      await muxer.destroy()
    }
  }
}
ManifestParser.registerParserByMime(
  'application/x-offline-manifest',
  () => new OfflineManifestParser())
