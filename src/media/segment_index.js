import { SegmentReference } from './segment_reference'
// import IDestroyable from '../util/i_destroyable'
import Timer from '../util/timer'
/* *
 * SegmentIndex.
 *
 * @implements {IDestroyable}
 * @export
 */
export default class SegmentIndex {
  /* *
   * @param {!Array.<!SegmentReference>} references The list of
   *   SegmentReferences, which must be sorted first by their start times
   *   (ascending) and second by their end times (ascending).  They must have
   *   continuous, increasing positions.
   */
  constructor(references) {
    /* * @private {!Array.<!SegmentReference>} */
    this.references_ = references

    /* * @private {Timer} */
    this.timer_ = null
  }
  /* *
   * @override
   * @export
   */
  destroy() {
    this.references_ = []

    if (this.timer_) {
      this.timer_.stop()
    }
    this.timer_ = null

    return Promise.resolve()
  }
  /* *
   * Finds the position of the segment for the given time, in seconds, relative
   * to the start of the presentation.  Returns the position of the segment
   * with the largest end time if more than one segment is known for the given
   * time.
   *
   * @param {number} time
   * @return {?number} The position of the segment, or null
   *   if the position of the segment could not be determined.
   * @export
   */
  find(time) {
    // For live streams, searching from the end is faster.  For VOD, it balances
    // out either way.  In both cases, references_.length is small enough that
    // the difference isn't huge.
    for (let i = this.references_.length - 1; i >= 0; --i) {
      const r = this.references_[i]
      // Note that a segment ends immediately before the end time.
      if ((time >= r.startTime) && (time < r.endTime)) {
        return r.position
      }
    }
    if (this.references_.length && time < this.references_[0].startTime) {
      return this.references_[0].position
    }

    return null
  }
  /* *
   * Gets the SegmentReference for the segment at the given position.
   *
   * @param {number} position The position of the segment.
   * @return {SegmentReference} The SegmentReference, or null if
   *   no such SegmentReference exists.
   * @export
   */
  get(position) {
    if (this.references_.length === 0) {
      return null
    }

    const index = position - this.references_[0].position
    if (index < 0 || index >= this.references_.length) {
      return null
    }

    return this.references_[index]
  }
  /* *
   * Offset all segment references by a fixed amount.
   *
   * @param {number} offset The amount to add to each segment's start and end
   *   times.
   * @export
   */
  offset(offset) {
    for (const ref of this.references_) {
      ref.startTime += offset
      ref.endTime += offset
      ref.timestampOffset += offset
    }
  }
  /* *
   * Merges the given SegmentReferences.  Supports extending the original
   * references only.  Will not replace old references or interleave new ones.
   *
   * @param {!Array.<!SegmentReference>} references The list of
   *   SegmentReferences, which must be sorted first by their start times
   *   (ascending) and second by their end times (ascending).  They must have
   *   continuous, increasing positions.
   * @export
   */
  merge(references) {
    let newReferences = []
    let i = 0
    let j = 0

    while ((i < this.references_.length) && (j < references.length)) {
      const r1 = this.references_[i]
      const r2 = references[j]

      if (r1.startTime < r2.startTime) {
        newReferences.push(r1)
        i++
      } else if (r1.startTime > r2.startTime) {
        if (i === 0) {
          // If the reference appears before any existing reference, it may have
          // been evicted before; in this case, simply add it back and it will
          // be evicted again later.
          newReferences.push(r2)
        } else {
          // Drop the new reference if it would have to be interleaved with the
          // old one.  Issue a warning, since this is not a supported update.
          console.warning(
            'Refusing to rewrite original references on update!')
        }
        j++
      } else {
        // When period is changed, fit() will expand the last segment to the
        // start of the next period.  So, it is valid to have end time updated
        // to the last segment reference in a period.
        if (Math.abs(r1.endTime - r2.endTime) > 0.1) {
          console.assert(r2.endTime > r1.endTime &&
              i === this.references_.length - 1 &&
              j === references.length - 1,
          'This should be an update of the last segment in a period')
          const r = new SegmentReference(r1.position,
            r2.startTime, r2.endTime, r2.getUris, r2.startByte, r2.endByte,
            r2.initSegmentReference, r2.timestampOffset, r2.appendWindowStart,
            r2.appendWindowEnd)
          newReferences.push(r)
        } else {
          // Drop the new reference if there's an old reference with the
          // same time.
          newReferences.push(r1)
        }
        i++
        j++
      }
    }

    while (i < this.references_.length) {
      newReferences.push(this.references_[i++])
    }

    if (newReferences.length) {
      // The rest of these references may need to be renumbered.
      let nextPosition = newReferences[newReferences.length - 1].position + 1
      while (j < references.length) {
        const r = references[j++]
        const r2 = new SegmentReference(nextPosition++,
          r.startTime, r.endTime, r.getUris, r.startByte, r.endByte,
          r.initSegmentReference, r.timestampOffset, r.appendWindowStart,
          r.appendWindowEnd)
        newReferences.push(r2)
      }
    } else {
      newReferences = references
    }
    this.references_ = newReferences
  }
  /* *
   * Replace existing references with new ones, without merging.
   *
   * @param {!Array.<!SegmentReference>} newReferences
   * @export
   */
  replace(newReferences) {
    this.references_ = newReferences
  }
  /* *
   * Removes all SegmentReferences that end before the given time.
   *
   * @param {number} time The time in seconds.
   * @export
   */
  evict(time) {
    this.references_ = this.references_.filter((ref) => ref.endTime > time)
  }
  /* *
   * Also expands or contracts the last SegmentReference so it ends at the end
   * of its Period.
   *
   * Do not call on the last period of a live presentation (unknown duration).
   * It is okay to call on the other periods of a live presentation, where the
   * duration is known and another period has been added.
   *
   * @param {number} periodStart
   * @param {?number} periodEnd
   * @export
   */
  fit(periodStart, periodEnd) {
    console.assert(periodEnd !== null,
      'Period duration must be known for static content!')
    console.assert(periodEnd !== Infinity,
      'Period duration must be finite for static content!')

    // Trim out references we will never use.
    while (this.references_.length) {
      const lastReference = this.references_[this.references_.length - 1]
      if (lastReference.startTime >= periodEnd) {
        this.references_.pop()
      } else {
        break
      }
    }

    while (this.references_.length) {
      const firstReference = this.references_[0]
      if (firstReference.endTime <= periodStart) {
        this.references_.shift()
      } else {
        break
      }
    }

    if (this.references_.length === 0) {
      return
    }

    // Adjust the last SegmentReference.
    const lastReference = this.references_[this.references_.length - 1]
    this.references_[this.references_.length - 1] =
        new SegmentReference(
          lastReference.position,
          lastReference.startTime,
          /*  endTime= */ periodEnd,
          lastReference.getUris,
          lastReference.startByte,
          lastReference.endByte,
          lastReference.initSegmentReference,
          lastReference.timestampOffset,
          lastReference.appendWindowStart,
          lastReference.appendWindowEnd)
  }
  /* *
   * Updates the references every so often.  Stops when the references list
   * becomes empty.
   *
   * @param {number} interval The interval in seconds.
   * @param {function():!Array.<SegmentReference>} updateCallback
   * @export
   */
  updateEvery(interval, updateCallback) {
    console.assert(!this.timer_, 'SegmentIndex timer already started!')
    this.timer_ = new Timer(() => {
      const references = updateCallback()
      this.references_.push(...references)
      if (this.references_.length === 0) {
        this.timer_.stop()
        this.timer_ = null
      }
    })
    this.timer_.tickEvery(interval)
  }
  /* *
   * Create a SegmentIndex for a single segment of the given start time and
   * duration at the given URIs.
   *
   * @param {number} startTime
   * @param {number} duration
   * @param {!Array.<string>} uris
   * @return {!SegmentIndex}
   * @export
   */
  static forSingleSegment(startTime, duration, uris) {
    const reference = new SegmentReference(
      /*  position= */ 1,
      /*  startTime= */ startTime,
      /*  endTime= */ startTime + duration,
      /*  getUris= */ () => uris,
      /*  startByte= */ 0,
      /*  endByte= */ null,
      /*  initSegmentReference= */ null,
      /*  presentationTimeOffset= */ startTime,
      /*  appendWindowStart= */ startTime,
      /*  appendWindowEnd= */ startTime + duration)
    return new SegmentIndex([reference])
  }
}

