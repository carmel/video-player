import polyfill from './all'

/**
 * @summary A polyfill to patch math round bug on some browsers.
 * @see https://stackoverflow.com/q/12830742
 */
export default class MathRound {
  /**
   * Install the polyfill if needed.
   */
  static install() {
    console.debug('mathRound.install')

    const testNumber = polyfill.MathRound.MAX_ACCURATE_INPUT_ + 1
    if (Math.round(testNumber) !== testNumber) {
      console.debug('polyfill Math.round')
      const originalMathRound = Math.round
      Math.round = (number) => {
        let result = number
        // Due to the precision of JavaScript numbers, the number must be
        // integer.
        if (number <= polyfill.MathRound.MAX_ACCURATE_INPUT_) {
          result = originalMathRound(number)
        }
        return result
      }
    }
  }
}

/**
 @const {number}
 @private
 */
MathRound.MAX_ACCURATE_INPUT_ = 0x10000000000000

polyfill.register(MathRound.install)
