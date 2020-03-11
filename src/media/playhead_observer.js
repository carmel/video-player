// import IReleasable from '../util/i_releasable'
import Timer from '../util/timer'
/**
 * A playhead observer is a system that watches for meaningful changes in state
 * that are dependent on playhead information. The observer is responsible for
 * managing its own listeners.
 *
 * @extends {IReleasable}
 * @interface
 */
export class IPlayheadObserver {
  /**
   * Check again (using an update playhead summary) if an event should be fired.
   * If an event should be fired, fire it.
   *
   * @param {number} positionInSeconds
   * @param {boolean} wasSeeking
   */
  poll(positionInSeconds, wasSeeking) {}
}
/**
 * The playhead observer manager is responsible for owning playhead observer
 * instances and polling them when needed. Destroying the manager will destroy
 * all observers managed by the manager.
 *
 * @implements {IReleasable}
 * @final
 */
export class PlayheadObserverManager {
  /**
   * @param {!HTMLMediaElement} mediaElement
   */
  constructor(mediaElement) {
    /** @private {HTMLMediaElement} */
    this.mediaElement_ = mediaElement

    /**
     * The set of all observers that this manager is responsible for updating.
     * We are using a set to ensure that we don't double update an observer if
     * it is accidentally added twice.
     *
     * @private {!Set.<IPlayheadObserver>}
     */
    this.observers_ = new Set()

    /**
     * To fire events semi-accurately, poll the observers 4 times a second. This
     * should be frequent enough to trigger an event close enough to its actual
     * occurrence without the user noticing a delay.
     *
     * @private {Timer}
     */
    this.pollingLoop_ = new Timer(() => {
      this.pollAllObservers_(/* seeking= */ false)
    }).tickEvery(/* seconds= */ 0.25)
  }

  /** @override */
  release() {
    // We need to stop the loop or else we may try to use a released resource.
    this.pollingLoop_.stop()

    for (const observer of this.observers_) {
      observer.release()
    }

    this.observers_.clear()
  }

  /**
   * Have the playhead observer manager manage a new observer. This will ensure
   * that observers are only tracked once within the manager. After this call,
   * the manager will be responsible for the life cycle of |observer|.
   *
   * @param {!IPlayheadObserver} observer
   */
  manage(observer) {
    this.observers_.add(observer)
  }

  /**
   * Notify all the observers that we just seeked.
   */
  notifyOfSeek() {
    this.pollAllObservers_(/* seeking= */ true)
  }

  /**
   * @param {boolean} seeking
   * @private
   */
  pollAllObservers_(seeking) {
    for (const observer of this.observers_) {
      observer.poll(
        this.mediaElement_.currentTime,
        seeking)
    }
  }
}
