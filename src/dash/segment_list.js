import SegmentBase from './segment_base'
import { SegmentReference } from '../media/segment_reference'
import SegmentIndex from '../media/segment_index'
import Error from '../util/error'
import Functional from '../util/functional'
import Iterables from '../util/iterables'
import ManifestParserUtils from '../util/manifest_parser_utils'
import XmlUtils from '../util/xml_utils'
/**
 * @summary A set of functions for parsing SegmentList elements.
 */
export default class SegmentList {
  /**
   * Creates a new StreamInfo object.
   * Updates the existing SegmentIndex, if any.
   *
   * @param {DashParser.Context} context
   * @param {!Object.<string, !SegmentIndex>} segmentIndexMap
   * @return {DashParser.StreamInfo}
   */
  static createStreamInfo(context, segmentIndexMap) {
    console.assert(context.representation.segmentList,
      'Should only be called with SegmentList')
    const SegmentList = SegmentList

    const initSegmentReference = SegmentBase.createInitSegment(
      context, SegmentList.fromInheritance_)
    const info = SegmentList.parseSegmentListInfo_(context)

    SegmentList.checkSegmentListInfo_(context, info)

    /** @type {SegmentIndex} */
    let segmentIndex = null
    let id = null
    if (context.period.id && context.representation.id) {
      // Only check/store the index if period and representation IDs are set.
      id = context.period.id + ',' + context.representation.id
      segmentIndex = segmentIndexMap[id]
    }

    const references = SegmentList.createSegmentReferences_(
      context.periodInfo.start, context.periodInfo.duration,
      info.startNumber, context.representation.baseUris, info,
      initSegmentReference)

    if (segmentIndex) {
      segmentIndex.merge(references)
      const start = context.presentationTimeline.getSegmentAvailabilityStart()
      segmentIndex.evict(start)
    } else {
      context.presentationTimeline.notifySegments(references)
      segmentIndex = new SegmentIndex(references)
      if (id && context.dynamic) {
        segmentIndexMap[id] = segmentIndex
      }
    }

    if (!context.dynamic || !context.periodInfo.isLastPeriod) {
      const periodStart = context.periodInfo.start
      const periodEnd = context.periodInfo.duration
        ? context.periodInfo.start + context.periodInfo.duration : Infinity
      segmentIndex.fit(periodStart, periodEnd)
    }

    return {
      generateSegmentIndex: () => Promise.resolve(segmentIndex)
    }
  }

  /**
   * @param {?DashParser.InheritanceFrame} frame
   * @return {Element}
   * @private
   */
  static fromInheritance_(frame) {
    return frame.segmentList
  }

  /**
   * Parses the SegmentList items to create an info object.
   *
   * @param {DashParser.Context} context
   * @return {SegmentList.SegmentListInfo}
   * @private
   */
  static parseSegmentListInfo_(context) {
    const SegmentList = SegmentList
    const MpdUtils = MpdUtils

    const mediaSegments = SegmentList.parseMediaSegments_(context)
    const segmentInfo =
        MpdUtils.parseSegmentInfo(context, SegmentList.fromInheritance_)

    let startNumber = segmentInfo.startNumber
    if (startNumber === 0) {
      console.warning('SegmentList@startNumber must be > 0')
      startNumber = 1
    }

    let startTime = 0
    if (segmentInfo.segmentDuration) {
      // See DASH sec. 5.3.9.5.3
      // Don't use presentationTimeOffset for @duration.
      startTime = segmentInfo.segmentDuration * (startNumber - 1)
    } else if (segmentInfo.timeline && segmentInfo.timeline.length > 0) {
      // The presentationTimeOffset was considered in timeline creation.
      startTime = segmentInfo.timeline[0].start
    }

    return {
      segmentDuration: segmentInfo.segmentDuration,
      startTime: startTime,
      startNumber: startNumber,
      scaledPresentationTimeOffset: segmentInfo.scaledPresentationTimeOffset,
      timeline: segmentInfo.timeline,
      mediaSegments: mediaSegments
    }
  }

  /**
   * Checks whether a SegmentListInfo object is valid.
   *
   * @param {DashParser.Context} context
   * @param {SegmentList.SegmentListInfo} info
   * @private
   */
  static checkSegmentListInfo_(context, info) {
    if (!info.segmentDuration && !info.timeline &&
        info.mediaSegments.length > 1) {
      console.warning(
        'SegmentList does not contain sufficient segment information:',
        'the SegmentList specifies multiple segments,',
        'but does not specify a segment duration or timeline.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_NO_SEGMENT_INFO)
    }

    if (!info.segmentDuration && !context.periodInfo.duration &&
        !info.timeline && info.mediaSegments.length === 1) {
      console.warning(
        'SegmentList does not contain sufficient segment information:',
        'the SegmentList specifies one segment,',
        'but does not specify a segment duration, period duration,',
        'or timeline.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_NO_SEGMENT_INFO)
    }

    if (info.timeline && info.timeline.length === 0) {
      console.warning(
        'SegmentList does not contain sufficient segment information:',
        'the SegmentList has an empty timeline.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_NO_SEGMENT_INFO)
    }
  }

  /**
   * Creates an array of segment references for the given data.
   *
   * @param {number} periodStart in seconds.
   * @param {?number} periodDuration in seconds.
   * @param {number} startNumber
   * @param {!Array.<string>} baseUris
   * @param {SegmentList.SegmentListInfo} info
   * @param {InitSegmentReference} initSegmentReference
   * @return {!Array.<!SegmentReference>}
   * @private
   */
  static createSegmentReferences_(
    periodStart, periodDuration, startNumber, baseUris, info,
    initSegmentReference) {
    let max = info.mediaSegments.length
    if (info.timeline && info.timeline.length !== info.mediaSegments.length) {
      max = Math.min(info.timeline.length, info.mediaSegments.length)
      console.warning(
        'The number of items in the segment timeline and the number of ',
        'segment URLs do not match, truncating', info.mediaSegments.length,
        'to', max)
    }

    const timestampOffset = periodStart - info.scaledPresentationTimeOffset
    const appendWindowStart = periodStart
    const appendWindowEnd = periodDuration
      ? periodStart + periodDuration : Infinity

    /** @type {!Array.<!SegmentReference>} */
    const references = []
    let prevEndTime = info.startTime
    for (const i of Iterables.range(max)) {
      const segment = info.mediaSegments[i]
      const mediaUri = ManifestParserUtils.resolveUris(
        baseUris, [segment.mediaUri])

      const startTime = prevEndTime
      let endTime

      if (info.segmentDuration != null) {
        endTime = startTime + info.segmentDuration
      } else if (info.timeline) {
        // Ignore the timepoint start since they are continuous.
        endTime = info.timeline[i].end
      } else {
        // If segmentDuration and timeline are null then there must
        // be exactly one segment.
        console.assert(
          info.mediaSegments.length === 1 && periodDuration,
          'There should be exactly one segment with a Period duration.')
        endTime = startTime + periodDuration
      }

      const getUris = () => mediaUri
      references.push(
        new SegmentReference(
          i + startNumber,
          periodStart + startTime,
          periodStart + endTime,
          getUris,
          segment.start,
          segment.end,
          initSegmentReference,
          timestampOffset,
          appendWindowStart, appendWindowEnd))
      prevEndTime = endTime
    }

    return references
  }

  /**
   * Parses the media URIs from the context.
   *
   * @param {DashParser.Context} context
   * @return {!Array.<SegmentList.MediaSegment>}
   * @private
   */
  static parseMediaSegments_(context) {
    /** @type {!Array.<!Element>} */
    const segmentLists = [
      context.representation.segmentList,
      context.adaptationSet.segmentList,
      context.period.segmentList
    ].filter(Functional.isNotNull)

    // Search each SegmentList for one with at least one SegmentURL element,
    // select the first one, and convert each SegmentURL element to a tuple.
    return segmentLists
      .map((node) => { return XmlUtils.findChildren(node, 'SegmentURL') })
      .reduce((all, part) => { return all.length > 0 ? all : part })
      .map((urlNode) => {
        if (urlNode.getAttribute('indexRange') &&
              !context.indexRangeWarningGiven) {
          context.indexRangeWarningGiven = true
          console.warning(
            'We do not support the SegmentURL@indexRange attribute on ' +
                'SegmentList.  We only use the SegmentList@duration ' +
                'attribute or SegmentTimeline, which must be accurate.')
        }

        const uri = urlNode.getAttribute('media')
        const range = XmlUtils.parseAttr(
          urlNode, 'mediaRange', XmlUtils.parseRange,
          { start: 0, end: null })
        return { mediaUri: uri, start: range.start, end: range.end }
      })
  }
}

/**
 * @typedef {{
 *   mediaUri: string,
 *   start: number,
 *   end: ?number
 * }}
 *
 * @property {string} mediaUri
 *   The URI of the segment.
 * @property {number} start
 *   The start byte of the segment.
 * @property {?number} end
 *   The end byte of the segment, or null.
 */
SegmentList.MediaSegment

/**
 * @typedef {{
 *   segmentDuration: ?number,
 *   startTime: number,
 *   startNumber: number,
 *   scaledPresentationTimeOffset: number,
 *   timeline: Array.<MpdUtils.TimeRange>,
 *   mediaSegments: !Array.<SegmentList.MediaSegment>
 * }}
 * @private
 *
 * @description
 * Contains information about a SegmentList.
 *
 * @property {?number} segmentDuration
 *   The duration of the segments, if given.
 * @property {number} startTime
 *   The start time of the first segment, in seconds.
 * @property {number} startNumber
 *   The start number of the segments; 1 or greater.
 * @property {number} scaledPresentationTimeOffset
 *   The scaledPresentationTimeOffset of the representation, in seconds.
 * @property {Array.<MpdUtils.TimeRange>} timeline
 *   The timeline of the representation, if given.  Times in seconds.
 * @property {!Array.<SegmentList.MediaSegment>} mediaSegments
 *   The URI and byte-ranges of the media segments.
 */
SegmentList.SegmentListInfo
