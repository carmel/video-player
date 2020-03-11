import Iterables from '../util/iterables'
import StreamUtils from '../util/stream_utils'
import EwmaBandwidthEstimator from './ewma_bandwidth_estimator'
/**
 * @summary
 * <p>
 * This defines the default ABR manager for the Player.  An instance of this
 * class is used when no ABR manager is given.
 * </p>
 * <p>
 * The behavior of this class is to take throughput samples using
 * segmentDownloaded to estimate the current network bandwidth.  Then it will
 * use that to choose the streams that best fit the current bandwidth.  It will
 * always pick the highest bandwidth variant it thinks can be played.
 * </p>
 * <p>
 * After initial choices are made, this class will call switchCallback() when
 * there is a better choice.  switchCallback() will not be called more than once
 * per ({@link shaka.abr.SimpleAbrManager.SWITCH_INTERVAL_MS}).
 * </p>
 *
 * @implements {shaka.extern.AbrManager}
 * @export
 */
export default class SimpleAbrManager {
  constructor() {
    /** @private {?shaka.extern.AbrManager.SwitchCallback} */
    this.switch_ = null

    /** @private {boolean} */
    this.enabled_ = false

    /** @private {EwmaBandwidthEstimator} */
    this.bandwidthEstimator_ = new EwmaBandwidthEstimator()
    // TODO: Consider using NetworkInformation's change event to throw out an
    // old estimate based on changing network types, such as wifi => 3g.

    /**
     * A filtered list of Variants to choose from.
     * @private {!Array.<!shaka.extern.Variant>}
     */
    this.variants_ = []

    /** @private {number} */
    this.playbackRate_ = 1

    /** @private {boolean} */
    this.startupComplete_ = false

    /**
     * The last wall-clock time, in milliseconds, when streams were chosen.
     *
     * @private {?number}
     */
    this.lastTimeChosenMs_ = null

    /** @private {?shaka.extern.AbrConfiguration} */
    this.config_ = null
  }
  /**
   * @override
   * @export
   */
  stop() {
    this.switch_ = null
    this.enabled_ = false
    this.variants_ = []
    this.playbackRate_ = 1
    this.lastTimeChosenMs_ = null

    // Don't reset |startupComplete_|: if we've left the startup interval, we
    // can start using bandwidth estimates right away after init() is called.
  }
  /**
   * @override
   * @export
   */
  init(switchCallback) {
    this.switch_ = switchCallback
  }
  /**
   * @override
   * @export
   */
  chooseVariant() {
    const SimpleAbrManager = SimpleAbrManager

    // Get sorted Variants.
    let sortedVariants = SimpleAbrManager.filterAndSortVariants_(
      this.config_.restrictions, this.variants_)
    const currentBandwidth = this.bandwidthEstimator_.getBandwidthEstimate(
      this.config_.defaultBandwidthEstimate)

    if (this.variants_.length && !sortedVariants.length) {
      // If we couldn't meet the ABR restrictions, we should still play
      // something.
      // These restrictions are not 'hard' restrictions in the way that
      // top-level or DRM-based restrictions are.  Sort the variants without
      // restrictions and keep just the first (lowest-bandwidth) one.
      console.warning('No variants met the ABR restrictions. ' +
                        'Choosing a variant by lowest bandwidth.')
      sortedVariants = SimpleAbrManager.filterAndSortVariants_(
        /* restrictions= */ null, this.variants_)
      sortedVariants = [sortedVariants[0]]
    }

    // Start by assuming that we will use the first Stream.
    let chosen = sortedVariants[0] || null

    const enumerate = (it) => Iterables.enumerate(it)
    for (const { item, next } of enumerate(sortedVariants)) {
      const playbackRate =
          !isNaN(this.playbackRate_) ? Math.abs(this.playbackRate_) : 1
      const itemBandwidth = playbackRate * item.bandwidth
      const minBandwidth =
          itemBandwidth / this.config_.bandwidthDowngradeTarget
      const nextBandwidth =
          playbackRate * (next || { bandwidth: Infinity }).bandwidth
      const maxBandwidth = nextBandwidth / this.config_.bandwidthUpgradeTarget
      console.info('Bandwidth ranges:',
        (itemBandwidth / 1e6).toFixed(3),
        (minBandwidth / 1e6).toFixed(3),
        (maxBandwidth / 1e6).toFixed(3))

      if (currentBandwidth >= minBandwidth &&
          currentBandwidth <= maxBandwidth) {
        chosen = item
      }
    }

    this.lastTimeChosenMs_ = Date.now()
    return chosen
  }

  /**
   * @override
   * @export
   */
  enable() {
    this.enabled_ = true
  }
  /**
   * @override
   * @export
   */
  disable() {
    this.enabled_ = false
  }
  /**
   * @override
   * @export
   */
  segmentDownloaded(deltaTimeMs, numBytes) {
    console.info('Segment downloaded:',
      'deltaTimeMs=' + deltaTimeMs,
      'numBytes=' + numBytes,
      'lastTimeChosenMs=' + this.lastTimeChosenMs_,
      'enabled=' + this.enabled_)
    console.assert(deltaTimeMs >= 0, 'expected a non-negative duration')
    this.bandwidthEstimator_.sample(deltaTimeMs, numBytes)

    if ((this.lastTimeChosenMs_ != null) && this.enabled_) {
      this.suggestStreams_()
    }
  }
  /**
   * @override
   * @export
   */
  getBandwidthEstimate() {
    return this.bandwidthEstimator_.getBandwidthEstimate(
      this.config_.defaultBandwidthEstimate)
  }
  /**
   * @override
   * @export
   */
  setVariants(variants) {
    this.variants_ = variants
  }
  /**
   * @override
   * @export
   */
  playbackRateChanged(rate) {
    this.playbackRate_ = rate
  }
  /**
   * @override
   * @export
   */
  configure(config) {
    this.config_ = config
  }
  /**
   * Calls switch_() with the variant chosen by chooseVariant().
   *
   * @private
   */
  suggestStreams_() {
    console.info('Suggesting Streams...')
    console.assert(this.lastTimeChosenMs_ != null,
      'lastTimeChosenMs_ should not be null')

    if (!this.startupComplete_) {
      // Check if we've got enough data yet.
      if (!this.bandwidthEstimator_.hasGoodEstimate()) {
        console.info('Still waiting for a good estimate...')
        return
      }
      this.startupComplete_ = true
    } else {
      // Check if we've left the switch interval.
      const now = Date.now()
      const delta = now - this.lastTimeChosenMs_
      if (delta < this.config_.switchInterval * 1000) {
        console.info('Still within switch interval...')
        return
      }
    }

    const chosenVariant = this.chooseVariant()
    const bandwidthEstimate = this.bandwidthEstimator_.getBandwidthEstimate(
      this.config_.defaultBandwidthEstimate)
    const currentBandwidthKbps = Math.round(bandwidthEstimate / 1000.0)

    console.debug(
      'Calling switch_(), bandwidth=' + currentBandwidthKbps + ' kbps')
    // If any of these chosen streams are already chosen, Player will filter
    // them out before passing the choices on to StreamingEngine.
    this.switch_(chosenVariant)
  }
  /**
   * @param {?shaka.extern.Restrictions} restrictions
   * @param {!Array.<shaka.extern.Variant>} variants
   * @return {!Array.<shaka.extern.Variant>} variants filtered according to
   *   |restrictions| and sorted in ascending order of bandwidth.
   * @private
   */
  static filterAndSortVariants_(restrictions, variants) {
    if (restrictions) {
      variants = variants.filter((variant) => {
        // This was already checked in another scope, but the compiler doesn't
        // seem to understand that.
        console.assert(restrictions, 'Restrictions should exist!')

        return StreamUtils.meetsRestrictions(
          variant, restrictions,
          /* maxHwRes= */ { width: Infinity, height: Infinity })
      })
    }

    return variants.sort((v1, v2) => {
      return v1.bandwidth - v2.bandwidth
    })
  }
}
