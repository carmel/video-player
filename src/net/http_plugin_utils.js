import Error from '../util/error'
import StringUtils from '../util/string_utils'

/**
 * @summary A set of http networking utility functions.
 * @exportDoc
 */
export default class HttpPluginUtils {
  /**
   * @param {!Object.<string,string>} headers
   * @param {BufferSource} data
   * @param {number} status
   * @param {string} uri
   * @param {string} responseURL
   * @param {NetworkingEngine.RequestType} requestType
   * @return {!shaka.extern.Response}
   */
  static makeResponse(headers, data, status, uri, responseURL, requestType) {
    if (status >= 200 && status <= 299 && status !== 202) {
      // Most 2xx HTTP codes are success cases.
      /** @type {shaka.extern.Response} */
      const response = {
        uri: responseURL || uri,
        originalUri: uri,
        data: data,
        headers: headers,
        fromCache: !!headers['x-shaka-from-cache']
      }
      return response
    } else {
      let responseText = null
      try {
        responseText = StringUtils.fromBytesAutoDetect(data)
      } catch (exception) {}
      console.debug('HTTP error text:', responseText)

      const severity = status === 401 || status === 403
        ? Error.Severity.CRITICAL
        : Error.Severity.RECOVERABLE
      throw new Error(
        severity,
        Error.Category.NETWORK,
        Error.Code.BAD_HTTP_STATUS,
        uri,
        status,
        responseText,
        headers,
        requestType)
    }
  }
}
