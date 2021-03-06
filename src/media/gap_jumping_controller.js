// import StallDetector from './stall_detector'
import TimeRangesUtils from './time_ranges_utils'
import EventManager from '../util/event_manager'
import FakeEvent from '../util/fake_event'
// import IReleasable from '../util/i_releasable'
import Timer from '../util/timer'

/* *
 * GapJumpingController handles jumping gaps that appear within the content.
 * This will only jump gaps between two buffered ranges, so we should not have
 * to worry about the availability
 *
 * @implements {IReleasable}
 */
export default class GapJumpingController {
  /* *
   * @param {!HTMLMediaElement} video
   * @param {!PresentationTimeline} timeline
   * @param {shaka.extern.StreamingConfiguration} config
   * @param {StallDetector} stallDetector
   *   The stall detector is used to keep the playhead moving while in a
   *   playable region. The gap jumping controller takes ownership over the
   *   stall detector.
   *   If no stall detection logic is desired, |null| may be provided.
   * @param {function(!Event)} onEvent Called when an event is raised to be sent
   *   to the application.
   */
  constructor(video, timeline, config, stallDetector, onEvent) {
    /* * @private {HTMLMediaElement} */
    this.video_ = video

    /* * @private {?PresentationTimeline} */
    this.timeline_ = timeline

    /* * @private {?shaka.extern.StreamingConfiguration} */
    this.config_ = config

    /* * @private {?function(!Event)} */
    this.onEvent_ = onEvent

    /* * @private {EventManager} */
    this.eventManager_ = new EventManager()

    /* * @private {boolean} */
    this.seekingEventReceived_ = false

    /* * @private {number} */
    this.prevReadyState_ = video.readyState

    /* * @private {boolean} */
    this.didFireLargeGap_ = false

    /* *
     * The stall detector tries to keep the playhead moving forward. It is
     * managed by the gap-jumping controller to avoid conflicts. On some
     * platforms, the stall detector is not wanted, so it may be null.
     *
     * @private {StallDetector}
     */
    this.stallDetector_ = stallDetector

    /* * @private {boolean} */
    this.hadSegmentAppended_ = false

    this.eventManager_.listen(video, 'waiting', () => this.onPollGapJump_())

    /* *
     * We can't trust |readyState| or 'waiting' events on all platforms. To make
     * up for this, we poll the current time. If we think we are in a gap, jump
     * out of it.
     *
     * See: https://bit.ly/2McuXxm and https://bit.ly/2K5xmJO
     *
     * @private {?Timer}
     */
    this.gapJumpTimer_ = new Timer(() => {
      this.onPollGapJump_()
    }).tickEvery(/*  seconds= */ 0.25)
  }
  /* * @override */
  release() {
    if (this.eventManager_) {
      this.eventManager_.release()
      this.eventManager_ = null
    }

    if (this.gapJumpTimer_ !== null) {
      this.gapJumpTimer_.stop()
      this.gapJumpTimer_ = null
    }

    if (this.stallDetector_) {
      this.stallDetector_.release()
      this.stallDetector_ = null
    }

    this.onEvent_ = null
    this.timeline_ = null
    this.video_ = null
  }
  /* *
   * Called when a segment is appended by StreamingEngine, but not when a clear
   * is pending. This means StreamingEngine will continue buffering forward from
   * what is buffered.  So we know about any gaps before the start.
   */
  onSegmentAppended() {
    this.hadSegmentAppended_ = true
    this.onPollGapJump_()
  }
  /* * Called when a seek has started. */
  onSeeking() {
    this.seekingEventReceived_ = true
    this.hadSegmentAppended_ = false
    this.didFireLargeGap_ = false
  }
  /* *
   * Called on a recurring timer to check for gaps in the media.  This is also
   * called in a 'waiting' event.
   *
   * @private
   */
  onPollGapJump_() {
    // Don't gap jump before the video is ready to play.
    if (this.video_.readyState === 0) {
      return
    }
    // Do not gap jump if seeking has begun, but the seeking event has not
    // yet fired for this particular seek.
    if (this.video_.seeking) {
      if (!this.seekingEventReceived_) {
        return
      }
    } else {
      this.seekingEventReceived_ = false
    }
    // Don't gap jump while paused, so that you don't constantly jump ahead
    // while paused on a livestream.
    if (this.video_.paused) {
      return
    }
    // When the ready state changes, we have moved on, so we should fire the
    // large gap event if we see one.
    if (this.video_.readyState !== this.prevReadyState_) {
      this.didFireLargeGap_ = false
      this.prevReadyState_ = this.video_.readyState
    }

    const smallGapLimit = this.config_.smallGapLimit
    const currentTime = this.video_.currentTime
    const buffered = this.video_.buffered

    const gapIndex =
        TimeRangesUtils.getGapIndex(buffered, currentTime)

    // The current time is unbuffered or is too far from a gap.
    if (gapIndex === null) {
      if (this.stallDetector_) {
        this.stallDetector_.poll()
      }

      return
    }

    // If we are before the first buffered range, this could be an unbuffered
    // seek.  So wait until a segment is appended so we are sure it is a gap.
    if (gapIndex === 0 && !this.hadSegmentAppended_) {
      return
    }

    // StreamingEngine can buffer past the seek end, but still don't allow
    // seeking past it.
    const jumpTo = buffered.start(gapIndex)
    const seekEnd = this.timeline_.getSeekRangeEnd()
    if (jumpTo >= seekEnd) {
      return
    }

    const jumpSize = jumpTo - currentTime
    const isGapSmall = jumpSize <= smallGapLimit
    let jumpLargeGap = false

    // If we jump to exactly the gap start, we may detect a small gap due to
    // rounding errors or browser bugs.  We can ignore these extremely small
    // gaps since the browser should play through them for us.
    if (jumpSize < GapJumpingController.BROWSER_GAP_TOLERANCE) {
      return
    }

    if (!isGapSmall && !this.didFireLargeGap_) {
      this.didFireLargeGap_ = true

      // Event firing is synchronous.
      const event = new FakeEvent(
        'largegap', { 'currentTime': currentTime, 'gapSize': jumpSize })
      event.cancelable = true
      this.onEvent_(event)

      if (this.config_.jumpLargeGaps && !event.defaultPrevented) {
        jumpLargeGap = true
      } else {
        console.info('Ignoring large gap at', currentTime, 'size', jumpSize)
      }
    }

    if (isGapSmall || jumpLargeGap) {
      if (gapIndex === 0) {
        console.info(
          'Jumping forward', jumpSize,
          'seconds because of gap before start time of', jumpTo)
      } else {
        console.info(
          'Jumping forward', jumpSize, 'seconds because of gap starting at',
          buffered.end(gapIndex - 1), 'and ending at', jumpTo)
      }

      this.video_.currentTime = jumpTo
    }
  }
}
/* *
 * The limit, in seconds, for the gap size that we will assume the browser will
 * handle for us.
 * @const
 */
GapJumpingController.BROWSER_GAP_TOLERANCE = 0.001

