import { SegmentReference } from '../media/segment_reference'
import { EbmlParser } from '../util/ebml_parser'
import Error from '../util/error'

export default class WebmSegmentIndexParser {
  /* *
   * Parses SegmentReferences from a WebM container.
   * @param {BufferSource} cuesData The WebM container's 'Cueing Data' section.
   * @param {BufferSource} initData The WebM container's headers.
   * @param {!Array.<string>} uris The possible locations of the WebM file that
   *   contains the segments.
   * @param {InitSegmentReference} initSegmentReference
   * @param {number} timestampOffset
   * @param {number} appendWindowStart
   * @param {number} appendWindowEnd
   * @return {!Array.<!SegmentReference>}
   * @see http://www.matroska.org/technical/specs/index.html
   * @see http://www.webmproject.org/docs/container/
   */
  static parse(
    cuesData, initData, uris, initSegmentReference, timestampOffset,
    appendWindowStart, appendWindowEnd) {
    const tuple =
        WebmSegmentIndexParser.parseWebmContainer_(initData)
    const parser = new EbmlParser(cuesData)
    const cuesElement = parser.parseElement()
    if (cuesElement.id !== WebmSegmentIndexParser.CUES_ID) {
      console.error('Not a Cues element.')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.WEBM_CUES_ELEMENT_MISSING)
    }

    return WebmSegmentIndexParser.parseCues_(
      cuesElement, tuple.segmentOffset, tuple.timecodeScale, tuple.duration,
      uris, initSegmentReference, timestampOffset, appendWindowStart,
      appendWindowEnd)
  }
  /* *
   * Parses a WebM container to get the segment's offset, timecode scale, and
   * duration.
   *
   * @param {BufferSource} initData
   * @return {{segmentOffset: number, timecodeScale: number, duration: number}}
   *   The segment's offset in bytes, the segment's timecode scale in seconds,
   *   and the duration in seconds.
   * @private
   */
  static parseWebmContainer_(initData) {
    const parser = new EbmlParser(initData)

    // Check that the WebM container data starts with the EBML header, but
    // skip its contents.
    const ebmlElement = parser.parseElement()
    if (ebmlElement.id !== WebmSegmentIndexParser.EBML_ID) {
      console.error('Not an EBML element.')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.WEBM_EBML_HEADER_ELEMENT_MISSING)
    }

    const segmentElement = parser.parseElement()
    if (segmentElement.id !== WebmSegmentIndexParser.SEGMENT_ID) {
      console.error('Not a Segment element.')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.WEBM_SEGMENT_ELEMENT_MISSING)
    }

    // This value is used as the initial offset to the first referenced segment.
    const segmentOffset = segmentElement.getOffset()

    // Parse the Segment element to get the segment info.
    const segmentInfo = WebmSegmentIndexParser.parseSegment_(
      segmentElement)
    return {
      segmentOffset: segmentOffset,
      timecodeScale: segmentInfo.timecodeScale,
      duration: segmentInfo.duration
    }
  }
  /* *
   * Parses a WebM Info element to get the segment's timecode scale and
   * duration.
   * @param {!EbmlElement} segmentElement
   * @return {{timecodeScale: number, duration: number}} The segment's timecode
   *   scale in seconds and duration in seconds.
   * @private
   */
  static parseSegment_(segmentElement) {
    const parser = segmentElement.createParser()

    // Find the Info element.
    let infoElement = null
    while (parser.hasMoreData()) {
      const elem = parser.parseElement()
      if (elem.id !== WebmSegmentIndexParser.INFO_ID) {
        continue
      }

      infoElement = elem

      break
    }

    if (!infoElement) {
      console.error('Not an Info element.')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.WEBM_INFO_ELEMENT_MISSING)
    }

    return WebmSegmentIndexParser.parseInfo_(infoElement)
  }
  /* *
   * Parses a WebM Info element to get the segment's timecode scale and
   * duration.
   * @param {!EbmlElement} infoElement
   * @return {{timecodeScale: number, duration: number}} The segment's timecode
   *   scale in seconds and duration in seconds.
   * @private
   */
  static parseInfo_(infoElement) {
    const parser = infoElement.createParser()

    // The timecode scale factor in units of [nanoseconds / T], where [T] are
    // the units used to express all other time values in the WebM container.
    // By default it's assumed that [T] === [milliseconds].
    let timecodeScaleNanoseconds = 1000000
    /* * @type {?number} */
    let durationScale = null

    while (parser.hasMoreData()) {
      const elem = parser.parseElement()
      if (elem.id === WebmSegmentIndexParser.TIMECODE_SCALE_ID) {
        timecodeScaleNanoseconds = elem.getUint()
      } else if (elem.id === WebmSegmentIndexParser.DURATION_ID) {
        durationScale = elem.getFloat()
      }
    }
    if (durationScale === null) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.WEBM_DURATION_ELEMENT_MISSING)
    }

    // The timecode scale factor in units of [seconds / T].
    const timecodeScale = timecodeScaleNanoseconds / 1000000000
    // The duration is stored in units of [T]
    const durationSeconds = durationScale * timecodeScale

    return { timecodeScale: timecodeScale, duration: durationSeconds }
  }
  /* *
   * Parses a WebM CuesElement.
   * @param {!EbmlElement} cuesElement
   * @param {number} segmentOffset
   * @param {number} timecodeScale
   * @param {number} duration
   * @param {!Array.<string>} uris
   * @param {InitSegmentReference} initSegmentReference
   * @param {number} timestampOffset
   * @param {number} appendWindowStart
   * @param {number} appendWindowEnd
   * @return {!Array.<!SegmentReference>}
   * @private
   */
  static parseCues_(cuesElement, segmentOffset, timecodeScale, duration,
    uris, initSegmentReference, timestampOffset, appendWindowStart,
    appendWindowEnd) {
    const references = []
    const getUris = () => uris

    const parser = cuesElement.createParser()

    let lastTime = null
    let lastOffset = null

    while (parser.hasMoreData()) {
      const elem = parser.parseElement()
      if (elem.id !== WebmSegmentIndexParser.CUE_POINT_ID) {
        continue
      }

      const tuple = WebmSegmentIndexParser.parseCuePoint_(elem)
      if (!tuple) {
        continue
      }

      // Subtract the presentation time offset from the unscaled time
      const currentTime = timecodeScale * tuple.unscaledTime
      const currentOffset = segmentOffset + tuple.relativeOffset

      if (lastTime !== null) {
        console.assert(lastOffset !== null, 'last offset cannot be null')

        references.push(
          new SegmentReference(
            references.length,
            lastTime + timestampOffset,
            currentTime + timestampOffset,
            getUris,
            /*  startByte= */ lastOffset, /*  endByte= */ currentOffset - 1,
            initSegmentReference,
            timestampOffset,
            appendWindowStart,
            appendWindowEnd))
      }

      lastTime = currentTime
      lastOffset = currentOffset
    }

    if (lastTime !== null) {
      console.assert(lastOffset !== null, 'last offset cannot be null')

      references.push(
        new SegmentReference(
          references.length,
          lastTime + timestampOffset,
          duration + timestampOffset,
          getUris,
          /*  startByte= */ lastOffset, /*  endByte= */ null,
          initSegmentReference,
          timestampOffset,
          appendWindowStart,
          appendWindowEnd))
    }

    return references
  }
  /* *
   * Parses a WebM CuePointElement to get an 'unadjusted' segment reference.
   * @param {EbmlElement} cuePointElement
   * @return {{unscaledTime: number, relativeOffset: number}} The referenced
   *   segment's start time in units of [T] (see parseInfo_()), and the
   *   referenced segment's offset in bytes, relative to a WebM Segment
   *   element.
   * @private
   */
  static parseCuePoint_(cuePointElement) {
    const parser = cuePointElement.createParser()

    // Parse CueTime element.
    const cueTimeElement = parser.parseElement()
    if (cueTimeElement.id !== WebmSegmentIndexParser.CUE_TIME_ID) {
      console.warning('Not a CueTime element.')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.WEBM_CUE_TIME_ELEMENT_MISSING)
    }
    const unscaledTime = cueTimeElement.getUint()

    // Parse CueTrackPositions element.
    const cueTrackPositionsElement = parser.parseElement()
    if (cueTrackPositionsElement.id !==
        WebmSegmentIndexParser.CUE_TRACK_POSITIONS_ID) {
      console.warning('Not a CueTrackPositions element.')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.WEBM_CUE_TRACK_POSITIONS_ELEMENT_MISSING)
    }

    const cueTrackParser = cueTrackPositionsElement.createParser()
    let relativeOffset = 0

    while (cueTrackParser.hasMoreData()) {
      const elem = cueTrackParser.parseElement()
      if (elem.id !== WebmSegmentIndexParser.CUE_CLUSTER_POSITION) {
        continue
      }

      relativeOffset = elem.getUint()
      break
    }

    return { unscaledTime: unscaledTime, relativeOffset: relativeOffset }
  }
}
/* * @const {number} */
WebmSegmentIndexParser.EBML_ID = 0x1a45dfa3
/* * @const {number} */
WebmSegmentIndexParser.SEGMENT_ID = 0x18538067
/* * @const {number} */
WebmSegmentIndexParser.INFO_ID = 0x1549a966
/* * @const {number} */
WebmSegmentIndexParser.TIMECODE_SCALE_ID = 0x2ad7b1
/* * @const {number} */
WebmSegmentIndexParser.DURATION_ID = 0x4489
/* * @const {number} */
WebmSegmentIndexParser.CUES_ID = 0x1c53bb6b
/* * @const {number} */
WebmSegmentIndexParser.CUE_POINT_ID = 0xbb
/* * @const {number} */
WebmSegmentIndexParser.CUE_TIME_ID = 0xb3
/* * @const {number} */
WebmSegmentIndexParser.CUE_TRACK_POSITIONS_ID = 0xb7
/* * @const {number} */
WebmSegmentIndexParser.CUE_CLUSTER_POSITION = 0xf1
