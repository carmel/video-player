function split(uri) {
  // See @return comment -- never null.
  return /* * @type {!Array.<string|undefined>} */ (uri.match(new RegExp(
    '^' +
    '(?:' +
        '([^:/?#.]+)' + // scheme - ignore special characters
    // used by other URL parts such as :,
    // ?, /, #, and .
    ':)?' +
    '(?://' +
        '(?:([^/?#]*)@)?' + // userInfo
        '([^/#?]*?)' + // domain
        '(?::([0-9]+))?' + // port
        '(?=[/#?]|$)' + // authority-terminating character
    ')?' +
    '([^?#]+)?' + // path
    '(?:\\?([^#]*))?' + // query
    '(?:#(.*))?' + // fragment
    '$')))
}

export default class Uri {
  constructor(uri) {
    // Parse in the uri string
    var m
    if (uri instanceof Uri) {
      this.setScheme(uri.getScheme())
      this.setUserInfo(uri.getUserInfo())
      this.setDomain(uri.getDomain())
      this.setPort(uri.getPort())
      this.setPath(uri.getPath())
      this.setQueryData(uri.getQueryData().clone())
      this.setFragment(uri.getFragment())
    } else if (uri && (m = split(String(uri)))) {
      // Set the parts -- decoding as we do so.
      // COMPATABILITY NOTE - In IE, unmatched fields may be empty strings,
      // whereas in other browsers they will be undefined.
      this.setScheme(m[Uri.ComponentIndex.SCHEME] || '', true)
      this.setUserInfo(m[Uri.ComponentIndex.USER_INFO] || '', true)
      this.setDomain(m[Uri.ComponentIndex.DOMAIN] || '', true)
      this.setPort(m[Uri.ComponentIndex.PORT])
      this.setPath(m[Uri.ComponentIndex.PATH] || '', true)
      this.setQueryData(m[Uri.ComponentIndex.QUERY_DATA] || '', true)
      this.setFragment(m[Uri.ComponentIndex.FRAGMENT] || '', true)
    } else {
      this.queryData_ = new Uri.QueryData(null, null)
    }
  }
  static get reDisallowedInQuery_() {
    // eslint-disable-next-line
    return /[\#\?@]/g
  }
  static get reDisallowedInRelativePath_() {
    // eslint-disable-next-line
    return /[\#\?:]/g
  }
  static get reDisallowedInSchemeOrUserInfo_() {
    // eslint-disable-next-line
    return /[#\/\?@]/g
  }
  static get reDisallowedInAbsolutePath_() {
    // eslint-disable-next-line
    return /[\#\?]/g
  }
  static get reDisallowedInFragment_() {
    return /#/g
  }
  static get ComponentIndex() {
    return {
      SCHEME: 1,
      USER_INFO: 2,
      DOMAIN: 3,
      PORT: 4,
      PATH: 5,
      QUERY_DATA: 6,
      FRAGMENT: 7
    }
  }
  toString() {
    var out = []
    var scheme = this.getScheme()
    if (scheme) {
      out.push(Uri.encodeSpecialChars_(
        scheme, Uri.reDisallowedInSchemeOrUserInfo_, true), ':')
    }

    var domain = this.getDomain()
    if (domain) {
      out.push('//')

      var userInfo = this.getUserInfo()
      if (userInfo) {
        out.push(Uri.encodeSpecialChars_(
          userInfo, Uri.reDisallowedInSchemeOrUserInfo_, true), '@')
      }

      out.push(Uri.removeDoubleEncoding_(encodeURIComponent(domain)))

      var port = this.getPort()
      if (port !== null) {
        out.push(':', String(port))
      }
    }

    var path = this.getPath()
    if (path) {
      if (this.hasDomain() && path.charAt(0) !== '/') {
        out.push('/')
      }
      out.push(Uri.encodeSpecialChars_(
        path,
        path.charAt(0) === '/'
          ? Uri.reDisallowedInAbsolutePath_
          : Uri.reDisallowedInRelativePath_,
        true))
    }

    var query = this.getEncodedQuery()
    if (query) {
      out.push('?', query)
    }

    var fragment = this.getFragment()
    if (fragment) {
      out.push('#', Uri.encodeSpecialChars_(
        fragment, Uri.reDisallowedInFragment_))
    }
    return out.join('')
  }

  resolve(relativeUri) {
    var absoluteUri = this.clone()
    if (absoluteUri.scheme_ === 'data') {
      // Cannot have a relative URI to a data URI.
      absoluteUri = new Uri()
    }

    // we satisfy these conditions by looking for the first part of relativeUri
    // that is not blank and applying defaults to the rest

    var overridden = relativeUri.hasScheme()

    if (overridden) {
      absoluteUri.setScheme(relativeUri.getScheme())
    } else {
      overridden = relativeUri.hasUserInfo()
    }

    if (overridden) {
      absoluteUri.setUserInfo(relativeUri.getUserInfo())
    } else {
      overridden = relativeUri.hasDomain()
    }

    if (overridden) {
      absoluteUri.setDomain(relativeUri.getDomain())
    } else {
      overridden = relativeUri.hasPort()
    }

    var path = relativeUri.getPath()
    if (overridden) {
      absoluteUri.setPort(relativeUri.getPort())
    } else {
      overridden = relativeUri.hasPath()
      if (overridden) {
        // resolve path properly
        if (path.charAt(0) !== '/') {
          // path is relative
          if (this.hasDomain() && !this.hasPath()) {
            // RFC 3986, section 5.2.3, case 1
            path = '/' + path
          } else {
            // RFC 3986, section 5.2.3, case 2
            var lastSlashIndex = absoluteUri.getPath().lastIndexOf('/')
            if (lastSlashIndex !== -1) {
              path = absoluteUri.getPath().substr(0, lastSlashIndex + 1) + path
            }
          }
        }
        path = Uri.removeDotSegments(path)
      }
    }

    if (overridden) {
      absoluteUri.setPath(path)
    } else {
      overridden = relativeUri.hasQuery()
    }

    if (overridden) {
      absoluteUri.setQueryData(relativeUri.getQueryData().clone())
    } else {
      overridden = relativeUri.hasFragment()
    }

    if (overridden) {
      absoluteUri.setFragment(relativeUri.getFragment())
    }

    return absoluteUri
  }

  clone() {
    return new Uri(this)
  }

  getScheme() {
    return this.scheme_
  }

  setScheme(newScheme, decode) {
    this.scheme_ = decode ? Uri.decodeOrEmpty_(newScheme, true)
      : newScheme

    // remove an : at the end of the scheme so somebody can pass in
    // location.protocol
    if (this.scheme_) {
      this.scheme_ = this.scheme_.replace(/:$/, '')
    }
    return this
  }

  hasScheme() {
    return !!this.scheme_
  }

  getUserInfo() {
    return this.userInfo_
  }

  setUserInfo(newUserInfo, decode) {
    this.userInfo_ = decode ? Uri.decodeOrEmpty_(newUserInfo) : newUserInfo
    return this
  }

  hasUserInfo() {
    return !!this.userInfo_
  }

  getDomain() {
    return this.domain_
  }

  setDomain(newDomain, decode) {
    this.domain_ = decode ? Uri.decodeOrEmpty_(newDomain, true) : newDomain
    return this
  }

  hasDomain() {
    return !!this.domain_
  }

  getPort() {
    return this.port_
  }

  setPort(newPort) {
    if (newPort) {
      newPort = Number(newPort)
      if (isNaN(newPort) || newPort < 0) {
        throw Error('Bad port number ' + newPort)
      }
      this.port_ = newPort
    } else {
      this.port_ = null
    }

    return this
  }

  hasPort() {
    return this.port_ !== null
  }

  getPath() {
    return this.path_
  }

  /* *
   * Sets the path.
   * @param {string} newPath New path value.
   * @param {boolean=} decode Optional param for whether to decode new value.
   * @return {!goog.Uri} Reference to this URI object.
   */
  setPath(newPath, decode) {
    this.path_ = decode ? Uri.decodeOrEmpty_(newPath, true) : newPath
    return this
  }

  /* *
   * @return {boolean} Whether the path has been set.
   */
  hasPath() {
    return !!this.path_
  }

  /* *
   * @return {boolean} Whether the query string has been set.
   */
  hasQuery() {
    return this.queryData_.toString() !== ''
  }

  /* *
   * Sets the query data.
   * @param {static QueryData|string|undefined} queryData QueryData object.
   * @param {boolean=} decode Optional param for whether to decode new value.
   *     Applies only if queryData is a string.
   * @return {!goog.Uri} Reference to this URI object.
   */
  setQueryData(queryData, decode) {
    if (queryData instanceof this.QueryData) {
      this.queryData_ = queryData
    } else {
      if (!decode) {
        // QueryData accepts encoded query string, so encode it if
        // decode flag is not true.
        queryData = Uri.encodeSpecialChars_(queryData, Uri.reDisallowedInQuery_)
      }
      this.queryData_ = Uri.QueryData(queryData, null)
    }
    return this
  }

  /* *
   * @return {string} The encoded URI query, not including the ?.
   */
  getEncodedQuery() {
    return this.queryData_.toString()
  }

  /* *
   * @return {string} The decoded URI query, not including the ?.
   */
  getDecodedQuery() {
    return this.queryData_.toDecodedString()
  }

  /* *
   * Returns the query data.
   * @return {!static QueryData} QueryData object.
   */
  getQueryData() {
    return this.queryData_
  }

  /* *
   * @return {string} The URI fragment, not including the #.
   */
  getFragment() {
    return this.fragment_
  }

  /* *
   * Sets the URI fragment.
   * @param {string} newFragment New fragment value.
   * @param {boolean=} decode Optional param for whether to decode new value.
   * @return {!goog.Uri} Reference to this URI object.
   */
  setFragment(newFragment, decode) {
    this.fragment_ = decode ? Uri.decodeOrEmpty_(newFragment) : newFragment
    return this
  }

  /* *
   * @return {boolean} Whether the URI has a fragment set.
   */
  hasFragment() {
    return !!this.fragment_
  }

  /* * Static members
   * Removes dot segments in given path component, as described in
   * RFC 3986, section 5.2.4.
   *
   * @param {string} path A non-empty path component.
   * @return {string} Path component with removed dot segments.
   */
  static removeDotSegments(path) {
    if (path === '..' || path === '.') {
      return ''
    } else if (path.indexOf('./') === -1 &&
               path.indexOf('/.') === -1) {
      // This optimization detects uris which do not contain dot-segments,
      // and as a consequence do not require any processing.
      return path
    } else {
      var leadingSlash = (path.lastIndexOf('/', 0) === 0)
      var segments = path.split('/')
      var out = []

      for (var pos = 0; pos < segments.length;) {
        var segment = segments[pos++]

        if (segment === '.') {
          if (leadingSlash && pos === segments.length) {
            out.push('')
          }
        } else if (segment === '..') {
          if (out.length > 1 || out.length === 1 && out[0] !== '') {
            out.pop()
          }
          if (leadingSlash && pos === segments.length) {
            out.push('')
          }
        } else {
          out.push(segment)
          leadingSlash = true
        }
      }

      return out.join('/')
    }
  }

  /* *
   * Decodes a value or returns the empty string if it isn't defined or empty.
   * @param {string|undefined} val Value to decode.
   * @param {boolean=} preserveReserved If true, restricted characters will
   *     not be decoded.
   * @return {string} Decoded value.
   * @private
   */
  static decodeOrEmpty_(val, preserveReserved) {
    // Don't use UrlDecode() here because val is not a query parameter.
    if (!val) {
      return ''
    }

    return preserveReserved ? decodeURI(val) : decodeURIComponent(val)
  }

  /* *
   * If unescapedPart is non null, then escapes any characters in it that aren't
   * valid characters in a url and also escapes any special characters that
   * appear in extra.
   *
   * @param {*} unescapedPart The string to encode.
   * @param {RegExp} extra A character set of characters in [\01-\177].
   * @param {boolean=} removeDoubleEncoding If true, remove double percent
   *     encoding.
   * @return {?string} null iff unescapedPart === null.
   * @private
   */
  static encodeSpecialChars_(unescapedPart, extra,
    removeDoubleEncoding) {
    if (typeof unescapedPart === 'string') {
      var encoded = encodeURI(unescapedPart)
        .replace(extra, Uri.encodeChar_)
      if (removeDoubleEncoding) {
        // encodeURI double-escapes %XX sequences used to represent restricted
        // characters in some URI components, remove the double escaping here.
        encoded = Uri.removeDoubleEncoding_(encoded)
      }
      return encoded
    }
    return null
  }

  /* *
   * Converts a character in [\01-\177] to its unicode character equivalent.
   * @param {string} ch One character string.
   * @return {string} Encoded string.
   * @private
   */
  static encodeChar_(ch) {
    var n = ch.charCodeAt(0)
    return '%' + ((n >> 4) & 0xf).toString(16) + (n & 0xf).toString(16)
  }

  /* *
   * Removes double percent-encoding from a string.
   * @param  {string} doubleEncodedString String
   * @return {string} String with double encoding removed.
   * @private
   */
  static removeDoubleEncoding_(doubleEncodedString) {
    return doubleEncodedString.replace(/%25([0-9a-fA-F]{2})/g, '%$1')
  }
}

/* *
   * Class used to represent URI query parameters.  It is essentially a hash of
   * name-value pairs, though a name can be present more than once.
   *
   * Has the same interface as the collections in goog.structs.
   *
   * @param {?string=} query Optional encoded query string to parse into
   *     the object.
   * @param {goog.Uri=} uri Optional uri object that should have its
   *     cache invalidated when this object updates. Deprecated -- this
   *     is no longer required.
   * @constructor
   * @final
   */
Uri.QueryData = class {
  constructor(query, uri) {
    /* *
       * Encoded query string, or null if it requires computing from the key map.
       * @type {?string}
       * @private
       */
    this.encodedQuery_ = query || null
  }
  /* *
     * If the underlying key map is not yet initialized, it parses the
     * query string and fills the map with parsed data.
     * @private
     */
  ensureKeyMapInitialized_() {
    if (!this.keyMap_) {
      this.keyMap_ = {}
      this.count_ = 0

      if (this.encodedQuery_) {
        var pairs = this.encodedQuery_.split('&')
        for (var i = 0; i < pairs.length; i++) {
          var indexOfEquals = pairs[i].indexOf('=')
          var name = null
          var value = null
          if (indexOfEquals >= 0) {
            name = pairs[i].substring(0, indexOfEquals)
            value = pairs[i].substring(indexOfEquals + 1)
          } else {
            name = pairs[i]
          }
          name = decodeURIComponent(name.replace(/\+/g, ' '))
          value = value || ''
          this.add(name, decodeURIComponent(value.replace(/\+/g, ' ')))
        }
      }
    }
  }

  /* *
     * The map containing name/value or name/array-of-values pairs.
     * May be null if it requires parsing from the query string.
     *
     * We need to use a Map because we cannot guarantee that the key names will
     * not be problematic for IE.
     *
     * @type {Object.<string, !Array.<string>>}
     * @private
     */
  // eslint-disable-next-line
    // keyMap_ = null

  /* *
     * The number of params, or null if it requires computing.
     * @type {?number}
     * @private
     */
  // count_ = null

  /* *
     * @return {?number} The number of parameters.
     */
  getCount() {
    this.ensureKeyMapInitialized_()
    return this.count_
  }

  /* *
     * Adds a key value pair.
     * @param {string} key Name.
     * @param {*} value Value.
     * @return {!static QueryData} Instance of this object.
     */
  add(key, value) {
    this.ensureKeyMapInitialized_()
    // Invalidate the cache.
    this.encodedQuery_ = null
    var values = Object.prototype.hasOwnProperty.call(this.keyMap_, key) && this.keyMap_[key]
    if (!values) {
      this.keyMap_[key] = (values = [])
    }
    values.push(value)
    this.count_++
    return this
  }

  /* *
     * @return {string} Encoded query string.
     * @override
     */
  toString() {
    if (this.encodedQuery_) {
      return this.encodedQuery_
    }

    if (!this.keyMap_) {
      return ''
    }

    var sb = []

    for (var key in this.keyMap_) {
      var encodedKey = encodeURIComponent(key)
      var val = this.keyMap_[key]
      for (var j = 0; j < val.length; j++) {
        var param = encodedKey
        // Ensure that null and undefined are encoded into the url as
        // literal strings.
        if (val[j] !== '') {
          param += '=' + encodeURIComponent(val[j])
        }
        sb.push(param)
      }
    }
    this.encodedQuery_ = sb.join('&')
    return this.encodedQuery
  }

  /* *
     * @return {string} Decoded query string.
     */
  toDecodedString() {
    return Uri.decodeOrEmpty_(this.toString())
  }

  /* *
     * Clone the query data instance.
     * @return {!static QueryData} New instance of the QueryData object.
     */
  clone() {
    var rv = Uri.QueryData()
    rv.encodedQuery_ = this.encodedQuery_
    if (this.keyMap_) {
      var cloneMap = {}
      for (var key in this.keyMap_) {
        cloneMap[key] = this.keyMap_[key].concat()
      }
      rv.keyMap_ = cloneMap
      rv.count_ = this.count_
    }
    return rv
  }
}
