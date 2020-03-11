import NetworkingEngine from './networking_engine'
import AbortableOperation from '../util/abortable_operation'
import Error from '../util/error'
import StringUtils from '../util/string_utils'
import Uint8ArrayUtils from '../util/uint8array_utils'

/**
 * @summary A networking plugin to handle data URIs.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/data_URIs
 * @export
 */
export default class DataUriPlugin {
  /**
   * @param {string} uri
   * @param {shaka.extern.Request} request
   * @param {NetworkingEngine.RequestType} requestType
   * @param {shaka.extern.ProgressUpdated} progressUpdated Called when a
   *   progress event happened.
   * @return {!shaka.extern.IAbortableOperation.<shaka.extern.Response>}
   * @export
   */
  static parse(uri, request, requestType, progressUpdated) {
    try {
      const parsed = DataUriPlugin.parseRaw(uri)

      /** @type {shaka.extern.Response} */
      const response = {
        uri: uri,
        originalUri: uri,
        data: parsed.data,
        headers: {
          'content-type': parsed.contentType
        }
      }

      return AbortableOperation.completed(response)
    } catch (error) {
      return AbortableOperation.failed(error)
    }
  }

  /**
   * @param {string} uri
   * @return {{data: BufferSource, contentType: string}}
   */
  static parseRaw(uri) {
    // Extract the scheme.
    const parts = uri.split(':')
    if (parts.length < 2 || parts[0] !== 'data') {
      console.error('Bad data URI, failed to parse scheme')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.NETWORK,
        Error.Code.MALFORMED_DATA_URI,
        uri)
    }
    const path = parts.slice(1).join(':')

    // Extract the encoding and MIME type (required but can be empty).
    const infoAndData = path.split(',')
    if (infoAndData.length < 2) {
      console.error('Bad data URI, failed to extract encoding and MIME type')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.NETWORK,
        Error.Code.MALFORMED_DATA_URI,
        uri)
    }
    const info = infoAndData[0]
    const dataStr = window.decodeURIComponent(infoAndData.slice(1).join(','))

    // Extract the encoding (optional).
    const typeAndEncoding = info.split(';')
    let encoding = null
    if (typeAndEncoding.length > 1) {
      encoding = typeAndEncoding[1]
    }

    // Convert the data.
    /** @type {BufferSource} */
    let data
    if (encoding === 'base64') {
      data = Uint8ArrayUtils.fromBase64(dataStr)
    } else if (encoding) {
      console.error('Bad data URI, unknown encoding')
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.NETWORK,
        Error.Code.UNKNOWN_DATA_URI_ENCODING,
        uri)
    } else {
      data = StringUtils.toUTF8(dataStr)
    }

    return { data: data, contentType: typeAndEncoding[0] }
  }
}
NetworkingEngine.registerScheme(
  'data', DataUriPlugin.parse)
