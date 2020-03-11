export class CaptionParser {
  /* *
   * Parser for CEA closed captions embedded in video streams for Dash.
   * @constructor
   * @struct
   */
  // constructor() {}

  /* * Initializes the closed caption parser. */
  init() {}

  /* *
   * Return true if a new video track is selected or if the timescale is
   * changed.
   * @param {!Array.<number>} videoTrackIds A list of video tracks found in the
   *    init segment.
   * @param {!Object.<number, number>} timescales The map of track Ids and the
   *    tracks' timescales in the init segment.
   * @return {boolean}
   */
  isNewInit(videoTrackIds, timescales) {}

  /* *
   * Parses embedded CEA closed captions and interacts with the underlying
   * CaptionStream, and return the parsed captions.
   * @param {!Uint8Array} segment The fmp4 segment containing embedded captions
   * @param {!Array.<number>} videoTrackIds A list of video tracks found in the
   *    init segment.
   * @param {!Object.<number, number>} timescales The timescales found in the
   *    init segment.
   * @return {muxjs.mp4.ParsedClosedCaptions}
   */
  parse(segment, videoTrackIds, timescales) {}

  /* * Clear the parsed closed captions data for new data. */
  clearParsedCaptions() {}

  /* * Reset the captions stream. */
  resetCaptionStream() {}
}

export class probe {
  /* *
   * Parses an MP4 initialization segment and extracts the timescale
   * values for any declared tracks.
   *
   * @param {Uint8Array} init The bytes of the init segment
   * @return {!Object.<number, number>} a hash of track ids to timescale
   * values or null if the init segment is malformed.
   */
  static timescale(init) {}

  /* *
    * Find the trackIds of the video tracks in this source.
    * Found by parsing the Handler Reference and Track Header Boxes:
    *
    * @param {Uint8Array} init The bytes of the init segment for this source
    * @return {!Array.<number>} A list of trackIds
   **/
  static videoTrackIds(init) {}
}

export class Transmuxer {
  /* * @param {Object=} options */
  // constructor(options) {}
  /* * @param {number} time */
  setBaseMediaDecodeTime(time) {}

  /* * @param {!Uint8Array} data */
  push(data) {}

  flush() {}

  /* *
   * Add a handler for a specified event type.
   * @param {string} type Event name
   * @param {Function} listener The callback to be invoked
   */
  on(type, listener) {}

  /* *
   * Remove a handler for a specified event type.
   * @param {string} type Event name
   * @param {Function} listener The callback to be removed
   */
  off(type, listener) {}

  /* * Remove all handlers and clean up. */
  dispose() {}
}
