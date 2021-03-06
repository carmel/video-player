// import IReleasable from '../util/i_releasable'
import Timer from '../util/timer'

/* *
 * The play rate controller controls the playback rate on the media element.
 * This provides some missing functionality (e.g. negative playback rate). If
 * the playback rate on the media element can change outside of the controller,
 * the playback controller will need to be updated to stay in-sync.
 *
 * TODO: Try not to manage buffering above the browser with playbackRate=0.
 *
 * @implements {IReleasable}
 * @final
 */
export default class PlayRateController {
  /* *
   * @param {PlayRateController.Harness} harness
   */
  constructor(harness) {
    /* * @private {?PlayRateController.Harness} */
    this.harness_ = harness

    /* * @private {boolean} */
    this.isBuffering_ = false

    /* * @private {number} */
    this.rate_ = this.harness_.getRate()

    /* * @private {number} */
    this.pollRate_ = 0.25

    /* * @private {Timer} */
    this.timer_ = new Timer(() => {
      this.harness_.movePlayhead(this.rate_ * this.pollRate_)
    })
  }

  /* * @override */
  release() {
    if (this.timer_) {
      this.timer_.stop()
      this.timer_ = null
    }

    this.harness_ = null
  }

  /* *
   * Sets the buffering flag, which controls the effective playback rate.
   *
   * @param {boolean} isBuffering If true, forces playback rate to 0 internally.
   */
  setBuffering(isBuffering) {
    this.isBuffering_ = isBuffering
    this.apply_()
  }

  /* *
   * Set the playback rate. This rate will only be used as provided when the
   * player is not buffering. You should never set the rate to 0.
   *
   * @param {number} rate
   */
  set(rate) {
    console.assert(rate !== 0, 'Should never set rate of 0 explicitly!')
    this.rate_ = rate
    this.apply_()
  }

  /* *
   * Get the rate that the user will experience. This means that if we are using
   * trick play, this will report the trick play rate. If we are buffering, this
   * will report zero. If playback is occurring as normal, this will report 1.
   *
   * @return {number}
   */
  getActiveRate() {
    return this.calculateCurrentRate_()
  }
  /* *
   * Get the real rate of the playback. This means that if we are using trick
   * play, this will report the trick play rate. If playback is occurring as
   * normal, this will report 1.
   *
   * @return {number}
   */
  getRealRate() {
    return this.rate_
  }

  /* *
   * Reapply the effects of |this.rate_| and |this.active_| to the media
   * element. This will only update the rate via the harness if the desired rate
   * has changed.
   *
   * @private
   */
  apply_() {
    // Always stop the timer. We may not start it again.
    this.timer_.stop()

    /* * @type {number} */
    const rate = this.calculateCurrentRate_()

    console.info('Changing effective playback rate to', rate)

    if (rate >= 0) {
      try {
        this.applyRate_(rate)
        return
      } catch (e) {
        // Fall through to the next clause.
        //
        // Fast forward is accomplished through setting video.playbackRate.
        // If the play rate value is not supported by the browser (too big),
        // the browsers will throw.
        // Use this as a cue to fall back to fast forward through repeated
        // seeking, which is what we do for rewind as well.
      }
    }

    // When moving backwards or forwards in large steps,
    // set the playback rate to 0 so that we can manually
    // seek backwards with out fighting the playhead.
    this.timer_.tickEvery(this.pollRate_)
    this.applyRate_(0)
  }

  /* *
   * Calculate the rate that the controller wants the media element to have
   * based on the current state of the controller.
   *
   * @return {number}
   * @private
   */
  calculateCurrentRate_() {
    return this.isBuffering_ ? 0 : this.rate_
  }

  /* *
   * If the new rate is different than the media element's playback rate, this
   * will change the playback rate. If the rate does not need to change, it will
   * not be set. This will avoid unnecessary ratechange events.
   *
   * @param {number} newRate
   * @return {boolean}
   * @private
   */
  applyRate_(newRate) {
    const oldRate = this.harness_.getRate()

    if (oldRate !== newRate) {
      this.harness_.setRate(newRate)
    }

    return oldRate !== newRate
  }
}
/* *
 * @typedef {{
 *   getRate: function():number,
 *   setRate: function(number),
 *   movePlayhead: function(number)
 * }}
 *
 * @description
 *   A layer of abstraction between the controller and what it is controlling.
 *   In tests this will be implemented with spies. In production this will be
 *   implemented using a media element.
 *
 * @property {function():number} getRate
 *   Get the current playback rate being seen by the user.
 *
 * @property {function(number)} setRate
 *   Set the playback rate that the user should see.
 *
 * @property {function(number)} movePlayhead
 *   Move the playhead N seconds. If N is positive, the playhead will move
 *   forward abs(N) seconds. If N is negative, the playhead will move backwards
 *   abs(N) seconds.
 */
PlayRateController.Harness
