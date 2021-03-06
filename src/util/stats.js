import StateHistory from './state_history'
import SwitchHistory from './switch_history'

/* *
 * This class tracks all the various components (some optional) that are used to
 * populate |shaka.extern.Stats| which is passed to the app.
 *
 * @final
 */
export default class Stats {
  constructor() {
    /* * @private {number} */
    this.width_ = NaN
    /* * @private {number} */
    this.height_ = NaN

    /* * @private {number} */
    this.totalDroppedFrames_ = NaN
    /* * @private {number} */
    this.totalDecodedFrames_ = NaN
    /* * @private {number} */
    this.totalCorruptedFrames_ = NaN

    /* * @private {number} */
    this.loadLatencySeconds_ = NaN

    /* * @private {number} */
    this.manifestTimeSeconds_ = NaN

    /* * @private {number} */
    this.licenseTimeSeconds_ = NaN

    /* * @private {number} */
    this.currentStreamBandwidth_ = NaN
    /* * @private {number} */
    this.bandwidthEstimate_ = NaN

    /* * @private {!StateHistory} */
    this.stateHistory_ = new StateHistory()

    /* * @private {!SwitchHistory} */
    this.switchHistory_ = new SwitchHistory()
  }

  /* *
   * Update the ratio of dropped frames to total frames. This will replace the
   * previous values.
   *
   * @param {number} dropped
   * @param {number} decoded
   */
  setDroppedFrames(dropped, decoded) {
    this.totalDroppedFrames_ = dropped
    this.totalDecodedFrames_ = decoded
  }
  /* *
   * Update corrupted frames. This will replace the previous values.
   *
   * @param {number} corrupted
   */
  setCorruptedFrames(corrupted) {
    this.totalCorruptedFrames_ = corrupted
  }

  /* *
   * Set the width and height of the video we are currently playing.
   *
   * @param {number} width
   * @param {number} height
   */
  setResolution(width, height) {
    this.width_ = width
    this.height_ = height
  }

  /* *
   * Record the time it took between the user signalling 'I want to play this'
   * to 'I am now seeing this'.
   *
   * @param {number} seconds
   */
  setLoadLatency(seconds) {
    this.loadLatencySeconds_ = seconds
  }

  /* *
   * Record the time it took to download and parse the manifest.
   *
   * @param {number} seconds
   */
  setManifestTime(seconds) {
    this.manifestTimeSeconds_ = seconds
  }

  /* *
   * Record the cumulative time spent on license requests during this session.
   *
   * @param {number} seconds
   */
  setLicenseTime(seconds) {
    this.licenseTimeSeconds_ = seconds
  }

  /* *
   * @param {number} bandwidth
   */
  setCurrentStreamBandwidth(bandwidth) {
    this.currentStreamBandwidth_ = bandwidth
  }

  /* *
   * @param {number} bandwidth
   */
  setBandwidthEstimate(bandwidth) {
    this.bandwidthEstimate_ = bandwidth
  }

  /* *
   * @return {!StateHistory}
   */
  getStateHistory() {
    return this.stateHistory_
  }

  /* *
   * @return {!SwitchHistory}
   */
  getSwitchHistory() {
    return this.switchHistory_
  }

  /* *
   * Create a stats blob that we can pass up to the app. This blob will not
   * reference any internal data.
   *
   * @return {shaka.extern.Stats}
   */
  getBlob() {
    return {
      width: this.width_,
      height: this.height_,
      streamBandwidth: this.currentStreamBandwidth_,
      decodedFrames: this.totalDecodedFrames_,
      droppedFrames: this.totalDroppedFrames_,
      corruptedFrames: this.totalCorruptedFrames_,
      estimatedBandwidth: this.bandwidthEstimate_,
      loadLatency: this.loadLatencySeconds_,
      manifestTimeSeconds: this.manifestTimeSeconds_,
      playTime: this.stateHistory_.getTimeSpentIn('playing'),
      pauseTime: this.stateHistory_.getTimeSpentIn('paused'),
      bufferingTime: this.stateHistory_.getTimeSpentIn('buffering'),
      licenseTime: this.licenseTimeSeconds_,
      stateHistory: this.stateHistory_.getCopy(),
      switchHistory: this.switchHistory_.getCopy()
    }
  }

  /* *
   * Create an empty stats blob. This resembles the stats when we are not
   * playing any content.
   *
   * @return {shaka.extern.Stats}
   */
  static getEmptyBlob() {
    return {
      width: NaN,
      height: NaN,
      streamBandwidth: NaN,
      decodedFrames: NaN,
      droppedFrames: NaN,
      corruptedFrames: NaN,
      estimatedBandwidth: NaN,
      loadLatency: NaN,
      manifestTimeSeconds: NaN,
      playTime: NaN,
      pauseTime: NaN,
      bufferingTime: NaN,
      licenseTime: NaN,
      switchHistory: [],
      stateHistory: []
    }
  }
}
