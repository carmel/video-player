import { Cue } from './cue'
import TextEngine from './text_engine'
import VttTextParser from './vtt_text_parser'
import DataViewReader from '../util/data_view_reader'
import Error from '../util/error'
import Functional from '../util/functional'
import Iterables from '../util/iterables'
import Mp4Parser from '../util/mp4_parser'
import StringUtils from '../util/string_utils'
import TextParser from '../util/text_parser'

/**
 * @implements {shaka.extern.TextParser}
 * @export
 */
export default class Mp4VttParser {
  constructor() {
    /**
     * The current time scale used by the VTT parser.
     *
     * @type {?number}
     * @private
     */
    this.timescale_ = null
  }

  /**
   * @override
   * @export
   */
  parseInit(data) {
    const Mp4Parser = Mp4Parser

    let sawWVTT = false

    new Mp4Parser()
      .box('moov', Mp4Parser.children)
      .box('trak', Mp4Parser.children)
      .box('mdia', Mp4Parser.children)
      .fullBox('mdhd', (box) => {
        console.assert(
          box.version === 0 || box.version === 1,
          'MDHD version can only be 0 or 1')
        if (box.version === 0) {
          box.reader.skip(4) // Skip 'creation_time'.
          box.reader.skip(4) // Skip 'modification_time'.
          this.timescale_ = box.reader.readUint32()
          box.reader.skip(4) // Skip 'duration'.
        } else {
          box.reader.skip(8) // Skip 'creation_time'.
          box.reader.skip(8) // Skip 'modification_time'.
          this.timescale_ = box.reader.readUint32()
          box.reader.skip(8) // Skip 'duration'.
        }
        box.reader.skip(4) // Skip 'pad', 'language', and 'pre-defined'.
      })
      .box('minf', Mp4Parser.children)
      .box('stbl', Mp4Parser.children)
      .fullBox('stsd', Mp4Parser.sampleDescription)
      .box('wvtt', (box) => {
        // A valid vtt init segment, though we have no actual subtitles yet.
        sawWVTT = true
      }).parse(data)

    if (!this.timescale_) {
      // Missing timescale for VTT content. It should be located in the MDHD.
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.TEXT,
        Error.Code.INVALID_MP4_VTT)
    }

    if (!sawWVTT) {
      // A WVTT box should have been seen (a valid vtt init segment with no
      // actual subtitles).
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.TEXT,
        Error.Code.INVALID_MP4_VTT)
    }
  }

  /**
   * @override
   * @export
   */
  parseMedia(data, time) {
    if (!this.timescale_) {
      // Missing timescale for VTT content. We should have seen the init
      // segment.
      console.error('No init segment for MP4+VTT!')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.TEXT,
        Error.Code.INVALID_MP4_VTT)
    }

    const Mp4VttParser = Mp4VttParser
    const Mp4Parser = Mp4Parser

    let baseTime = 0
    /** @type {!Array.<Mp4VttParser.TimeSegment>} */
    let presentations = []
    /** @type {!Uint8Array} */
    let rawPayload
    /** @type {!Array.<Cue>} */
    const cues = []

    let sawTFDT = false
    let sawTRUN = false
    let sawMDAT = false
    let defaultDuration = null

    const parser = new Mp4Parser()
      .box('moof', Mp4Parser.children)
      .box('traf', Mp4Parser.children)
      .fullBox('tfdt', (box) => {
        sawTFDT = true
        console.assert(
          box.version === 0 || box.version === 1,
          'TFDT version can only be 0 or 1')
        baseTime = (box.version === 0) ? box.reader.readUint32()
          : box.reader.readUint64()
      })
      .fullBox('tfhd', (box) => {
        console.assert(
          box.flags != null,
          'A TFHD box should have a valid flags value')
        defaultDuration = Mp4VttParser.parseTFHD_(box.flags, box.reader)
      })
      .fullBox('trun', (box) => {
        sawTRUN = true
        console.assert(
          box.version != null,
          'A TRUN box should have a valid version value')
        console.assert(
          box.flags != null,
          'A TRUN box should have a valid flags value')
        presentations =
              Mp4VttParser.parseTRUN_(box.version, box.flags, box.reader)
      })
      .box('mdat', Mp4Parser.allData((data) => {
        console.assert(
          !sawMDAT,
          'VTT cues in mp4 with multiple MDAT are not currently supported')
        sawMDAT = true
        rawPayload = data
      }))
    parser.parse(data, /* partialOkay= */ false)

    if (!sawMDAT && !sawTFDT && !sawTRUN) {
      // A required box is missing.
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.TEXT,
        Error.Code.INVALID_MP4_VTT)
    }

    let currentTime = baseTime

    /** @type {!DataViewReader} */
    const reader = new DataViewReader(
      rawPayload, DataViewReader.Endianness.BIG_ENDIAN)

    for (const presentation of presentations) {
      // If one presentation corresponds to multiple payloads, it is assumed
      // that all of those payloads have the same start time and duration.
      const duration = presentation.duration || defaultDuration
      const startTime = presentation.timeOffset
        ? baseTime + presentation.timeOffset
        : currentTime
      currentTime = startTime + (duration || 0)

      // Read samples until it adds up to the given size.
      let totalSize = 0
      do {
        // Read the payload size.
        const payloadSize = reader.readUint32()
        totalSize += payloadSize

        // Skip the type.
        const payloadType = reader.readUint32()
        const payloadName = Mp4Parser.typeToString(payloadType)

        // Read the data payload.
        /** @type {Uint8Array} */
        let payload = null
        if (payloadName === 'vttc') {
          if (payloadSize > 8) {
            payload = reader.readBytes(payloadSize - 8)
          }
        } else if (payloadName === 'vtte') {
          // It's a vtte, which is a vtt cue that is empty. Ignore any data that
          // does exist.
          reader.skip(payloadSize - 8)
        } else {
          console.error('Unknown box ' + payloadName + '! Skipping!')
          reader.skip(payloadSize - 8)
        }

        if (duration) {
          if (payload) {
            console.assert(
              this.timescale_ != null, 'Timescale should not be null!')
            const cue = Mp4VttParser.parseVTTC_(
              payload,
              time.periodStart + startTime / this.timescale_,
              time.periodStart + currentTime / this.timescale_)
            cues.push(cue)
          }
        } else {
          console.error(
            'WVTT sample duration unknown, and no default found!')
        }

        console.assert(
          !presentation.sampleSize || totalSize <= presentation.sampleSize,
          'The samples do not fit evenly into the sample sizes given in ' +
            'the TRUN box!')

        // If no sampleSize was specified, it's assumed that this presentation
        // corresponds to only a single cue.
      } while (presentation.sampleSize &&
               (totalSize < presentation.sampleSize))
    }

    console.assert(
      !reader.hasMoreData(),
      'MDAT which contain VTT cues and non-VTT data are not currently ' +
        'supported!')

    return /** @type {!Array.<!shaka.extern.Cue>} */ (
      cues.filter(Functional.isNotNull))
  }

  /**
   * @param {number} flags
   * @param {!DataViewReader} reader
   * @return {?number} The default_sample_duration field, if present.
   * @private
   */
  static parseTFHD_(flags, reader) {
    // Skip 'track_ID'.
    reader.skip(4)

    // Skip 'base_data_offset' if present.
    if (flags & 0x000001) {
      reader.skip(8)
    }

    // Skip 'sample_description_index' if present.
    if (flags & 0x000002) {
      reader.skip(4)
    }

    // Read and return 'default_sample_duration' if present.
    if (flags & 0x000008) {
      return reader.readUint32()
    }

    // There is no 'default_sample_duration'.
    return null
  }

  /**
   * @param {number} version
   * @param {number} flags
   * @param {!DataViewReader} reader
   * @return {!Array.<Mp4VttParser.TimeSegment>}
   * @private
   */
  static parseTRUN_(version, flags, reader) {
    const sampleCount = reader.readUint32()

    // Skip 'data_offset' if present.
    if (flags & 0x000001) {
      reader.skip(4)
    }

    // Skip 'first_sample_flags' if present.
    if (flags & 0x000004) {
      reader.skip(4)
    }

    const samples = []

    for (const _ of Iterables.range(sampleCount)) {
      Functional.ignored(_)
      /** @type {Mp4VttParser.TimeSegment} */
      const sample = {
        duration: null,
        sampleSize: null,
        timeOffset: null
      }

      // Read 'sample duration' if present.
      if (flags & 0x000100) {
        sample.duration = reader.readUint32()
      }

      // Read 'sample_size' if present.
      if (flags & 0x000200) {
        sample.sampleSize = reader.readUint32()
      }

      // Skip 'sample_flags' if present.
      if (flags & 0x000400) {
        reader.skip(4)
      }

      // Read 'sample_time_offset' if present.
      if (flags & 0x000800) {
        sample.timeOffset = version === 0
          ? reader.readUint32()
          : reader.readInt32()
      }

      samples.push(sample)
    }

    return samples
  }

  /**
   * Parses a vttc box into a cue.
   *
   * @param {!Uint8Array} data
   * @param {number} startTime
   * @param {number} endTime
   * @return {Cue}
   * @private
   */
  static parseVTTC_(data, startTime, endTime) {
    let payload
    let id
    let settings

    new Mp4Parser()
      .box('payl', Mp4Parser.allData((data) => {
        payload = StringUtils.fromUTF8(data)
      }))
      .box('iden', Mp4Parser.allData((data) => {
        id = StringUtils.fromUTF8(data)
      }))
      .box('sttg', Mp4Parser.allData((data) => {
        settings = StringUtils.fromUTF8(data)
      }))
      .parse(data)

    if (payload) {
      return Mp4VttParser.assembleCue_(
        payload, id, settings, startTime, endTime)
    } else {
      return null
    }
  }

  /**
   * Take the individual components that make a cue and create a vttc cue.
   *
   * @param {string} payload
   * @param {?string} id
   * @param {?string} settings
   * @param {number} startTime
   * @param {number} endTime
   * @return {!Cue}
   * @private
   */
  static assembleCue_(payload, id, settings, startTime, endTime) {
    const cue = new Cue(startTime, endTime, payload)

    if (id) {
      cue.id = id
    }

    if (settings) {
      const parser = new TextParser(settings)

      let word = parser.readWord()

      while (word) {
        // TODO: Check WebVTTConfigurationBox for region info.
        if (!VttTextParser.parseCueSetting(
          cue, word, /* VTTRegions= */[])) {
          console.warning(
            'VTT parser encountered an invalid VTT setting: ', word,
            ' The setting will be ignored.')
        }

        parser.skipWhitespace()
        word = parser.readWord()
      }
    }

    return cue
  }
}

/**
 * @typedef {{
 *    duration: ?number,
 *    sampleSize: ?number,
 *    timeOffset: ?number
 *  }}
 *
 * @property {?number} duration
 *    The length of the segment in timescale units.
 * @property {?number} sampleSize
 *    The size of the segment in bytes.
 * @property {?number} timeOffset
 *    The time since the start of the segment in timescale units. Time
 *    offset is based of the start of the segment. If this value is
 *    missing, the accumated durations preceeding this time segment will
 *    be used to create the start time.
 */
Mp4VttParser.TimeSegment

TextEngine.registerParser(
  'application/mp4; codecs="wvtt"', () => new Mp4VttParser())
