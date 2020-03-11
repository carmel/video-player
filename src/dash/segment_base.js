import MpdUtils from './mpd_utils'
import { InitSegmentReference } from '../media/segment_reference'
import Mp4SegmentIndexParser from '../media/mp4_segment_index_parser'
import SegmentIndex from '../media/segment_index'
import WebmSegmentIndexParser from '../media/webm_segment_index_parser'
import Error from '../util/error'
import ManifestParserUtils from '../util/manifest_parser_utils'
import XmlUtils from '../util/xml_utils'
import ObjectUtils from '../util/object_utils'
/* *
 * @summary A set of functions for parsing SegmentBase elements.
 */
export default class SegmentBase {
  /* *
   * Creates an init segment reference from a Context object.
   *
   * @param {DashParser.Context} context
   * @param {function(?DashParser.InheritanceFrame):Element} callback
   * @return {InitSegmentReference}
   */
  static createInitSegment(context, callback) {
    const ManifestParserUtils = ManifestParserUtils

    const initialization =
        MpdUtils.inheritChild(context, callback, 'Initialization')
    if (!initialization) {
      return null
    }

    let resolvedUris = context.representation.baseUris
    const uri = initialization.getAttribute('sourceURL')
    if (uri) {
      resolvedUris = ManifestParserUtils.resolveUris(
        context.representation.baseUris, [uri])
    }

    let startByte = 0
    let endByte = null
    const range =
        XmlUtils.parseAttr(initialization, 'range', XmlUtils.parseRange)
    if (range) {
      startByte = range.start
      endByte = range.end
    }

    const getUris = () => resolvedUris
    return new InitSegmentReference(getUris, startByte, endByte)
  }

  /* *
   * Creates a new StreamInfo object.
   *
   * @param {DashParser.Context} context
   * @param {DashParser.RequestInitSegmentCallback}
   *     requestInitSegment
   * @return {DashParser.StreamInfo}
   */
  static createStreamInfo(context, requestInitSegment) {
    console.assert(context.representation.segmentBase,
      'Should only be called with SegmentBase')
    // Since SegmentBase does not need updates, simply treat any call as
    // the initial parse.
    const MpdUtils = MpdUtils
    const SegmentBase = SegmentBase
    const XmlUtils = XmlUtils

    const unscaledPresentationTimeOffset = Number(MpdUtils.inheritAttribute(
      context, SegmentBase.fromInheritance_, 'presentationTimeOffset')) || 0

    const timescaleStr = MpdUtils.inheritAttribute(
      context, SegmentBase.fromInheritance_, 'timescale')
    let timescale = 1
    if (timescaleStr) {
      timescale = XmlUtils.parsePositiveInt(timescaleStr) || 1
    }

    const scaledPresentationTimeOffset =
        (unscaledPresentationTimeOffset / timescale) || 0

    const initSegmentReference =
        SegmentBase.createInitSegment(context, SegmentBase.fromInheritance_)

    // Throws an immediate error if the format is unsupported.
    SegmentBase.checkSegmentIndexRangeSupport_(context, initSegmentReference)

    // Direct fields of context will be reassigned by the parser before
    // generateSegmentIndex is called.  So we must make a shallow copy first,
    // and use that in the generateSegmentIndex callbacks.
    const shallowCopyOfContext =
        ObjectUtils.shallowCloneObject(context)

    return {
      generateSegmentIndex: () => {
        return SegmentBase.generateSegmentIndex_(
          shallowCopyOfContext, requestInitSegment, initSegmentReference,
          scaledPresentationTimeOffset)
      }
    }
  }

  /* *
   * Creates a SegmentIndex for the given URIs and context.
   *
   * @param {DashParser.Context} context
   * @param {DashParser.RequestInitSegmentCallback}
   *     requestInitSegment
   * @param {InitSegmentReference} initSegmentReference
   * @param {!Array.<string>} uris
   * @param {number} startByte
   * @param {?number} endByte
   * @param {number} scaledPresentationTimeOffset
   * @return {!Promise.<SegmentIndex>}
   */
  static async generateSegmentIndexFromUris(
    context, requestInitSegment, initSegmentReference, uris, startByte,
    endByte, scaledPresentationTimeOffset) {
    // Unpack context right away, before we start an async process.
    // This immunizes us against changes to the context object later.
    /* * @type {PresentationTimeline} */
    const presentationTimeline = context.presentationTimeline
    const fitLast = !context.dynamic || !context.periodInfo.isLastPeriod
    const periodStart = context.periodInfo.start
    const periodDuration = context.periodInfo.duration
    const containerType = context.representation.mimeType.split('/')[1]

    // Create a local variable to bind to so we can set to null to help the GC.
    let localRequest = requestInitSegment
    let segmentIndex = null

    const responses = [
      localRequest(uris, startByte, endByte),
      containerType === 'webm'
        ? localRequest(
          initSegmentReference.getUris(),
          initSegmentReference.startByte,
          initSegmentReference.endByte)
        : null
    ]

    localRequest = null
    const results = await Promise.all(responses)
    const indexData = results[0]
    const initData = results[1] || null
    /* * @type {Array.<!SegmentReference>} */
    let references = null

    const timestampOffset = periodStart - scaledPresentationTimeOffset
    const appendWindowStart = periodStart
    const appendWindowEnd = periodDuration
      ? periodStart + periodDuration : Infinity

    if (containerType === 'mp4') {
      references = Mp4SegmentIndexParser.parse(
        indexData, startByte, uris, initSegmentReference, timestampOffset,
        appendWindowStart, appendWindowEnd)
    } else {
      console.assert(initData, 'WebM requires init data')
      references = WebmSegmentIndexParser.parse(
        indexData, initData, uris, initSegmentReference, timestampOffset,
        appendWindowStart, appendWindowEnd)
    }

    presentationTimeline.notifySegments(references)

    // Since containers are never updated, we don't need to store the
    // segmentIndex in the map.
    console.assert(!segmentIndex,
      'Should not call generateSegmentIndex twice')

    segmentIndex = new SegmentIndex(references)
    if (fitLast) {
      segmentIndex.fit(appendWindowStart, appendWindowEnd)
    }
    return segmentIndex
  }

  /* *
   * @param {?DashParser.InheritanceFrame} frame
   * @return {Element}
   * @private
   */
  static fromInheritance_(frame) {
    return frame.segmentBase
  }

  /* *
   * Compute the byte range of the segment index from the container.
   *
   * @param {DashParser.Context} context
   * @return {?{start: number, end: number}}
   * @private
   */
  static computeIndexRange_(context) {
    const MpdUtils = MpdUtils
    const SegmentBase = SegmentBase
    const XmlUtils = XmlUtils

    const representationIndex = MpdUtils.inheritChild(
      context, SegmentBase.fromInheritance_, 'RepresentationIndex')
    const indexRangeElem = MpdUtils.inheritAttribute(
      context, SegmentBase.fromInheritance_, 'indexRange')

    let indexRange = XmlUtils.parseRange(indexRangeElem || '')
    if (representationIndex) {
      indexRange = XmlUtils.parseAttr(
        representationIndex, 'range', XmlUtils.parseRange, indexRange)
    }
    return indexRange
  }

  /* *
   * Compute the URIs of the segment index from the container.
   *
   * @param {DashParser.Context} context
   * @return {!Array.<string>}
   * @private
   */
  static computeIndexUris_(context) {
    const ManifestParserUtils = ManifestParserUtils
    const MpdUtils = MpdUtils
    const SegmentBase = SegmentBase

    const representationIndex = MpdUtils.inheritChild(
      context, SegmentBase.fromInheritance_, 'RepresentationIndex')

    let indexUris = context.representation.baseUris
    if (representationIndex) {
      const representationUri = representationIndex.getAttribute('sourceURL')
      if (representationUri) {
        indexUris = ManifestParserUtils.resolveUris(
          context.representation.baseUris, [representationUri])
      }
    }

    return indexUris
  }

  /* *
   * Check if this type of segment index is supported.  This allows for
   * immediate errors during parsing, as opposed to an async error from
   * createSegmentIndex().
   *
   * Also checks for a valid byte range, which is not required for callers from
   * SegmentTemplate.
   *
   * @param {DashParser.Context} context
   * @param {InitSegmentReference} initSegmentReference
   * @private
   */
  static checkSegmentIndexRangeSupport_(context, initSegmentReference) {
    const SegmentBase = SegmentBase

    SegmentBase.checkSegmentIndexSupport(context, initSegmentReference)

    const indexRange = SegmentBase.computeIndexRange_(context)
    if (!indexRange) {
      console.error(
        'SegmentBase does not contain sufficient segment information:',
        'the SegmentBase does not contain @indexRange',
        'or a RepresentationIndex element.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_NO_SEGMENT_INFO)
    }
  }

  /* *
   * Check if this type of segment index is supported.  This allows for
   * immediate errors during parsing, as opposed to an async error from
   * createSegmentIndex().
   *
   * @param {DashParser.Context} context
   * @param {InitSegmentReference} initSegmentReference
   */
  static checkSegmentIndexSupport(context, initSegmentReference) {
    const ContentType = ManifestParserUtils.ContentType

    const contentType = context.representation.contentType
    const containerType = context.representation.mimeType.split('/')[1]

    if (contentType !== ContentType.TEXT && containerType !== 'mp4' &&
        containerType !== 'webm') {
      console.error(
        'SegmentBase specifies an unsupported container type.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_UNSUPPORTED_CONTAINER)
    }

    if ((containerType === 'webm') && !initSegmentReference) {
      console.error(
        'SegmentBase does not contain sufficient segment information:',
        'the SegmentBase uses a WebM container,',
        'but does not contain an Initialization element.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_WEBM_MISSING_INIT)
    }
  }

  /* *
   * Generate a SegmentIndex from a Context object.
   *
   * @param {DashParser.Context} context
   * @param {DashParser.RequestInitSegmentCallback}
   *     requestInitSegment
   * @param {InitSegmentReference} initSegmentReference
   * @param {number} scaledPresentationTimeOffset
   * @return {!Promise.<SegmentIndex>}
   * @private
   */
  static generateSegmentIndex_(
    context, requestInitSegment, initSegmentReference,
    scaledPresentationTimeOffset) {
    const SegmentBase = SegmentBase

    const indexUris = SegmentBase.computeIndexUris_(context)
    const indexRange = SegmentBase.computeIndexRange_(context)
    console.assert(indexRange, 'Index range should not be null!')

    return SegmentBase.generateSegmentIndexFromUris(
      context, requestInitSegment, initSegmentReference, indexUris,
      indexRange.start, indexRange.end,
      scaledPresentationTimeOffset)
  }
}
