import NetworkingEngine from '../net/networkingEngine'
import DownloadProgressEstimator from './download_progress_estimator'
import BufferUtils from '../util/buffer_utils'
import Destroyer from '../util/destroyer'
import Error from '../util/error'
// import IDestroyable from '../util/i_destroyable'
import Pssh from '../util/pssh'

/* *
 * This manages downloading segments.
 *
 * @implements {IDestroyable}
 * @final
 */
export default class DownloadManager {
  /* *
   * Create a new download manager. It will use (but not own) |networkingEngine|
   * and call |onProgress| after each download.
   *
   * @param {!NetworkingEngine} networkingEngine
   * @param {function(number, number)} onProgress
   * @param {function(!Uint8Array, string)} onInitData
   */
  constructor(networkingEngine, onProgress, onInitData) {
    /* * @private {NetworkingEngine} */
    this.networkingEngine_ = networkingEngine

    /* *
     * We group downloads. Within each group, the requests are executed in
     * series. Between groups, the requests are executed in parallel. We store
     * the promise chain that is doing the work.
     *
     * @private {!Map.<number, !Promise>}
     */
    this.groups_ = new Map()

    /* * @private {!Destroyer} */
    this.destroyer_ = new Destroyer(() => {
      const promises = Array.from(this.groups_.values())
      // Add a 'catch' block to stop errors from being returned.
      return Promise.all(promises.map((p) => p.catch(() => {})))
    })

    /* *
     * A callback for when a segment has been downloaded. The first parameter
     * is the progress of all segments, a number between 0.0 (0% complete) and
     * 1.0 (100% complete). The second parameter is the total number of bytes
     * that have been downloaded.
     *
     * @private {function(number, number)}
     */
    this.onProgress_ = onProgress

    /* *
     * A callback for when a segment has new PSSH data and we pass
     * on the initData to storage
     *
     * @private {function(!Uint8Array, string)}
     */
    this.onInitData_ = onInitData

    /* * @private {DownloadProgressEstimator} */
    this.estimator_ = new DownloadProgressEstimator()
  }

  /* * @override */
  destroy() {
    return this.destroyer_.destroy()
  }

  /* *
   * Add a request to be downloaded as part of a group.
   *
   * @param {number} groupId
   *    The group to add this segment to. If the group does not exist, a new
   *    group will be created.
   * @param {shaka.extern.Request} request
   * @param {number} estimatedByteLength
   * @param {boolean} isInitSegment
   * @param {function(BufferSource):!Promise} onDownloaded
   *   The callback for when this request has been downloaded. Downloading for
   *   |group| will pause until the promise returned by |onDownloaded| resolves.
   */
  queue(groupId, request, estimatedByteLength, isInitSegment, onDownloaded) {
    this.destroyer_.ensureNotDestroyed()

    const id = this.estimator_.open(estimatedByteLength)

    const group = this.groups_.get(groupId) || Promise.resolve()

    // Add another download to the group.
    this.groups_.set(groupId, group.then(async() => {
      const response = await this.fetchSegment_(request)

      // Make sure we stop downloading if we have been destroyed.
      if (this.destroyer_.destroyed()) {
        throw new Error(
          Error.Severity.CRITICAL,
          Error.Category.STORAGE,
          Error.Code.OPERATION_ABORTED)
      }

      // Update initData
      if (isInitSegment) {
        const segmentBytes = BufferUtils.toUint8(response)
        const pssh = new Pssh(segmentBytes)
        for (const key in pssh.data) {
          const index = Number(key)
          const data = pssh.data[index]
          const systemId = pssh.systemIds[index]
          this.onInitData_(data, systemId)
        }
      }

      // Update all our internal stats.
      this.estimator_.close(id, response.byteLength)
      this.onProgress_(
        this.estimator_.getEstimatedProgress(),
        this.estimator_.getTotalDownloaded())

      return onDownloaded(response)
    }))
  }

  /* *
   * Get a promise that will resolve when all currently queued downloads have
   * finished.
   *
   * @return {!Promise.<number>}
   */
  async waitToFinish() {
    await Promise.all(this.groups_.values())
    return this.estimator_.getTotalDownloaded()
  }

  /* *
   * Download a segment and return the data in the response.
   *
   * @param {shaka.extern.Request} request
   * @return {!Promise.<BufferSource>}
   * @private
   */
  async fetchSegment_(request) {
    const type = NetworkingEngine.RequestType.SEGMENT
    const action = this.networkingEngine_.request(type, request)
    const response = await action.promise
    return response.data
  }
}
