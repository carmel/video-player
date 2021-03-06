
import { NetworkingEngine } from '../net/networking_engine'
import AbortableOperation from '../util/abortable_operation'
import Error from '../util/error'
import Functional from '../util/functional'
import Iterables from '../util/iterables'
import ManifestParserUtils from '../util/manifest_parser_utils'
import XmlUtils from '../util/xml_utils'

/* *
 * @summary MPD processing utility functions.
 */
export default class MpdUtils {
  /* *
   * Fills a SegmentTemplate URI template.  This function does not validate the
   * resulting URI.
   *
   * @param {string} uriTemplate
   * @param {?string} representationId
   * @param {?number} number
   * @param {?number} bandwidth
   * @param {?number} time
   * @return {string} A URI string.
   * @see ISO/IEC 23009-1:2014 section 5.3.9.4.4
   */
  static fillUriTemplate(
    uriTemplate, representationId, number, bandwidth, time) {
    /* * @type {!Object.<string, ?number|?string>} */
    const valueTable = {
      'RepresentationID': representationId,
      'Number': number,
      'Bandwidth': bandwidth,
      'Time': time
    }

    const re = /\$(RepresentationID|Number|Bandwidth|Time)?(?:%0([0-9]+)([diouxX]))?\$/g // eslint-disable-line max-len
    const uri = uriTemplate.replace(re, (match, name, widthStr, format) => {
      if (match === '$$') {
        return '$'
      }

      let value = valueTable[name]
      console.assert(value !== undefined, 'Unrecognized identifier')

      // Note that |value| may be 0 or ''.
      if (value === null) {
        console.warning(`URL template does not have an available substitution for identifier ${name}: ${uriTemplate}`)
        return match
      }

      if (name === 'RepresentationID' && widthStr) {
        console.warning(`URL template should not contain a width specifier for identifier RepresentationID: ${uriTemplate}`)
        widthStr = undefined
      }

      if (name === 'Time') {
        console.assert(Math.abs(value - Math.round(value)) < 0.2,
          'Calculated $Time$ values must be close to integers')
        value = Math.round(value)
      }

      /* * @type {string} */
      let valueString
      switch (format) {
        case undefined: // Happens if there is no format specifier.
        case 'd':
        case 'i':
        case 'u':
          valueString = value.toString()
          break
        case 'o':
          valueString = value.toString(8)
          break
        case 'x':
          valueString = value.toString(16)
          break
        case 'X':
          valueString = value.toString(16).toUpperCase()
          break
        default:
          console.assert(false, 'Unhandled format specifier')
          valueString = value.toString()
          break
      }

      // Create a padding string.
      const width = parseInt(widthStr, 10) || 1
      const paddingSize = Math.max(0, width - valueString.length)
      const padding = (new Array(paddingSize + 1)).join('0')

      return padding + valueString
    })

    return uri
  }

  /* *
   * Expands a SegmentTimeline into an array-based timeline.  The results are in
   * seconds.
   *
   * @param {!Element} segmentTimeline
   * @param {number} timescale
   * @param {number} unscaledPresentationTimeOffset
   * @param {number} periodDuration The Period's duration in seconds.
   *   Infinity indicates that the Period continues indefinitely.
   * @return {!Array.<MpdUtils.TimeRange>}
   */
  static createTimeline(
    segmentTimeline, timescale, unscaledPresentationTimeOffset,
    periodDuration) {
    console.assert(
      timescale > 0 && timescale < Infinity,
      'timescale must be a positive, finite integer')
    console.assert(
      periodDuration > 0, 'period duration must be a positive integer')

    const timePoints = XmlUtils.findChildren(segmentTimeline, 'S')

    /* * @type {!Array.<MpdUtils.TimeRange>} */
    const timeline = []
    let lastEndTime = 0

    const enumerate = (it) => Iterables.enumerate(it)
    for (const { item: timePoint, next } of enumerate(timePoints)) {
      let t = XmlUtils.parseAttr(timePoint, 't', XmlUtils.parseNonNegativeInt)
      const d =
          XmlUtils.parseAttr(timePoint, 'd', XmlUtils.parseNonNegativeInt)
      const r = XmlUtils.parseAttr(timePoint, 'r', XmlUtils.parseInt)

      // Adjust the start time to account for the presentation time offset.
      if (t != null) {
        t -= unscaledPresentationTimeOffset
      }

      if (!d) {
        console.warning(`'S' element must have a duration: ${timePoint} ignoring the remaining 'S' elements.`)
        return timeline
      }

      let startTime = t != null ? t : lastEndTime

      let repeat = r || 0
      if (repeat < 0) {
        if (next) {
          const nextStartTime =
              XmlUtils.parseAttr(next, 't', XmlUtils.parseNonNegativeInt)
          if (nextStartTime === null) {
            console.warning(`An 'S' element cannot have a negative repeat if the next 'S' element does not have a valid start time: ${timePoint} ignoring the remaining 'S elements.`)
            return timeline
          } else if (startTime >= nextStartTime) {
            console.warning(`An 'S' element cannot have a negative repeatif its start 'time exceeds the next 'S' element's start time: ${timePoint} ignoring the remaining 'S' elements.`)
            return timeline
          }
          repeat = Math.ceil((nextStartTime - startTime) / d) - 1
        } else {
          if (periodDuration === Infinity) {
            // The DASH spec. actually allows the last 'S' element to have a
            // negative repeat value even when the Period has an infinite
            // duration.  No one uses this feature and no one ever should,
            // ever.
            console.warning(`The last 'S' element cannot have a negative repeat if the Period has an infinite duration: ${timePoint} ignoring the last 'S' element.`)
            return timeline
          } else if (startTime / timescale >= periodDuration) {
            console.warning(`The last 'S' element cannot have a negative repeat if its start time exceeds the Period's duration: ${timePoint} igoring the last 'S' element.`)
            return timeline
          }
          repeat = Math.ceil((periodDuration * timescale - startTime) / d) - 1
        }
      }

      // The end of the last segment may be before the start of the current
      // segment (a gap) or after the start of the current segment (an
      // overlap). If there is a gap/overlap then stretch/compress the end of
      // the last segment to the start of the current segment.
      //
      // Note: it is possible to move the start of the current segment to the
      // end of the last segment, but this would complicate the computation of
      // the $Time$ placeholder later on.
      if ((timeline.length > 0) && (startTime !== lastEndTime)) {
        const delta = startTime - lastEndTime

        if (Math.abs(delta / timescale) >=
            ManifestParserUtils.GAP_OVERLAP_TOLERANCE_SECONDS) {
          console.warning(`SegmentTimeline contains a large gap/overlap: ${timePoint} the content may have errors in it.`)
        }

        timeline[timeline.length - 1].end = startTime / timescale
      }

      for (const _ of Iterables.range(repeat + 1)) {
        Functional.ignored(_)
        const endTime = startTime + d
        const item = {
          start: startTime / timescale,
          end: endTime / timescale,
          unscaledStart: startTime
        }
        timeline.push(item)

        startTime = endTime
        lastEndTime = endTime
      }
    }

    return timeline
  }

  /* *
   * Parses common segment info for SegmentList and SegmentTemplate.
   *
   * @param {DashParser.Context} context
   * @param {function(?DashParser.InheritanceFrame):Element} callback
   *   Gets the element that contains the segment info.
   * @return {MpdUtils.SegmentInfo}
   */
  static parseSegmentInfo(context, callback) {
    console.assert(
      callback(context.representation),
      'There must be at least one element of the given type.')
    const MpdUtils = MpdUtils
    const XmlUtils = XmlUtils

    const timescaleStr =
        MpdUtils.inheritAttribute(context, callback, 'timescale')
    let timescale = 1
    if (timescaleStr) {
      timescale = XmlUtils.parsePositiveInt(timescaleStr) || 1
    }

    const durationStr =
        MpdUtils.inheritAttribute(context, callback, 'duration')
    let segmentDuration = XmlUtils.parsePositiveInt(durationStr || '')
    if (segmentDuration) {
      segmentDuration /= timescale
    }

    const startNumberStr =
        MpdUtils.inheritAttribute(context, callback, 'startNumber')
    const unscaledPresentationTimeOffset =
        Number(MpdUtils.inheritAttribute(context, callback,
          'presentationTimeOffset')) || 0
    let startNumber = XmlUtils.parseNonNegativeInt(startNumberStr || '')
    if (startNumberStr === null || startNumber === null) {
      startNumber = 1
    }

    const timelineNode =
        MpdUtils.inheritChild(context, callback, 'SegmentTimeline')
    /* * @type {Array.<MpdUtils.TimeRange>} */
    let timeline = null
    if (timelineNode) {
      timeline = MpdUtils.createTimeline(
        timelineNode, timescale, unscaledPresentationTimeOffset,
        context.periodInfo.duration || Infinity)
    }

    const scaledPresentationTimeOffset =
        (unscaledPresentationTimeOffset / timescale) || 0
    return {
      timescale: timescale,
      segmentDuration: segmentDuration,
      startNumber: startNumber,
      scaledPresentationTimeOffset: scaledPresentationTimeOffset,
      unscaledPresentationTimeOffset: unscaledPresentationTimeOffset,
      timeline: timeline
    }
  }

  /* *
   * Searches the inheritance for a Segment* with the given attribute.
   *
   * @param {DashParser.Context} context
   * @param {function(?DashParser.InheritanceFrame):Element} callback
   *   Gets the Element that contains the attribute to inherit.
   * @param {string} attribute
   * @return {?string}
   */
  static inheritAttribute(context, callback, attribute) {
    const Functional = Functional
    console.assert(
      callback(context.representation),
      'There must be at least one element of the given type')

    /* * @type {!Array.<!Element>} */
    const nodes = [
      callback(context.representation),
      callback(context.adaptationSet),
      callback(context.period)
    ].filter(Functional.isNotNull)

    return nodes
      .map((s) => { return s.getAttribute(attribute) })
      .reduce((all, part) => { return all || part })
  }

  /* *
   * Searches the inheritance for a Segment* with the given child.
   *
   * @param {DashParser.Context} context
   * @param {function(?DashParser.InheritanceFrame):Element} callback
   *   Gets the Element that contains the child to inherit.
   * @param {string} child
   * @return {Element}
   */
  static inheritChild(context, callback, child) {
    const Functional = Functional
    console.assert(
      callback(context.representation),
      'There must be at least one element of the given type')

    /* * @type {!Array.<!Element>} */
    const nodes = [
      callback(context.representation),
      callback(context.adaptationSet),
      callback(context.period)
    ].filter(Functional.isNotNull)

    const XmlUtils = XmlUtils
    return nodes
      .map((s) => { return XmlUtils.findChild(s, child) })
      .reduce((all, part) => { return all || part })
  }

  /* *
   * Follow the xlink link contained in the given element.
   * It also strips the xlink properties off of the element,
   * even if the process fails.
   *
   * @param {!Element} element
   * @param {!shaka.extern.RetryParameters} retryParameters
   * @param {boolean} failGracefully
   * @param {string} baseUri
   * @param {!NetworkingEngine} networkingEngine
   * @param {number} linkDepth
   * @return {!AbortableOperation.<!Element>}
   * @private
   */
  static handleXlinkInElement_(
    element, retryParameters, failGracefully, baseUri, networkingEngine,
    linkDepth) {
    const MpdUtils = MpdUtils
    const XmlUtils = XmlUtils
    const ManifestParserUtils = ManifestParserUtils
    const NS = MpdUtils.XlinkNamespaceUri_

    const xlinkHref = XmlUtils.getAttributeNS(element, NS, 'href')
    const xlinkActuate =
        XmlUtils.getAttributeNS(element, NS, 'actuate') || 'onRequest'

    // Remove the xlink properties, so it won't download again
    // when re-processed.
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.namespaceURI === NS) {
        element.removeAttributeNS(attribute.namespaceURI, attribute.localName)
      }
    }

    if (linkDepth >= 5) {
      return AbortableOperation.failed(new Error(
        Error.Severity.CRITICAL, Error.Category.MANIFEST,
        Error.Code.DASH_XLINK_DEPTH_LIMIT))
    }

    if (xlinkActuate !== 'onLoad') {
      // Only xlink:actuate='onLoad' is supported.
      // When no value is specified, the assumed value is 'onRequest'.
      return AbortableOperation.failed(new Error(
        Error.Severity.CRITICAL, Error.Category.MANIFEST,
        Error.Code.DASH_UNSUPPORTED_XLINK_ACTUATE))
    }

    // Resolve the xlink href, in case it's a relative URL.
    const uris = ManifestParserUtils.resolveUris([baseUri], [xlinkHref])

    // Load in the linked elements.
    const requestType = NetworkingEngine.RequestType.MANIFEST
    const request =
        NetworkingEngine.makeRequest(uris, retryParameters)

    const requestOperation = networkingEngine.request(requestType, request)
    // The interface is abstract, but we know it was implemented with the
    // more capable internal class.
    console.assert(
      requestOperation instanceof AbortableOperation,
      'Unexpected implementation of IAbortableOperation!')
    // Satisfy the compiler with a cast.
    const networkOperation =
    /* * @type {!AbortableOperation.<shaka.extern.Response>} */ (
        requestOperation)

    // Chain onto that operation.
    return networkOperation.chain(
      (response) => {
        // This only supports the case where the loaded xml has a single
        // top-level element.  If there are multiple roots, it will be
        // rejected.
        const rootElem =
          XmlUtils.parseXml(response.data, element.tagName)
        if (!rootElem) {
          // It was not valid XML.
          return AbortableOperation.failed(new Error(
            Error.Severity.CRITICAL, Error.Category.MANIFEST,
            Error.Code.DASH_INVALID_XML, xlinkHref))
        }

        // Now that there is no other possibility of the process erroring,
        // the element can be changed further.

        // Remove the current contents of the node.
        while (element.childNodes.length) {
          element.removeChild(element.childNodes[0])
        }

        // Move the children of the loaded xml into the current element.
        while (rootElem.childNodes.length) {
          const child = rootElem.childNodes[0]
          rootElem.removeChild(child)
          element.appendChild(child)
        }

        // Move the attributes of the loaded xml into the current element.
        for (const attribute of Array.from(rootElem.attributes)) {
          element.setAttributeNode(attribute.cloneNode(/*  deep= */ false))
        }

        return MpdUtils.processXlinks(
          element, retryParameters, failGracefully, uris[0],
          networkingEngine, linkDepth + 1)
      })
  }

  /* *
   * Filter the contents of a node recursively, replacing xlink links
   * with their associated online data.
   *
   * @param {!Element} element
   * @param {!shaka.extern.RetryParameters} retryParameters
   * @param {boolean} failGracefully
   * @param {string} baseUri
   * @param {!NetworkingEngine} networkingEngine
   * @param {number=} linkDepth, default set to 0
   * @return {!AbortableOperation.<!Element>}
   */
  static processXlinks(
    element, retryParameters, failGracefully, baseUri, networkingEngine,
    linkDepth = 0) {
    const MpdUtils = MpdUtils
    const XmlUtils = XmlUtils
    const NS = MpdUtils.XlinkNamespaceUri_

    if (XmlUtils.getAttributeNS(element, NS, 'href')) {
      let handled = MpdUtils.handleXlinkInElement_(
        element, retryParameters, failGracefully, baseUri, networkingEngine,
        linkDepth)
      if (failGracefully) {
        // Catch any error and go on.
        handled = handled.chain(undefined, (error) => {
          error && console.log(error)
          // handleXlinkInElement_ strips the xlink properties off of the
          // element even if it fails, so calling processXlinks again will
          // handle whatever contents the element natively has.
          return MpdUtils.processXlinks(
            element, retryParameters, failGracefully, baseUri,
            networkingEngine, linkDepth)
        })
      }
      return handled
    }

    const childOperations = []
    for (const child of Array.from(element.childNodes)) {
      if (child instanceof Element) {
        const resolveToZeroString = 'urn:mpeg:dash:resolve-to-zero:2013'
        if (XmlUtils.getAttributeNS(child, NS, 'href') === resolveToZeroString) {
          // This is a 'resolve to zero' code; it means the element should
          // be removed, as specified by the mpeg-dash rules for xlink.
          element.removeChild(child)
        } else if (child.tagName !== 'SegmentTimeline') {
          // Don't recurse into a SegmentTimeline since xlink attributes
          // aren't valid in there and looking at each segment can take a long
          // time with larger manifests.

          // Replace the child with its processed form.
          childOperations.push(MpdUtils.processXlinks(
            /* * @type {!Element} */ (child), retryParameters, failGracefully,
            baseUri, networkingEngine, linkDepth))
        }
      }
    }

    return AbortableOperation.all(childOperations).chain(() => {
      return element
    })
  }
}

MpdUtils.XlinkNamespaceUri_ = 'http://www.w3.org/1999/xlink'
/* *
 * @typedef {{
 *   start: number,
 *   unscaledStart: number,
 *   end: number
 * }}
 *
 * @description
 * Defines a time range of a media segment.  Times are in seconds.
 *
 * @property {number} start
 *   The start time of the range.
 * @property {number} unscaledStart
 *   The start time of the range in representation timescale units.
 * @property {number} end
 *   The end time (exclusive) of the range.
 */
MpdUtils.TimeRange
/* *
 * @typedef {{
 *   timescale: number,
 *   segmentDuration: ?number,
 *   startNumber: number,
 *   scaledPresentationTimeOffset: number,
 *   unscaledPresentationTimeOffset: number,
 *   timeline: Array.<MpdUtils.TimeRange>
 * }}
 *
 * @description
 * Contains common information between SegmentList and SegmentTemplate items.
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
 */
MpdUtils.SegmentInfo

