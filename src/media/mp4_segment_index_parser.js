import { SegmentReference } from './segment_reference'
import Error from '../util/error'
import Iterables from '../util/iterables'
import Mp4Parser from '../util/mp4_parser'
import Functional from '../util/functional'
export default class Mp4SegmentIndexParser {
  /**
   * Parses SegmentReferences from an ISO BMFF SIDX structure.
   * @param {BufferSource} sidxData The MP4's container's SIDX.
   * @param {number} sidxOffset The SIDX's offset, in bytes, from the start of
   *   the MP4 container.
   * @param {!Array.<string>} uris The possible locations of the MP4 file that
   *   contains the segments.
   * @param {InitSegmentReference} initSegmentReference
   * @param {number} timestampOffset
   * @param {number} appendWindowStart
   * @param {number} appendWindowEnd
   * @return {!Array.<!SegmentReference>}
   */
  static parse(
    sidxData, sidxOffset, uris, initSegmentReference, timestampOffset,
    appendWindowStart, appendWindowEnd) {
    const Mp4SegmentIndexParser = Mp4SegmentIndexParser

    let references

    const parser = new Mp4Parser()
      .fullBox('sidx', (box) => {
        references = Mp4SegmentIndexParser.parseSIDX_(
          sidxOffset,
          initSegmentReference,
          timestampOffset,
          appendWindowStart,
          appendWindowEnd,
          uris,
          box)
      })

    if (sidxData) {
      parser.parse(sidxData)
    }

    if (references) {
      return references
    } else {
      console.error('Invalid box type, expected "sidx".')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.MP4_SIDX_WRONG_BOX_TYPE)
    }
  }
  /**
   * Parse a SIDX box from the given reader.
   *
   * @param {number} sidxOffset
   * @param {InitSegmentReference} initSegmentReference
   * @param {number} timestampOffset
   * @param {number} appendWindowStart
   * @param {number} appendWindowEnd
   * @param {!Array.<string>} uris The possible locations of the MP4 file that
   *   contains the segments.
   * @param {!shaka.extern.ParsedBox} box
   * @return {!Array.<!SegmentReference>}
   * @private
   */
  static parseSIDX_(
    sidxOffset, initSegmentReference, timestampOffset, appendWindowStart,
    appendWindowEnd, uris, box) {
    console.assert(
      box.version != null,
      'SIDX is a full box and should have a valid version.')

    const references = []

    // Parse the SIDX structure.
    // Skip reference_ID (32 bits).
    box.reader.skip(4)

    const timescale = box.reader.readUint32()

    if (timescale === 0) {
      console.error('Invalid timescale.')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MEDIA,
        Error.Code.MP4_SIDX_INVALID_TIMESCALE)
    }

    let earliestPresentationTime
    let firstOffset

    if (box.version === 0) {
      earliestPresentationTime = box.reader.readUint32()
      firstOffset = box.reader.readUint32()
    } else {
      earliestPresentationTime = box.reader.readUint64()
      firstOffset = box.reader.readUint64()
    }

    // Skip reserved (16 bits).
    box.reader.skip(2)

    // Add references.
    const referenceCount = box.reader.readUint16()

    // Subtract the presentation time offset
    let unscaledStartTime = earliestPresentationTime
    let startByte = sidxOffset + box.size + firstOffset

    for (const _ of Iterables.range(referenceCount)) {
      Functional.ignored(_)
      // |chunk| is 1 bit for |referenceType|, and 31 bits for |referenceSize|.
      const chunk = box.reader.readUint32()
      const referenceType = (chunk & 0x80000000) >>> 31
      const referenceSize = chunk & 0x7FFFFFFF

      const subsegmentDuration = box.reader.readUint32()

      // Skipping 1 bit for |startsWithSap|, 3 bits for |sapType|, and 28 bits
      // for |sapDelta|.
      box.reader.skip(4)

      // If |referenceType| is 1 then the reference is to another SIDX.
      // We do not support this.
      if (referenceType === 1) {
        console.error('Heirarchical SIDXs are not supported.')
        throw new Error(
          Error.Severity.CRITICAL,
          Error.Category.MEDIA,
          Error.Code.MP4_SIDX_TYPE_NOT_SUPPORTED)
      }

      // The media timestamps inside the container.
      const nativeStartTime = unscaledStartTime / timescale
      const nativeEndTime =
          (unscaledStartTime + subsegmentDuration) / timescale

      references.push(
        new SegmentReference(
          references.length,
          nativeStartTime + timestampOffset,
          nativeEndTime + timestampOffset,
          () => { return uris },
          startByte,
          startByte + referenceSize - 1,
          initSegmentReference,
          timestampOffset,
          appendWindowStart,
          appendWindowEnd))

      unscaledStartTime += subsegmentDuration
      startByte += referenceSize
    }

    box.parser.stop()
    return references
  }
}
