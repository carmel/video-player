import BufferUtils from '../util/buffer_utils'
import { CaptionParser, probe } from './mux'
/* *
 * The IClosedCaptionParser defines the interface to provide all operations for
 * parsing the closed captions embedded in Dash videos streams.
 * @interface
 */
export class IClosedCaptionParser {
  /* *
   * Initialize the caption parser. This should be called only once.
   * @param {BufferSource} data
   */
  init(data) {}

  /* *
   * Parses embedded CEA closed captions and interacts with the underlying
   * CaptionStream, and calls the callback function when there are closed
   * captions.
   *
   * @param {BufferSource} data
   * @param {function(Array.<muxjs.mp4.ClosedCaption>)} onCaptions
   *         A callback function to handle the closed captions from parsed data.
   */
  parseFrom(data, onCaptions) {}

  /* *
   * Resets the CaptionStream.
   */
  reset() {}
}
/* *
 * Closed Caption Parser provides all operations for parsing the closed captions
 * embedded in Dash videos streams.
 *
 * @implements {IClosedCaptionParser}
 * @final
 */
export class MuxJSClosedCaptionParser {
  constructor() {
    /* * @private {muxjs.mp4.CaptionParser} */
    this.muxCaptionParser_ = new CaptionParser()

    /* * @private {!Array.<number>} */
    this.videoTrackIds_ = []

    /* *
     * Timescales from the init segments, used for mux.js CaptionParser.
     * @private {!Object.<number, number>}
     */
    this.timescales_ = {}
  }

  /* *
   * @override
   */
  init(data) {
    // Caption parser for Dash
    const initBytes = BufferUtils.toUint8(data)
    this.videoTrackIds_ = probe.videoTrackIds(initBytes)
    this.timescales_ = probe.timescale(initBytes)
    this.muxCaptionParser_.init()
  }

  /* *
   * @override
   */
  parseFrom(data, onCaptions) {
    const segmentBytes = BufferUtils.toUint8(data)
    const dashParsed = this.muxCaptionParser_.parse(
      segmentBytes, this.videoTrackIds_, this.timescales_)
    if (dashParsed && dashParsed.captions) {
      onCaptions(dashParsed.captions)
    }
    // ParsedCaptions is used by mux.js to store the captions parsed so far.
    // It should be reset every time some data is parsed, so as to store new
    // data.
    this.muxCaptionParser_.clearParsedCaptions()
  }

  /* *
   * @override
   */
  reset() {
    this.muxCaptionParser_.resetCaptionStream()
  }

  /* *
   * Check if the MuxJS closed caption parser is supported on this platform.
   *
   * @return {boolean}
   */
  static isSupported() {
    return !!window.muxjs
  }
}

/* *
 * Noop Caption Parser creates an empty caption parser object when mux.js is not
 * available.
 *
 * @implements {IClosedCaptionParser}
 * @final
 */
export class NoopCaptionParser {
  /* *
   * @override
   */
  init(data) {}

  /* *
   * @override
   */
  parseFrom(data, onCaptions) {}

  /* *
   * @override
   */
  reset() {}
}
