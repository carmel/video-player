import DelayedTick from './delayed_tick'

/* *
 * A timer allows a single function to be executed at a later time or at
 * regular intervals.
 *
 * @final
 * @export
 */
export default class Timer {
  /* *
   * Create a new timer. A timer is committed to a single callback function.
   * While there is no technical reason to do this, it is far easier to
   * understand and use timers when they are connected to one functional idea.
   *
   * @param {function()} onTick
   */
  constructor(onTick) {
    /* *
     * Each time our timer 'does work', we call that a 'tick'. The name comes
     * from old analog clocks.
     *
     * @private {function()}
     */
    this.onTick_ = onTick

    /* * @private {DelayedTick} */
    this.ticker_ = null
  }

  /* *
   * Have the timer call |onTick| now.
   *
   * @return {!Timer}
   * @export
   */
  tickNow() {
    this.stop()
    this.onTick_()

    return this
  }

  /* *
   * Have the timer call |onTick| after |seconds| has elapsed unless |stop| is
   * called first.
   *
   * @param {number} seconds
   * @return {!Timer}
   * @export
   */
  tickAfter(seconds) {
    this.stop()

    this.ticker_ = new DelayedTick(() => {
      this.onTick_()
    }).tickAfter(seconds)

    return this
  }

  /* *
   * Have the timer call |onTick| every |seconds| until |stop| is called.
   *
   * @param {number} seconds
   * @return {!Timer}
   * @export
   */
  tickEvery(seconds) {
    this.stop()

    this.ticker_ = new DelayedTick(() => {
      // Schedule the timer again first. |onTick_| could cancel the timer and
      // rescheduling first simplifies the implementation.
      this.ticker_.tickAfter(seconds)
      this.onTick_()
    }).tickAfter(seconds)

    return this
  }

  /* *
   * Stop the timer and clear the previous behaviour. The timer is still usable
   * after calling |stop|.
   *
   * @export
   */
  stop() {
    if (this.ticker_) {
      this.ticker_.stop()
      this.ticker_ = null
    }
  }
}
