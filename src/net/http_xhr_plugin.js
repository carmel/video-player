import HttpPluginUtils from './http_plugin_utils'
import NetworkingEngine from './networking_engine'
import AbortableOperation from '../util/abortable_operation'
import Error from '../util/error'

/**
 * @summary A networking plugin to handle http and https URIs via XHR.
 * @export
 */
export default class HttpXHRPlugin {
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
    const xhr = new HttpXHRPlugin.Xhr_()

    // Last time stamp when we got a progress event.
    let lastTime = Date.now()
    // Last number of bytes loaded, from progress event.
    let lastLoaded = 0

    const promise = new Promise((resolve, reject) => {
      xhr.open(request.method, uri, true)
      xhr.responseType = 'arraybuffer'
      xhr.timeout = request.retryParameters.timeout
      xhr.withCredentials = request.allowCrossSiteCredentials

      xhr.onabort = () => {
        reject(new Error(
          Error.Severity.RECOVERABLE,
          Error.Category.NETWORK,
          Error.Code.OPERATION_ABORTED,
          uri, requestType))
      }
      xhr.onload = (event) => {
        const target = event.target
        console.assert(target, 'XHR onload has no target!')
        // Since IE and Edge incorrectly return the header with a leading new
        // line character ('\n'), we trim the header here.
        const headerLines = target.getAllResponseHeaders().trim().split('\r\n')
        const headers = {}
        for (const header of headerLines) {
          /** @type {!Array.<string>} */
          const parts = header.split(': ')
          headers[parts[0].toLowerCase()] = parts.slice(1).join(': ')
        }

        try {
          const response = HttpPluginUtils.makeResponse(headers,
            target.response, target.status, uri, target.responseURL,
            requestType)
          resolve(response)
        } catch (error) {
          console.assert(error instanceof Error,
            'Wrong error type!')
          reject(error)
        }
      }
      xhr.onerror = (event) => {
        reject(new Error(
          Error.Severity.RECOVERABLE,
          Error.Category.NETWORK,
          Error.Code.HTTP_ERROR,
          uri, event, requestType))
      }
      xhr.ontimeout = (event) => {
        reject(new Error(
          Error.Severity.RECOVERABLE,
          Error.Category.NETWORK,
          Error.Code.TIMEOUT,
          uri, requestType))
      }
      xhr.onprogress = (event) => {
        const currentTime = Date.now()
        // If the time between last time and this time we got progress event
        // is long enough, or if a whole segment is downloaded, call
        // progressUpdated().
        if (currentTime - lastTime > 100 ||
            (event.lengthComputable && event.loaded === event.total)) {
          progressUpdated(currentTime - lastTime, event.loaded - lastLoaded,
            event.total - event.loaded)
          lastLoaded = event.loaded
          lastTime = currentTime
        }
      }

      for (const key in request.headers) {
        // The Fetch API automatically normalizes outgoing header keys to
        // lowercase. For consistency's sake, do it here too.
        const lowercasedKey = key.toLowerCase()
        xhr.setRequestHeader(lowercasedKey, request.headers[key])
      }
      xhr.send(request.body)
    })

    return new AbortableOperation(
      promise,
      () => {
        xhr.abort()
        return Promise.resolve()
      })
  }
}
/**
 * Overridden in unit tests, but compiled out in production.
 *
 * @const {function(new: XMLHttpRequest)}
 * @private
 */
HttpXHRPlugin.Xhr_ = window.XMLHttpRequest
NetworkingEngine.registerScheme(
  'http', HttpXHRPlugin.parse,
  NetworkingEngine.PluginPriority.FALLBACK)
NetworkingEngine.registerScheme(
  'https', HttpXHRPlugin.parse,
  NetworkingEngine.PluginPriority.FALLBACK)

