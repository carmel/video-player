// import IPlayheadObserver from './playhead_observer'
import Periods from '../util/periods'

/* *
 * The period observer keeps track of which period we are in and calls the
 * |onPeriodChange| callback whenever we change periods.
 *
 * @implements {IPlayheadObserver}
 * @final
 */
export default class PeriodObserver {
  /* *
   * The period observer needs an always-up-to-date collection of periods,
   * and right now the only way to have that is to reference the manifest.
   *
   * @param {shaka.extern.Manifest} manifest
   */
  constructor(manifest) {
    /* * @private {?shaka.extern.Manifest} */
    this.manifest_ = manifest

    /* *
     * This will be which period we think the playhead is currently in. If it is
     * |null|, it means we don't know. We say 'we think' because this may become
     * out-of-date between updates.
     *
     * @private {?shaka.extern.Period}
     */
    this.currentPeriod_ = null

    /* *
     * The callback for when we change periods. To avoid null-checks, assign it
     * a no-op when there is no external callback assigned to it. When we move
     * into a new period, this callback will be called with the new period.
     *
     * @private {function(shaka.extern.Period)}
     */
    this.onChangedPeriods_ = (period) => {}
  }

  /* * @override */
  release() {
    // Break all internal references.
    this.manifest_ = null
    this.currentPeriod_ = null
    this.onChangedPeriods_ = (period) => {}
  }

  /* * @override */
  poll(positionInSeconds, wasSeeking) {
    // We detect changes in period by comparing where we think we are against
    // where we actually are.
    const expectedPeriod = this.currentPeriod_
    const actualPeriod = this.findCurrentPeriod_(positionInSeconds)
    if (expectedPeriod !== actualPeriod) {
      this.onChangedPeriods_(actualPeriod)
    }
    // Make sure we are up-to-date.
    this.currentPeriod_ = actualPeriod
  }

  /* *
   * Set all callbacks. This will override any previous calls to |setListeners|.
   *
   * @param {function(shaka.extern.Period)} onChangedPeriods
   *    The callback for when we move to a new period.
   */
  setListeners(onChangedPeriods) {
    this.onChangedPeriods_ = onChangedPeriods
  }

  /* *
   * Find which period we are most likely in based on the current manifest and
   * current time. The value here may be different than |this.currentPeriod_|,
   * if that is true, it means we changed periods since the last time we updated
   * |this.currentPeriod_|.
   *
   * @param {number} currentTimeSeconds
   * @return {shaka.extern.Period}
   * @private
   */
  findCurrentPeriod_(currentTimeSeconds) {
    const periods = this.manifest_.periods

    const found = Periods.findPeriodForTime(
      periods,
      currentTimeSeconds)

    // Fallback to periods[0] so that it can never be null. If we join a live
    // stream, periods[0].startTime may be non-zero. We can't guarantee that
    // video.currentTime will always be inside the seek range so it may be
    // possible to call findCurrentPeriod_(beforeFirstPeriod).
    return found || periods[0]
  }
}
