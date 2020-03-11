import BufferUtils from './buffer_utils'
import Iterables from './iterables'
import StringUtils from './string_utils'

/**
 * @summary A set of Uint8Array utility functions.
 * @exportDoc
 */
export default class Uint8ArrayUtils {
  /**
   * Convert a buffer to a base64 string. The output will be standard
   * alphabet as opposed to base64url safe alphabet.
   * @param {BufferSource} data
   * @return {string}
   * @export
   */
  static toStandardBase64(data) {
    const bytes = StringUtils.fromCharCode(
      BufferUtils.toUint8(data))
    return btoa(bytes)
  }

  /**
   * Convert a buffer to a base64 string.  The output will always use the
   * alternate encoding/alphabet also known as 'base64url'.
   * @param {BufferSource} data
   * @param {boolean=} padding If true, pad the output with equals signs.
   *   Defaults to true.
   * @return {string}
   * @export
   */
  static toBase64(data, padding) {
    padding = (padding === undefined) ? true : padding
    const base64 = Uint8ArrayUtils.toStandardBase64(data)
      .replace(/\+/g, '-').replace(/\//g, '_')
    return padding ? base64 : base64.replace(/[=]*$/, '')
  }

  /**
   * Convert a base64 string to a Uint8Array.  Accepts either the standard
   * alphabet or the alternate 'base64url' alphabet.
   * @param {string} str
   * @return {!Uint8Array}
   * @export
   */
  static fromBase64(str) {
    // atob creates a 'raw string' where each character is interpreted as a
    // byte.
    const bytes = window.atob(str.replace(/-/g, '+').replace(/_/g, '/'))
    const result = new Uint8Array(bytes.length)
    const enumerate = (it) => Iterables.enumerate(it)
    for (const { i, item } of enumerate(bytes)) {
      result[i] = item.charCodeAt(0)
    }
    return result
  }
  /**
   * Convert a hex string to a Uint8Array.
   * @param {string} str
   * @return {!Uint8Array}
   * @export
   */
  static fromHex(str) {
    const size = str.length / 2
    const arr = new Uint8Array(size)
    for (const i of Iterables.range(size)) {
      arr[i] = window.parseInt(str.substr(i * 2, 2), 16)
    }
    return arr
  }
  /**
   * Convert a buffer to a hex string.
   * @param {BufferSource} data
   * @return {string}
   * @export
   */
  static toHex(data) {
    const arr = BufferUtils.toUint8(data)
    let hex = ''
    for (let value of arr) {
      value = value.toString(16)
      if (value.length === 1) {
        value = '0' + value
      }
      hex += value
    }
    return hex
  }
  /**
   * Concatenate buffers.
   * @param {...BufferSource} varArgs
   * @return {!Uint8Array}
   * @export
   */
  static concat(...varArgs) {
    let totalLength = 0
    for (const arr of varArgs) {
      totalLength += arr.byteLength
    }

    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of varArgs) {
      result.set(BufferUtils.toUint8(arr), offset)
      offset += arr.byteLength
    }
    return result
  }
}
