import MpdUtils from './mpd_utils'
import SegmentBase from './segment_base'
import { InitSegmentReference, SegmentReference } from '../media/segment_reference'
import SegmentIndex from '../media/segment_index'
import Error from '../util/error'
import Iterables from '../util/iterables'
import ManifestParserUtils from '../util/manifest_parser_utils'
import ObjectUtils from '../util/object_utils'

/**
 * @summary A set of functions for parsing SegmentTemplate elements.
 */
export default class SegmentTemplate {
  /**
   * Creates a new StreamInfo object.
   * Updates the existing SegmentIndex, if any.
   *
   * @param {DashParser.Context} context
   * @param {DashParser.RequestInitSegmentCallback}
   *   requestInitSegment
   * @param {!Object.<string, !SegmentIndex>} segmentIndexMap
   * @param {boolean} isUpdate True if the manifest is being updated.
   * @param {number} segmentLimit The maximum number of segments to generate for
   *   a SegmentTemplate with fixed duration.
   * @return {DashParser.StreamInfo}
   */
  static createStreamInfo(
    context, requestInitSegment, segmentIndexMap, isUpdate,
    segmentLimit) {
    console.assert(context.representation.segmentTemplate,
      'Should only be called with SegmentTemplate')
    const SegmentTemplate = SegmentTemplate

    const initSegmentReference = SegmentTemplate.createInitSegment_(context)
    const info = SegmentTemplate.parseSegmentTemplateInfo_(context)

    SegmentTemplate.checkSegmentTemplateInfo_(context, info)

    // Direct fields of context will be reassigned by the parser before
    // generateSegmentIndex is called.  So we must make a shallow copy first,
    // and use that in the generateSegmentIndex callbacks.
    const shallowCopyOfContext =
        ObjectUtils.shallowCloneObject(context)

    if (info.indexTemplate) {
      SegmentBase.checkSegmentIndexSupport(
        context, initSegmentReference)

      return {
        generateSegmentIndex: () => {
          return SegmentTemplate.generateSegmentIndexFromIndexTemplate_(
            shallowCopyOfContext, requestInitSegment, initSegmentReference,
            info)
        }
      }
    } else if (info.segmentDuration) {
      if (!isUpdate) {
        context.presentationTimeline.notifyMaxSegmentDuration(
          info.segmentDuration)
        context.presentationTimeline.notifyMinSegmentStartTime(
          context.periodInfo.start)
      }

      return {
        generateSegmentIndex: () => {
          return SegmentTemplate.generateSegmentIndexFromDuration_(
            shallowCopyOfContext, info, segmentLimit, initSegmentReference)
        }
      }
    } else {
      /** @type {SegmentIndex} */
      let segmentIndex = null
      let id = null
      if (context.period.id && context.representation.id) {
        // Only check/store the index if period and representation IDs are set.
        id = context.period.id + ',' + context.representation.id
        segmentIndex = segmentIndexMap[id]
      }

      const references = SegmentTemplate.createFromTimeline_(
        context, info, initSegmentReference)

      // Don't fit live content, since it might receive more segments.
      // Unless that live content is multi-period; it's safe to fit every period
      // but the last one, since only the last period might receive new
      // segments.
      const shouldFit = !context.dynamic || !context.periodInfo.isLastPeriod
      const periodStart = context.periodInfo.start
      const periodEnd = context.periodInfo.duration
        ? context.periodInfo.start + context.periodInfo.duration : Infinity

      if (segmentIndex) {
        if (shouldFit) {
          // Fit the new references before merging them, so that the merge
          // algorithm has a more accurate view of their start and end times.
          const wrapper = new SegmentIndex(references)
          wrapper.fit(periodStart, periodEnd)
        }

        segmentIndex.merge(references)
        segmentIndex.evict(
          context.presentationTimeline.getSegmentAvailabilityStart())
      } else {
        context.presentationTimeline.notifySegments(references)
        segmentIndex = new SegmentIndex(references)
        if (id && context.dynamic) {
          segmentIndexMap[id] = segmentIndex
        }
      }

      if (shouldFit) {
        segmentIndex.fit(periodStart, periodEnd)
      }

      return {
        generateSegmentIndex: () => Promise.resolve(segmentIndex)
      }
    }
  }

  /**
   * @param {?DashParser.InheritanceFrame} frame
   * @return {Element}
   * @private
   */
  static fromInheritance_(frame) {
    return frame.segmentTemplate
  }

  /**
   * Parses a SegmentTemplate element into an info object.
   *
   * @param {DashParser.Context} context
   * @return {SegmentTemplate.SegmentTemplateInfo}
   * @private
   */
  static parseSegmentTemplateInfo_(context) {
    const SegmentTemplate = SegmentTemplate
    const MpdUtils = MpdUtils
    const segmentInfo =
        MpdUtils.parseSegmentInfo(context, SegmentTemplate.fromInheritance_)

    const media = MpdUtils.inheritAttribute(
      context, SegmentTemplate.fromInheritance_, 'media')
    const index = MpdUtils.inheritAttribute(
      context, SegmentTemplate.fromInheritance_, 'index')

    return {
      segmentDuration: segmentInfo.segmentDuration,
      timescale: segmentInfo.timescale,
      startNumber: segmentInfo.startNumber,
      scaledPresentationTimeOffset: segmentInfo.scaledPresentationTimeOffset,
      unscaledPresentationTimeOffset:
          segmentInfo.unscaledPresentationTimeOffset,
      timeline: segmentInfo.timeline,
      mediaTemplate: media,
      indexTemplate: index
    }
  }

  /**
   * Verifies a SegmentTemplate info object.
   *
   * @param {DashParser.Context} context
   * @param {SegmentTemplate.SegmentTemplateInfo} info
   * @private
   */
  static checkSegmentTemplateInfo_(context, info) {
    let n = 0
    n += info.indexTemplate ? 1 : 0
    n += info.timeline ? 1 : 0
    n += info.segmentDuration ? 1 : 0

    if (n === 0) {
      console.error(
        'SegmentTemplate does not contain any segment information:',
        'the SegmentTemplate must contain either an index URL template',
        'a SegmentTimeline, or a segment duration.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_NO_SEGMENT_INFO)
    } else if (n !== 1) {
      console.warning(
        'SegmentTemplate containes multiple segment information sources:',
        'the SegmentTemplate should only contain an index URL template,',
        'a SegmentTimeline or a segment duration.',
        context.representation)
      if (info.indexTemplate) {
        console.info('Using the index URL template by default.')
        info.timeline = null
        info.segmentDuration = null
      } else {
        console.assert(info.timeline, 'There should be a timeline')
        console.info('Using the SegmentTimeline by default.')
        info.segmentDuration = null
      }
    }

    if (!info.indexTemplate && !info.mediaTemplate) {
      console.error(
        'SegmentTemplate does not contain sufficient segment information:',
        'the SegmentTemplate\'s media URL template is missing.',
        context.representation)
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.DASH_NO_SEGMENT_INFO)
    }
  }

  /**
   * Generates a SegmentIndex from an index URL template.
   *
   * @param {DashParser.Context} context
   * @param {DashParser.RequestInitSegmentCallback}
   *     requestInitSegment
   * @param {InitSegmentReference} init
   * @param {SegmentTemplate.SegmentTemplateInfo} info
   * @return {!Promise.<SegmentIndex>}
   * @private
   */
  static generateSegmentIndexFromIndexTemplate_(
    context, requestInitSegment, init, info) {
    console.assert(info.indexTemplate, 'must be using index template')
    const filledTemplate = MpdUtils.fillUriTemplate(
      info.indexTemplate, context.representation.id,
      null, context.bandwidth || null, null)

    const resolvedUris = ManifestParserUtils.resolveUris(
      context.representation.baseUris, [filledTemplate])

    return SegmentBase.generateSegmentIndexFromUris(
      context, requestInitSegment, init, resolvedUris, 0, null,
      info.scaledPresentationTimeOffset)
  }

  /**
   * Generates a SegmentIndex from fixed-duration segments.
   *
   * @param {DashParser.Context} context
   * @param {SegmentTemplate.SegmentTemplateInfo} info
   * @param {number} segmentLimit The maximum number of segments to generate.
   * @param {InitSegmentReference} initSegmentReference
   * @return {!Promise.<SegmentIndex>}
   * @private
   */
  static generateSegmentIndexFromDuration_(
    context, info, segmentLimit, initSegmentReference) {
    console.assert(info.mediaTemplate,
      'There should be a media template with duration')

    const MpdUtils = MpdUtils
    const ManifestParserUtils = ManifestParserUtils

    const presentationTimeline = context.presentationTimeline

    // Capture valutes that could change as the parsing context moves on to
    // other parts of the manifest.
    const periodStart = context.periodInfo.start
    const periodDuration = context.periodInfo.duration
    const periodEnd = periodDuration
      ? periodStart + periodDuration : Infinity

    const segmentDuration = info.segmentDuration
    console.assert(
      segmentDuration != null, 'Segment duration must not be null!')

    const startNumber = info.startNumber
    const timescale = info.timescale

    const template = info.mediaTemplate
    const bandwidth = context.bandwidth || null
    const id = context.representation.id
    const baseUris = context.representation.baseUris

    const timestampOffset = periodStart - info.scaledPresentationTimeOffset

    // Computes the range of presentation timestamps both within the period and
    // available.  This is an intersection of the period range and the
    // availability window.
    const computeAvailablePeriodRange = () => {
      return [
        Math.max(
          presentationTimeline.getSegmentAvailabilityStart(),
          periodStart),

        Math.min(
          presentationTimeline.getSegmentAvailabilityEnd(),
          periodEnd)
      ]
    }

    // Computes the range of absolute positions both within the period and
    // available.  The range is inclusive.  These are the positions for which we
    // will generate segment references.
    const computeAvailablePositionRange = () => {
      // In presentation timestamps.
      const availablePresentationTimes = computeAvailablePeriodRange()
      console.assert(availablePresentationTimes.every(isFinite),
        'Available presentation times must be finite!')
      console.assert(availablePresentationTimes.every((x) => x >= 0),
        'Available presentation times must be positive!')

      // In period-relative timestamps.
      const availablePeriodTimes =
          availablePresentationTimes.map((x) => x - periodStart)
      // These may sometimes be reversed ([1] <= [0]) if the period is
      // completely unavailable.  The logic will still work if this happens,
      // because we will simply generate no references.

      // In period-relative positions (0-based).
      const availablePeriodPositions = [
        Math.ceil(availablePeriodTimes[0] / segmentDuration),
        Math.ceil(availablePeriodTimes[1] / segmentDuration) - 1
      ]

      // In absolute positions.
      const availablePresentationPositions =
          availablePeriodPositions.map((x) => x + startNumber)
      return availablePresentationPositions
    }

    // We must limit the initial SegmentIndex in size, to avoid consuming too
    // much CPU or memory for content with gigantic timeShiftBufferDepth (which
    // can have values up to and including Infinity).
    const range = computeAvailablePositionRange()
    const minPosition = Math.max(range[0], range[1] - segmentLimit)
    const maxPosition = range[1]

    const references = []
    const createReference = (position) => {
      // These inner variables are all scoped to the inner loop, and can be used
      // safely in the callback below.

      // Relative to the period start.
      const positionWithinPeriod = position - startNumber
      const segmentPeriodTime = positionWithinPeriod * segmentDuration

      // What will appear in the actual segment files.  The media timestamp is
      // what is expected in the $Time$ template.
      const segmentMediaTime = segmentPeriodTime +
          info.scaledPresentationTimeOffset

      const getUris = () => {
        const mediaUri = MpdUtils.fillUriTemplate(
          template, id, position, bandwidth,
          segmentMediaTime * timescale)
        return ManifestParserUtils.resolveUris(baseUris, [mediaUri])
      }

      // Relative to the presentation.
      const segmentStart = segmentPeriodTime + periodStart
      // Cap the segment end at the period end so that references from the
      // next period will fit neatly after it.
      const segmentEnd = Math.min(segmentStart + segmentDuration, periodEnd)

      // This condition will be true unless the segmentStart was >= periodEnd.
      // If we've done the position calculations correctly, this won't happen.
      console.assert(segmentStart < segmentEnd,
        'Generated a segment outside of the period!')

      return new SegmentReference(
        position,
        segmentStart,
        segmentEnd,
        getUris,
        /* startByte= */ 0,
        /* endByte= */ null,
        initSegmentReference,
        timestampOffset,
        /* appendWindowStart= */ periodStart,
        /* appendWindowEnd= */ periodEnd)
    }

    for (let position = minPosition; position <= maxPosition; ++position) {
      const reference = createReference(position)
      references.push(reference)
    }

    /** @type {SegmentIndex} */
    const segmentIndex = new SegmentIndex(references)

    // If the availability timeline currently ends before the period, we will
    // need to add references over time.
    if (presentationTimeline.getSegmentAvailabilityEnd() < periodEnd) {
      // The period continues to get longer over time, so check for new
      // references once every |segmentDuration| seconds.
      let nextPosition = maxPosition + 1
      segmentIndex.updateEvery(segmentDuration, () => {
        // Evict any references outside the window.
        segmentIndex.evict(presentationTimeline.getSegmentAvailabilityStart())

        // Compute any new references that need to be added.
        // eslint-disable-next-line
        const [_, maxPosition] = computeAvailablePositionRange()
        const references = []
        while (nextPosition <= maxPosition) {
          const reference = createReference(nextPosition)
          references.push(reference)
          nextPosition++
        }
        return references
      })
    }

    return Promise.resolve(segmentIndex)
  }

  /**
   * Creates segment references from a timeline.
   *
   * @param {DashParser.Context} context
   * @param {SegmentTemplate.SegmentTemplateInfo} info
   * @param {InitSegmentReference} initSegmentReference
   * @return {!Array.<!SegmentReference>}
   * @private
   */
  static createFromTimeline_(context, info, initSegmentReference) {
    const MpdUtils = MpdUtils
    const ManifestParserUtils = ManifestParserUtils

    const periodStart = context.periodInfo.start
    const periodDuration = context.periodInfo.duration

    const timestampOffset = periodStart - info.scaledPresentationTimeOffset
    const appendWindowStart = periodStart
    const appendWindowEnd = periodDuration
      ? periodStart + periodDuration : Infinity

    /** @type {!Array.<!SegmentReference>} */
    const references = []
    const enum_ = (it) => Iterables.enumerate(it)
    for (const { i, item: { start, unscaledStart, end }} of enum_(info.timeline)) {
      // Note: i = k - 1, where k indicates the k'th segment listed in the MPD.
      // (See section 5.3.9.5.3 of the DASH spec.)
      const segmentReplacement = i + info.startNumber

      // Consider the presentation time offset in segment uri computation
      const timeReplacement = unscaledStart +
          info.unscaledPresentationTimeOffset
      const repId = context.representation.id
      const bandwidth = context.bandwidth || null
      const createUris =
          () => {
            console.assert(
              info.mediaTemplate,
              'There should be a media template with a timeline')
            const mediaUri = MpdUtils.fillUriTemplate(
              info.mediaTemplate, repId,
              segmentReplacement, bandwidth || null, timeReplacement)
            return ManifestParserUtils
              .resolveUris(context.representation.baseUris, [mediaUri])
              .map((g) => {
                return g.toString()
              })
          }

      references.push(new SegmentReference(
        segmentReplacement,
        periodStart + start,
        periodStart + end,
        createUris,
        /* startByte= */ 0,
        /* endByte= */ null,
        initSegmentReference,
        timestampOffset,
        appendWindowStart,
        appendWindowEnd))
    }

    return references
  }

  /**
   * Creates an init segment reference from a context object.
   *
   * @param {DashParser.Context} context
   * @return {InitSegmentReference}
   * @private
   */
  static createInitSegment_(context) {
    const MpdUtils = MpdUtils
    const ManifestParserUtils = ManifestParserUtils
    const SegmentTemplate = SegmentTemplate

    const initialization = MpdUtils.inheritAttribute(
      context, SegmentTemplate.fromInheritance_, 'initialization')
    if (!initialization) {
      return null
    }

    const repId = context.representation.id
    const bandwidth = context.bandwidth || null
    const baseUris = context.representation.baseUris
    const getUris = () => {
      console.assert(initialization, 'Should have returned earler')
      const filledTemplate = MpdUtils.fillUriTemplate(
        initialization, repId, null, bandwidth, null)
      const resolvedUris = ManifestParserUtils.resolveUris(
        baseUris, [filledTemplate])
      return resolvedUris
    }

    return new InitSegmentReference(getUris, 0, null)
  }
}

/**
 * @typedef {{
 *   timescale: number,
 *   segmentDuration: ?number,
 *   startNumber: number,
 *   scaledPresentationTimeOffset: number,
 *   unscaledPresentationTimeOffset: number,
 *   timeline: Array.<MpdUtils.TimeRange>,
 *   mediaTemplate: ?string,
 *   indexTemplate: ?string
 * }}
 * @private
 *
 * @description
 * Contains information about a SegmentTemplate.
 *
 * @property {number} timescale
 *   The time-scale of the representation.
 * @property {?number} segmentDuration
 *   The duration of the segments in seconds, if given.
 * @property {number} startNumber
 *   The start number of the segments; 1 or greater.
 * @property {number} scaledPresentationTimeOffset
 *   The presentation time offset of the representation, in seconds.
 * @property {number} unscaledPresentationTimeOffset
 *   The presentation time offset of the representation, in timescale units.
 * @property {Array.<MpdUtils.TimeRange>} timeline
 *   The timeline of the representation, if given.  Times in seconds.
 * @property {?string} mediaTemplate
 *   The media URI template, if given.
 * @property {?string} indexTemplate
 *   The index URI template, if given.
 */
SegmentTemplate.SegmentTemplateInfo
