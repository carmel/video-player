import Uri from './uri'
import Functional from './functional'

/* *
 * @summary Utility functions for manifest parsing.
 */
export default class ManifestParserUtils {
  /* *
   * Resolves an array of relative URIs to the given base URIs. This will result
   * in M*N number of URIs.
   *
   * @param {!Array.<string>} baseUris
   * @param {!Array.<string>} relativeUris
   * @return {!Array.<string>}
   */
  static resolveUris(baseUris, relativeUris) {
    if (relativeUris.length === 0) {
      return baseUris
    }

    const relativeAsGoog = relativeUris.map((uri) => new Uri(uri))
    // Resolve each URI relative to each base URI, creating an Array of Arrays.
    // Then flatten the Arrays into a single Array.
    return baseUris.map((uri) => new Uri(uri))
      .map((base) => relativeAsGoog.map((i) => base.resolve(i)))
      .reduce(Functional.collapseArrays, [])
      .map((uri) => uri.toString())
  }
}
/* *
 * @enum {string}
 */
ManifestParserUtils.ContentType = {
  VIDEO: 'video',
  AUDIO: 'audio',
  TEXT: 'text',
  IMAGE: 'image',
  APPLICATION: 'application'
}
/* *
 * @enum {string}
 */
ManifestParserUtils.TextStreamKind = {
  SUBTITLE: 'subtitle',
  CLOSED_CAPTION: 'caption'
}
/* *
 * Specifies how tolerant the player is of inaccurate segment start times and
 * end times within a manifest. For example, gaps or overlaps between segments
 * in a SegmentTimeline which are greater than or equal to this value will
 * result in a warning message.
 *
 * @const {number}
 */
ManifestParserUtils.GAP_OVERLAP_TOLERANCE_SECONDS = 1 / 15
