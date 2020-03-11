/* *
 * Creates an InitSegmentReference, which provides the location to an
 * initialization segment.
 *
 * @export
 */
export class InitSegmentReference {
  /* *
   * @param {function():!Array.<string>} uris A function that creates the URIs
   *   of the resource containing the segment.
   * @param {number} startByte The offset from the start of the resource to the
   *   start of the segment.
   * @param {?number} endByte The offset from the start of the resource to the
   *   end of the segment, inclusive.  A value of null indicates that the
   *   segment extends to the end of the resource.
   */
  constructor(uris, startByte, endByte) {
    /* * @type {function():!Array.<string>} */
    this.getUris = uris

    /* * @const {number} */
    this.startByte = startByte

    /* * @const {?number} */
    this.endByte = endByte
  }

  /* *
   * Returns the offset from the start of the resource to the
   * start of the segment.
   *
   * @return {number}
   * @export
   */
  getStartByte() {
    return this.startByte
  }

  /* *
   * Returns the offset from the start of the resource to the end of the
   * segment, inclusive.  A value of null indicates that the segment extends
   * to the end of the resource.
   *
   * @return {?number}
   * @export
   */
  getEndByte() {
    return this.endByte
  }

  /* *
   * Returns the size of the init segment.
   * @return {?number}
   */
  getSize() {
    if (this.endByte) {
      return this.endByte - this.startByte
    } else {
      return null
    }
  }
}
/* *
 * SegmentReference provides the start time, end time, and location to a media
 * segment.
 *
 * @export
 */
export class SegmentReference {
  /* *
   * @param {number} position The segment's position.
   *   The following should hold true between any two SegmentReferences r1 and
   *   r2:
   *   IF r2.position > r1.position THEN
   *     [ (r2.startTime > r1.startTime) OR
   *       (r2.startTime == r1.startTime AND r2.endTime >= r1.endTime) ]
   * @param {number} startTime The segment's start time in seconds.
   * @param {number} endTime The segment's end time in seconds.  The segment
   *   ends the instant before this time, so |endTime| must be strictly greater
   *   than |startTime|.
   * @param {function():!Array.<string>} uris
   *   A function that creates the URIs of the resource containing the segment.
   * @param {number} startByte The offset from the start of the resource to the
   *   start of the segment.
   * @param {?number} endByte The offset from the start of the resource to the
   *   end of the segment, inclusive.  A value of null indicates that the
   *   segment extends to the end of the resource.
   * @param {InitSegmentReference} initSegmentReference
   *   The segment's initialization segment metadata, or null if the segments
   *   are self-initializing.
   * @param {number} timestampOffset
   *   The amount of time, in seconds, that must be added to the segment's
   *   internal timestamps to align it to the presentation timeline.
   *   <br>
   *   For DASH, this value should equal the Period start time minus the first
   *   presentation timestamp of the first frame/sample in the Period.  For
   *   example, for MP4 based streams, this value should equal Period start
   *   minus the first segment's tfdt box's 'baseMediaDecodeTime' field (after
   *   it has been converted to seconds).
   *   <br>
   *   For HLS, this value should be 0 to keep the presentation time at the most
   *   recent discontinuity minus the corresponding media time.
   * @param {number} appendWindowStart
   *   The start of the append window for this reference, relative to the
   *   presentation.  Any content from before this time will be removed by
   *   MediaSource.
   * @param {number} appendWindowEnd
   *   The end of the append window for this reference, relative to the
   *   presentation.  Any content from after this time will be removed by
   *   MediaSource.
   */
  constructor(
    position, startTime, endTime, uris, startByte, endByte,
    initSegmentReference, timestampOffset, appendWindowStart,
    appendWindowEnd) {
    console.assert(startTime < endTime,
      'startTime must be less than endTime')
    console.assert((startByte < endByte) || (endByte == null),
      'startByte must be < endByte')

    /* * @const {number} */
    this.position = position

    /* * @type {number} */
    this.startTime = startTime

    /* * @type {number} */
    this.endTime = endTime

    /* * @type {function():!Array.<string>} */
    this.getUris = uris

    /* * @const {number} */
    this.startByte = startByte

    /* * @const {?number} */
    this.endByte = endByte

    /* * @type {InitSegmentReference} */
    this.initSegmentReference = initSegmentReference

    /* * @type {number} */
    this.timestampOffset = timestampOffset

    /* * @type {number} */
    this.appendWindowStart = appendWindowStart

    /* * @type {number} */
    this.appendWindowEnd = appendWindowEnd
  }

  /* *
   * Returns the segment's position.
   *
   * @return {number} The segment's position.
   * @export
   */
  getPosition() {
    return this.position
  }

  /* *
   * Returns the segment's start time in seconds.
   *
   * @return {number}
   * @export
   */
  getStartTime() {
    return this.startTime
  }

  /* *
   * Returns the segment's end time in seconds.
   *
   * @return {number}
   * @export
   */
  getEndTime() {
    return this.endTime
  }

  /* *
   * Returns the offset from the start of the resource to the
   * start of the segment.
   *
   * @return {number}
   * @export
   */
  getStartByte() {
    return this.startByte
  }

  /* *
   * Returns the offset from the start of the resource to the end of the
   * segment, inclusive.  A value of null indicates that the segment extends to
   * the end of the resource.
   *
   * @return {?number}
   * @export
   */
  getEndByte() {
    return this.endByte
  }

  /* *
   * Returns the size of the segment.
   * @return {?number}
   */
  getSize() {
    if (this.endByte) {
      return this.endByte - this.startByte
    } else {
      return null
    }
  }
}
/* *
 * A convenient typedef for when either type of reference is acceptable.
 *
 * @typedef {InitSegmentReference|SegmentReference}
 */
// AnySegmentReference
