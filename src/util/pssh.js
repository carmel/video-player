import Iterables from './iterables'
import Mp4Parser from './mp4_parser'
import Uint8ArrayUtils from './uint8array_utils'
import BufferUtils from './buffer_utils'
import Functional from './functional'
/* *
 * @summary
 * Parse a PSSH box and extract the system IDs.
 */
export default class Pssh {
  /* *
   * @param {!Uint8Array} psshBox
   */
  constructor(psshBox) {
    /* *
     * In hex.
     * @type {!Array.<string>}
     */
    this.systemIds = []

    /* *
     * In hex.
     * @type {!Array.<string>}
     */
    this.cencKeyIds = []

    /* *
     * Array with the pssh boxes found.
     * @type {!Array.<!Uint8Array>}
     */
    this.data = []

    new Mp4Parser()
      .box('moov', Mp4Parser.children)
      .fullBox('pssh', (box) => this.parsePsshBox_(box))
      .parse(psshBox)

    if (this.data.length === 0) {
      console.warning('No pssh box found!')
    }
  }
  /* *
   * @param {!shaka.extern.ParsedBox} box
   * @private
   */
  parsePsshBox_(box) {
    console.assert(
      box.version != null,
      'PSSH boxes are full boxes and must have a valid version')

    console.assert(
      box.flags != null,
      'PSSH boxes are full boxes and must have a valid flag')

    if (box.version > 1) {
      console.warning('Unrecognized PSSH version found!')
      return
    }

    // The 'reader' gives us a view on the payload of the box.  Create a new
    // view that contains the whole box.
    const dataView = box.reader.getDataView()
    console.assert(
      dataView.byteOffset >= 12, 'DataView at incorrect position')
    const pssh = BufferUtils.toUint8(dataView, -12, box.size)
    this.data.push(pssh)

    this.systemIds.push(
      Uint8ArrayUtils.toHex(box.reader.readBytes(16)))
    if (box.version > 0) {
      const numKeyIds = box.reader.readUint32()
      for (const _ of Iterables.range(numKeyIds)) {
        Functional.ignored(_)
        const keyId =
            Uint8ArrayUtils.toHex(box.reader.readBytes(16))
        this.cencKeyIds.push(keyId)
      }
    }
  }

  /* *
   * Creates a pssh blob from the given system ID and data.
   *
   * @param {!Uint8Array} data
   * @param {!Uint8Array} systemId
   * @return {!Uint8Array}
   */
  static createPssh(data, systemId) {
    console.assert(systemId.byteLength === 16, 'Invalid system ID length')
    const dataLength = data.length
    const psshSize = 0x4 + 0x4 + 0x4 + systemId.length + 0x4 + dataLength

    /* * @type {!Uint8Array} */
    const psshBox = new Uint8Array(psshSize)
    /* * @type {!DataView} */
    const psshData = BufferUtils.toDataView(psshBox)

    let byteCursor = 0
    psshData.setUint32(byteCursor, psshSize)
    byteCursor += 0x4
    psshData.setUint32(byteCursor, 0x70737368) // 'pssh'
    byteCursor += 0x4
    psshData.setUint32(byteCursor, 0) // flags
    byteCursor += 0x4
    psshBox.set(systemId, byteCursor)
    byteCursor += systemId.length
    psshData.setUint32(byteCursor, dataLength)
    byteCursor += 0x4
    psshBox.set(data, byteCursor)
    byteCursor += dataLength

    console.assert(byteCursor === psshSize, 'PSSH invalid length.')
    return psshBox
  }
  /* *
   * Normalise the initData array. This is to apply browser specific
   * work-arounds, e.g. removing duplicates which appears to occur
   * intermittently when the native msneedkey event fires (i.e. event.initData
   * contains dupes).
   *
   * @param {!Uint8Array} initData
   * @return {!Uint8Array}
   */
  static normaliseInitData(initData) {
    if (!initData) {
      return initData
    }

    const pssh = new Pssh(initData)

    // If there is only a single pssh, return the original array.
    if (pssh.data.length <= 1) {
      return initData
    }

    // Dedupe psshData.
    /* * @type {!Array.<!Uint8Array>} */
    const dedupedInitDatas = []
    for (const initData of pssh.data) {
      const found = dedupedInitDatas.some((x) => {
        return BufferUtils.equal(x, initData)
      })

      if (!found) {
        dedupedInitDatas.push(initData)
      }
    }

    return Uint8ArrayUtils.concat(...dedupedInitDatas)
  }
}

