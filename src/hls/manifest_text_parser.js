
import { Attribute, Playlist, PlaylistType, Segment, Tag } from './hls_classes'
import Utils from './hls_utils'
import Error from '../util/error'
import StringUtils from '../util/string_utils'
import TextParser from '../util/text_parser'
import Iterables from '../util/iterables'

/* *
 * HlS manifest text parser.
 */
export default class ManifestTextParser {
  constructor() {
    /* * @private {number} */
    this.globalId_ = 0
  }

  /* *
   * @param {BufferSource} data
   * @param {string} absolutePlaylistUri An absolute, final URI after redirects.
   * @return {!Playlist}
   */
  parsePlaylist(data, absolutePlaylistUri) {
    const MEDIA_PLAYLIST_TAGS =
        ManifestTextParser.MEDIA_PLAYLIST_TAGS
    const SEGMENT_TAGS = ManifestTextParser.SEGMENT_TAGS

    // Get the input as a string.  Normalize newlines to \n.
    let str = StringUtils.fromUTF8(data)
    str = str.replace(/\r\n|\r(?=[^\n]|$)/gm, '\n').trim()

    const lines = str.split(/\n+/m)

    if (!/^#EXTM3U($|[ \t\n])/m.test(lines[0])) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.HLS_PLAYLIST_HEADER_MISSING)
    }

    /* * PlaylistType */
    let playlistType = PlaylistType.MASTER

    // First, look for media playlist tags, so that we know what the playlist
    // type really is before we start parsing.
    // TODO: refactor the for loop for better readability.
    // Whether to skip the next element; initialize to true to skip first elem.
    let skip = true
    for (const line of lines) {
      // Ignore comments.
      if (Utils.isComment(line) || skip) {
        skip = false
        continue
      }
      const tag = this.parseTag_(line)
      // These tags won't actually be used, so don't increment the global
      // id.
      this.globalId_ -= 1

      if (MEDIA_PLAYLIST_TAGS.includes(tag.name)) {
        playlistType = PlaylistType.MEDIA
        break
      } else if (tag.name === 'EXT-X-STREAM-INF') {
        skip = true
      }
    }

    /* * {Array.<Tag>} */
    const tags = []
    // Initialize to 'true' to skip the first element.
    skip = true
    const enumerate = (it) => Iterables.enumerate(it)
    for (const { i, item: line, next } of enumerate(lines)) {
      // Skip comments
      if (Utils.isComment(line) || skip) {
        skip = false
        continue
      }

      const tag = this.parseTag_(line)
      if (SEGMENT_TAGS.includes(tag.name)) {
        if (playlistType !== PlaylistType.MEDIA) {
          // Only media playlists should contain segment tags
          throw new Error(
            Error.Severity.CRITICAL,
            Error.Category.MANIFEST,
            Error.Code.HLS_INVALID_PLAYLIST_HIERARCHY)
        }

        const segmentsData = lines.splice(i, lines.length - i)
        const segments = this.parseSegments_(
          absolutePlaylistUri, segmentsData, tags)
        return new Playlist(
          absolutePlaylistUri, playlistType, tags, segments)
      }

      tags.push(tag)

      // An EXT-X-STREAM-INF tag is followed by a URI of a media playlist.
      // Add the URI to the tag object.
      if (tag.name === 'EXT-X-STREAM-INF') {
        const tagUri = new Attribute('URI', next)
        tag.addAttribute(tagUri)
        skip = true
      }
    }

    return new Playlist(absolutePlaylistUri, playlistType, tags)
  }

  /* *
   * Parses an array of strings into an array of HLS Segment objects.
   *
   * @param {string} absoluteMediaPlaylistUri
   * @param {!Array.<string>} lines
   * @param {!Array.<!Tag>} playlistTags
   * @return {!Array.<Segment>}
   * @private
   */
  parseSegments_(absoluteMediaPlaylistUri, lines, playlistTags) {
    /* * @type {!Array.<Segment>} */
    const segments = []
    /* * @type {!Array.<Tag>} */
    let segmentTags = []

    // The last parsed EXT-X-MAP tag.
    /* * @type {?Tag} */
    let currentMapTag = null

    for (const line of lines) {
      if (/^(#EXT)/.test(line)) {
        const tag = this.parseTag_(line)
        if (ManifestTextParser.MEDIA_PLAYLIST_TAGS.includes(
          tag.name)) {
          playlistTags.push(tag)
        } else {
          // Mark the the EXT-X-MAP tag, and add it to the segment tags
          // following it later.
          if (tag.name === 'EXT-X-MAP') {
            currentMapTag = tag
          } else {
            segmentTags.push(tag)
          }
        }
      } else if (Utils.isComment(line)) {
        // Skip comments.
      } else {
        const verbatimSegmentUri = line.trim()
        const absoluteSegmentUri = Utils.constructAbsoluteUri(
          absoluteMediaPlaylistUri, verbatimSegmentUri)

        // Attach the last parsed EXT-X-MAP tag to the segment.
        if (currentMapTag) {
          segmentTags.push(currentMapTag)
        }
        // The URI appears after all of the tags describing the segment.
        const segment =
            new Segment(absoluteSegmentUri, segmentTags)
        segments.push(segment)
        segmentTags = []
      }
    }
    return segments
  }

  /* *
   * Parses a string into an HLS Tag object while tracking what id to use next.
   *
   * @param {string} word
   * @return {!Tag}
   * @private
   */
  parseTag_(word) {
    return ManifestTextParser.parseTag(this.globalId_++, word)
  }

  /* *
   * Parses a string into an HLS Tag object.
   *
   * @param {number} id
   * @param {string} word
   * @return {!Tag}
   */
  static parseTag(id, word) {
    /*  HLS tags start with '#EXT'. A tag can have a set of attributes
      (#EXT-<tagname>:<attribute list>) and/or a value (#EXT-<tagname>:<value>).
      An attribute's format is 'AttributeName=AttributeValue'.
      The parsing logic goes like this:
       1. Everything before ':' is a name (we ignore '#').
       2. Everything after ':' is a list of comma-seprated items,
            2a. The first item might be a value, if it does not contain '='.
            2b. Otherwise, items are attributes.
       3. If there is no ':', it's a simple tag with no attributes and no value.
    */
    const blocks = word.match(/^#(EXT[^:]*)(?::(.*))?$/)
    if (!blocks) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.INVALID_HLS_TAG,
        word)
    }
    const name = blocks[1]
    const data = blocks[2]
    const attributes = []
    let value

    if (data) {
      const parser = new TextParser(data)
      let blockAttrs

      // Regex: any number of non-equals-sign characters at the beginning
      // terminated by comma or end of line
      const valueRegex = /^([^,=]+)(?:,|$)/g

      const blockValue = parser.readRegex(valueRegex)

      if (blockValue) {
        value = blockValue[1]
      }

      // Regex:
      // 1. Key name ([1])
      // 2. Equals sign
      // 3. Either:
      //   a. A quoted string (everything up to the next quote, [2])
      //   b. An unquoted string
      //    (everything up to the next comma or end of line, [3])
      // 4. Either:
      //   a. A comma
      //   b. End of line
      const attributeRegex = /([^=]+)=(?:'([^']*)'|([^',]*))(?:,|$)/g

      while ((blockAttrs = parser.readRegex(attributeRegex))) {
        const attrName = blockAttrs[1]
        const attrValue = blockAttrs[2] || blockAttrs[3]
        const attribute = new Attribute(attrName, attrValue)
        attributes.push(attribute)
      }
    }

    return new Tag(id, name, attributes, value)
  }
}
/* *
 * HLS tags that only appear on Media Playlists.
 * Used to determine a playlist type.
 *
 * @const {!Array.<string>}
 */
ManifestTextParser.MEDIA_PLAYLIST_TAGS = [
  'EXT-X-TARGETDURATION',
  'EXT-X-MEDIA-SEQUENCE',
  'EXT-X-DISCONTINUITY-SEQUENCE',
  'EXT-X-PLAYLIST-TYPE',
  'EXT-X-I-FRAMES-ONLY',
  'EXT-X-ENDLIST'
]
/* *
 * HLS tags that only appear on Segments in a Media Playlists.
 * Used to determine the start of the segments info.
 *
 * @const {!Array.<string>}
 */
ManifestTextParser.SEGMENT_TAGS = [
  'EXTINF',
  'EXT-X-BYTERANGE',
  'EXT-X-DISCONTINUITY',
  'EXT-X-PROGRAM-DATE-TIME',
  'EXT-X-KEY',
  'EXT-X-DATERANGE',
  'EXT-X-MAP'
]
