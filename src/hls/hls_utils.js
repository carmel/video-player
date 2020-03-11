
import ManifestParserUtils from '../util/manifest_parser_utils'

export default class Utils {
  /**
   *
   * @param {!Array.<!Tag>} tags
   * @param {string} name
   * @return {!Array.<!Tag>}
   */
  static filterTagsByName(tags, name) {
    return tags.filter((tag) => {
      return tag.name === name
    })
  }
  /**
   *
   * @param {!Array.<!Tag>} tags
   * @param {string} type
   * @return {!Array.<!Tag>}
   */
  static filterTagsByType(tags, type) {
    return tags.filter((tag) => {
      const tagType = tag.getRequiredAttrValue('TYPE')
      return tagType === type
    })
  }
  /**
   *
   * @param {!Array.<!Tag>} tags
   * @param {string} name
   * @return {?Tag}
   */
  static getFirstTagWithName(tags, name) {
    const tagsWithName = Utils.filterTagsByName(tags, name)
    if (!tagsWithName.length) {
      return null
    }

    return tagsWithName[0]
  }
  /**
   * @param {string} parentAbsoluteUri
   * @param {string} uri
   * @return {string}
   */
  static constructAbsoluteUri(parentAbsoluteUri, uri) {
    const uris = ManifestParserUtils.resolveUris(
      [parentAbsoluteUri], [uri])
    return uris[0]
  }
  /**
   * Matches a string to an HLS comment format and returns the result.
   *
   * @param {string} line
   * @return {boolean}
   */
  static isComment(line) {
    return /^#(?!EXT)/m.test(line)
  }
}
