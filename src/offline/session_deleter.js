import ArrayUtils from '../util/array_utils'
/* *
 * Contains a utility method to delete persistent EME sessions.
 */
export default class SessionDeleter {
  /* *
   * Collects the given sessions into buckets that can be done at the same time.
   * Since querying with different parameters can give us back different CDMs,
   * we can't just use one CDM instance to delete everything.
   *
   * @param {!Array.<shaka.extern.EmeSessionDB>} sessions
   * @return {!Array.<SessionDeleter.Bucket_>}
   * @private
   */
  static createBuckets_(sessions) {
    const SessionDeleter = SessionDeleter

    /* * @type {!Array.<SessionDeleter.Bucket_>} */
    const ret = []
    for (const session of sessions) {
      let found = false
      for (const bucket of ret) {
        if (SessionDeleter.isCompatible_(bucket.info, session)) {
          bucket.sessionIds.push(session.sessionId)
          found = true
          break
        }
      }
      if (!found) {
        ret.push({ info: session, sessionIds: [session.sessionId] })
      }
    }

    return ret
  }
  /* *
   * Returns whether the given session infos are compatible with each other.
   * @param {shaka.extern.EmeSessionDB} a
   * @param {shaka.extern.EmeSessionDB} b
   * @return {boolean}
   * @private
   */
  static isCompatible_(a, b) {
    // TODO: Add a way to change the license server in DrmEngine to avoid
    // resetting EME for different license servers.
    const comp = (x, y) =>
      x.robustness === y.robustness && x.contentType === y.contentType
    return a.keySystem === b.keySystem && a.licenseUri === b.licenseUri &&
        ArrayUtils.hasSameElements(
          a.audioCapabilities, b.audioCapabilities, comp) &&
        ArrayUtils.hasSameElements(
          a.videoCapabilities, b.videoCapabilities, comp)
  }
}
/* *
 * @typedef {{
 *   info: shaka.extern.EmeSessionDB,
 *   sessionIds: !Array.<string>
 * }}
 */
SessionDeleter.Bucket_
