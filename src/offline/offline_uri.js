/* *
 * The OfflineUri class contains all the components that make up the offline
 * uri. The components are:
 *    TYPE: Used to know what type of data the uri points to. It can either
 *          be 'manifest' or 'segment'.
 *    MECHANISM: The name of the mechanism that manages the storage cell that
 *               holds the data.
 *    CELL: The name of the cell that holds the data.
 *    KEY: The key that the data is stored under in the cell.
 */
export default class OfflineUri {
  /* *
   * @param {string} type
   * @param {string} mechanism
   * @param {string} cell
   * @param {number} key
   */
  constructor(type, mechanism, cell, key) {
    /* *
     * @private {string}
     * @const
     */
    this.type_ = type
    /* *
     * @private {string}
     * @const
     */
    this.mechanism_ = mechanism
    /* *
     * @private {string}
     * @const
     */
    this.cell_ = cell
    /* *
     * @private {number}
     * @const
     */
    this.key_ = key

    /* *
     * @private {string}
     * @const
     */
    this.asString_ = [
      'offline:', type, '/', mechanism, '/', cell, '/', key
    ].join('')
  }

  /* * @return {boolean} */
  isManifest() { return this.type_ === 'manifest' }

  /* * @return {boolean} */
  isSegment() { return this.type_ === 'segment' }

  /* * @return {string} */
  mechanism() { return this.mechanism_ }

  /* * @return {string} */
  cell() { return this.cell_ }

  /* * @return {number} */
  key() { return this.key_ }

  /* * @override */
  toString() { return this.asString_ }

  /* *
   * @param {string} uri
   * @return {?OfflineUri}
   */
  static parse(uri) {
    const parts = /^offline:([a-z]+)\/([^/]+)\/([^/]+)\/([0-9]+)$/.exec(uri)
    if (parts === null) {
      return null
    }

    const type = parts[1]
    if (type !== 'manifest' && type !== 'segment') {
      return null
    }

    const mechanism = parts[2]
    if (!mechanism) {
      return null
    }

    const cell = parts[3]
    if (!cell) {
      return null
    }

    const key = Number(parts[4])
    if (type === null) {
      return null
    }

    return new OfflineUri(type, mechanism, cell, key)
  }

  /* *
   * @param {string} mechanism
   * @param {string} cell
   * @param {number} key
   * @return {!OfflineUri}
   */
  static manifest(mechanism, cell, key) {
    return new OfflineUri('manifest', mechanism, cell, key)
  }

  /* *
   * @param {string} mechanism
   * @param {string} cell
   * @param {number} key
   * @return {!OfflineUri}
   */
  static segment(mechanism, cell, key) {
    return new OfflineUri('segment', mechanism, cell, key)
  }
}
