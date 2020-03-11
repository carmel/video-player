import PresentationTimeline from '../media/presentation_timeline'
import ManifestConverter from './manifest_converter'
// import OfflineUri from './offline_uri'
import StreamUtils from '../util/stream_utils'

/* *
 * A utility class used to create |shaka.extern.StoredContent| from different
 * types of input.
 */
export default class StoredContentUtils {
  /* *
   * @param {string} originalUri
   * @param {shaka.extern.Manifest} manifest
   * @param {number} size
   * @param {!Object} metadata
   * @return {shaka.extern.StoredContent}
   */
  static fromManifest(originalUri, manifest, size, metadata) {
    console.assert(
      manifest.periods.length,
      'Cannot create stored content from manifest with no periods.')

    /* * @type {number} */
    const expiration = manifest.expiration === undefined
      ? Infinity
      : manifest.expiration

    /* * @type {number} */
    const duration = manifest.presentationTimeline.getDuration()

    /* * @type {shaka.extern.Period} */
    const firstPeriod = manifest.periods[0]

    /* * @type {!Array.<shaka.extern.Track>} */
    const tracks = StoredContentUtils.getTracks_(firstPeriod)

    /* * @type {shaka.extern.StoredContent} */
    const content = {
      offlineUri: null,
      originalManifestUri: originalUri,
      duration: duration,
      size: size,
      expiration: expiration,
      tracks: tracks,
      appMetadata: metadata
    }

    return content
  }
  /* *
   * @param {!OfflineUri} offlineUri
   * @param {shaka.extern.ManifestDB} manifestDB
   * @return {shaka.extern.StoredContent}
   */
  static fromManifestDB(offlineUri, manifestDB) {
    console.assert(
      manifestDB.periods.length,
      'Cannot create stored content from manifestDB with no periods.')

    const converter = new ManifestConverter(
      offlineUri.mechanism(), offlineUri.cell())

    /* * @type {shaka.extern.PeriodDB} */
    const firstPeriodDB = manifestDB.periods[0]
    /* * @type {!PresentationTimeline} */
    const timeline = new PresentationTimeline(null, 0)

    // Getting the period duration would be a bit of a pain, and for the
    // purposes of getting the metadata below, we don't need a real period
    // duration.
    const fakePeriodDuration = 1

    /* * @type {shaka.extern.Period} */
    const firstPeriod = converter.fromPeriodDB(
      firstPeriodDB, fakePeriodDuration, timeline)

    /* * @type {!Object} */
    const metadata = manifestDB.appMetadata || {}

    /* * @type {!Array.<shaka.extern.Track>} */
    const tracks = StoredContentUtils.getTracks_(firstPeriod)

    /* * @type {shaka.extern.StoredContent} */
    const content = {
      offlineUri: offlineUri.toString(),
      originalManifestUri: manifestDB.originalManifestUri,
      duration: manifestDB.duration,
      size: manifestDB.size,
      expiration: manifestDB.expiration,
      tracks: tracks,
      appMetadata: metadata
    }

    return content
  }
  /* *
   * Gets track representations of all playable variants and all text streams.
   *
   * @param {shaka.extern.Period} period
   * @return {!Array.<shaka.extern.Track>}
   * @private
   */
  static getTracks_(period) {
    const tracks = []

    const variants = StreamUtils.getPlayableVariants(period.variants)
    for (const variant of variants) {
      tracks.push(StreamUtils.variantToTrack(variant))
    }

    const textStreams = period.textStreams
    for (const stream of textStreams) {
      tracks.push(StreamUtils.textStreamToTrack(stream))
    }

    return tracks
  }
}
