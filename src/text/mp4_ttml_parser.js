import TextEngine from './text_engine'
import TtmlTextParser from './ttml_text_parser'
import Error from '../util/error'
import Mp4Parser from '../util/mp4_parser'

/**
 * @implements {shaka.extern.TextParser}
 * @export
 */
export default class Mp4TtmlParser {
  constructor() {
    /**
     * @type {!shaka.extern.TextParser}
     * @private
     */
    this.parser_ = new TtmlTextParser()
  }

  /**
   * @override
   * @export
   */
  parseInit(data) {
    let sawSTPP = false

    new Mp4Parser()
      .box('moov', Mp4Parser.children)
      .box('trak', Mp4Parser.children)
      .box('mdia', Mp4Parser.children)
      .box('minf', Mp4Parser.children)
      .box('stbl', Mp4Parser.children)
      .fullBox('stsd', Mp4Parser.sampleDescription)
      .box('stpp', (box) => {
        sawSTPP = true
        box.parser.stop()
      }).parse(data)

    if (!sawSTPP) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.TEXT,
        Error.Code.INVALID_MP4_TTML)
    }
  }

  /**
   * @override
   * @export
   */
  parseMedia(data, time) {
    const Mp4Parser = Mp4Parser

    let sawMDAT = false
    let payload = []

    const parser = new Mp4Parser()
      .box('mdat', Mp4Parser.allData((data) => {
        sawMDAT = true
        // Join this to any previous payload, in case the mp4 has multiple
        // mdats.
        payload = payload.concat(this.parser_.parseMedia(data, time))
      }))
    parser.parse(data, /* partialOkay= */ false)

    if (!sawMDAT) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.TEXT,
        Error.Code.INVALID_MP4_TTML)
    }

    return payload
  }
}
TextEngine.registerParser(
  'application/mp4; codecs="stpp"', () => new Mp4TtmlParser())
TextEngine.registerParser(
  'application/mp4; codecs="stpp.ttml.im1t"',
  () => new Mp4TtmlParser())
// Legacy codec string uses capital 'TTML', i.e.: prior to HLS rfc8216bis:
//   Note that if a Variant Stream specifies one or more Renditions that
//   include IMSC subtitles, the CODECS attribute MUST indicate this with a
//   format identifier such as 'stpp.ttml.im1t'.
// (https://tools.ietf.org/html/draft-pantos-hls-rfc8216bis-05#section-4.4.5.2)
TextEngine.registerParser(
  'application/mp4; codecs="stpp.TTML.im1t"',
  () => new Mp4TtmlParser())
