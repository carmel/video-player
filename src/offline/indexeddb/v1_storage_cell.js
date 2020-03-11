import BaseStorageCell from './base_storage_cell'
import Error from '../util.Error'
import ManifestParserUtils from '../../util/manifest_parser_utils'
import PublicPromise from '../../util/public_promise'

/* *
 * The V1StorageCell is for all stores that follow the shaka.externs V1 offline
 * types, introduced in Shaka Player v2.0 and deprecated in v2.3.
 *
 * @implements {shaka.extern.StorageCell}
 */
export default class V1StorageCell extends BaseStorageCell {
  /* * @override */
  async updateManifestExpiration(key, newExpiration) {
    const op = this.connection_.startReadWriteOperation(this.manifestStore_)

    /* * @type {IDBObjectStore} */
    const store = op.store()

    /* * @type {!PublicPromise} */
    const p = new PublicPromise()

    store.get(key).onsuccess = (event) => {
      // Make sure a defined value was found. Indexeddb treats 'no value found'
      // as a success with an undefined result.
      const manifest = /* * @type {shaka.extern.ManifestDBV1} */(
        event.target.result)

      // Indexeddb does not fail when you get a value that is not in the
      // database. It will return an undefined value. However, we expect
      // the value to never be null, so something is wrong if we get a
      // falsey value.
      if (manifest) {
        // Since this store's scheme uses in-line keys, we don't specify the key
        // with |put|.  This difference is why we must override the base class.
        console.assert(
          manifest.key === key,
          'With in-line keys, the keys should match')

        manifest.expiration = newExpiration
        store.put(manifest)

        p.resolve()
      } else {
        p.reject(new Error(
          Error.Severity.CRITICAL,
          Error.Category.STORAGE,
          Error.Code.KEY_NOT_FOUND,
          'Could not find values for ' + key))
      }
    }

    await Promise.all([op.promise(), p])
  }

  /* *
   * @override
   * @param {shaka.extern.ManifestDBV1} old
   * @return {shaka.extern.ManifestDB}
   */
  convertManifest(old) {
    const V1StorageCell = V1StorageCell

    return {
      originalManifestUri: old.originalManifestUri,
      duration: old.duration,
      size: old.size,
      expiration: old.expiration === null ? Infinity : old.expiration,
      periods: old.periods.map(V1StorageCell.convertPeriod_),
      sessionIds: old.sessionIds,
      drmInfo: old.drmInfo,
      appMetadata: old.appMetadata
    }
  }

  /* *
   * @param {shaka.extern.PeriodDBV1} old
   * @return {shaka.extern.PeriodDB}
   * @private
   */
  static convertPeriod_(old) {
    const V1StorageCell = V1StorageCell

    // In the case that this is really old (like really old, like dinosaurs
    // roaming the Earth old) there may be no variants, so we need to add those.
    V1StorageCell.fillMissingVariants_(old)

    for (const stream of old.streams) {
      const message = 'After filling in missing variants, ' +
                      'each stream should have variant ids'
      console.assert(stream.variantIds, message)
    }

    return {
      startTime: old.startTime,
      streams: old.streams.map(V1StorageCell.convertStream_)
    }
  }

  /* *
   * @param {shaka.extern.StreamDBV1} old
   * @return {shaka.extern.StreamDB}
   * @private
   */
  static convertStream_(old) {
    const V1StorageCell = V1StorageCell

    const initSegmentKey = old.initSegmentUri
      ? V1StorageCell.getKeyFromSegmentUri_(old.initSegmentUri) : null

    return {
      id: old.id,
      originalId: null,
      primary: old.primary,
      presentationTimeOffset: old.presentationTimeOffset,
      contentType: old.contentType,
      mimeType: old.mimeType,
      codecs: old.codecs,
      frameRate: old.frameRate,
      pixelAspectRatio: undefined,
      kind: old.kind,
      language: old.language,
      label: old.label,
      width: old.width,
      height: old.height,
      initSegmentKey: initSegmentKey,
      encrypted: old.encrypted,
      keyId: old.keyId,
      segments: old.segments.map(V1StorageCell.convertSegment_),
      variantIds: old.variantIds
    }
  }

  /* *
   * @param {shaka.extern.SegmentDBV1} old
   * @return {shaka.extern.SegmentDB}
   * @private
   */
  static convertSegment_(old) {
    const V1StorageCell = V1StorageCell

    // Since we don't want to use the uri anymore, we need to parse the key
    // from it.
    const dataKey = V1StorageCell.getKeyFromSegmentUri_(old.uri)

    return {
      startTime: old.startTime,
      endTime: old.endTime,
      dataKey: dataKey
    }
  }

  /* *
   * @override
   * @param {shaka.extern.SegmentDataDBV1} old
   * @return {shaka.extern.SegmentDataDB}
   */
  convertSegmentData(old) {
    return { data: old.data }
  }

  /* *
   * @param {string} uri
   * @return {number}
   * @private
   */
  static getKeyFromSegmentUri_(uri) {
    let parts = null

    // Try parsing the uri as the original Shaka Player 2.0 uri.
    parts = /^offline:[0-9]+\/[0-9]+\/([0-9]+)$/.exec(uri)
    if (parts) {
      return Number(parts[1])
    }

    // Just before Shaka Player 2.3 the uri format was changed to remove some
    // of the un-used information from the uri and make the segment uri and
    // manifest uri follow a similar format. However the old storage system
    // was still in place, so it is possible for Storage V1 Cells to have
    // Storage V2 uris.
    parts = /^offline:segment\/([0-9]+)$/.exec(uri)
    if (parts) {
      return Number(parts[1])
    }

    throw new Error(
      Error.Severity.CRITICAL,
      Error.Category.STORAGE,
      Error.Code.MALFORMED_OFFLINE_URI,
      'Could not parse uri ' + uri)
  }

  /* *
   * Take a period and check if the streams need to have variants generated.
   * Before Shaka Player moved to its variants model, there were no variants.
   * This will fill missing variants into the given object.
   *
   * @param {shaka.extern.PeriodDBV1} period
   * @private
   */
  static fillMissingVariants_(period) {
    const AUDIO = ManifestParserUtils.ContentType.AUDIO
    const VIDEO = ManifestParserUtils.ContentType.VIDEO

    // There are three cases:
    //  1. All streams' variant ids are null
    //  2. All streams' variant ids are non-null
    //  3. Some streams' variant ids are null and other are non-null
    // Case 3 is invalid and should never happen in production.

    const audio = period.streams.filter((s) => s.contentType === AUDIO)
    const video = period.streams.filter((s) => s.contentType === VIDEO)

    // Case 2 - There is nothing we need to do, so let's just get out of here.
    if (audio.every((s) => s.variantIds) && video.every((s) => s.variantIds)) {
      return
    }

    // Case 3... We don't want to be in case three.
    console.assert(
      audio.every((s) => !s.variantIds),
      'Some audio streams have variant ids and some do not.')
    console.assert(
      video.every((s) => !s.variantIds),
      'Some video streams have variant ids and some do not.')

    // Case 1 - Populate all the variant ids (putting us back to case 2).
    // Since all the variant ids are null, we need to first make them into
    // valid arrays.
    for (const s of audio) {
      s.variantIds = []
    }
    for (const s of video) {
      s.variantIds = []
    }

    let nextId = 0

    // It is not possible in Shaka Player's pre-variant world to have audio-only
    // and video-only content mixed in with audio-video content. So we can
    // assume that there is only audio-only or video-only if one group is empty.

    // Everything is video-only content - so each video stream gets to be its
    // own variant.
    if (video.length && !audio.length) {
      console.debug('Found video-only content. Creating variants for video.')
      const variantId = nextId++
      for (const s of video) {
        s.variantIds.push(variantId)
      }
    }

    // Everything is audio-only content - so each audio stream gets to be its
    // own variant.
    if (!video.length && audio.length) {
      console.debug('Found audio-only content. Creating variants for audio.')
      const variantId = nextId++
      for (const s of audio) {
        s.variantIds.push(variantId)
      }
    }

    // Everything is audio-video content.
    if (video.length && audio.length) {
      console.debug('Found audio-video content. Creating variants.')
      for (const a of audio) {
        for (const v of video) {
          const variantId = nextId++
          a.variantIds.push(variantId)
          v.variantIds.push(variantId)
        }
      }
    }
  }
}
