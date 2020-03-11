import StreamUtils from './stream_utils'
import MediaSourceEngine from '../media/media_source_engine'

/* *
 * This utility class contains all the functions used to filter manifests
 * before playback and before storage.
 */
export default class ManifestFilter {
  /* *
   * Filter the variants in |manifest| to only include the variants that meet
   * the given restrictions.
   *
   * @param {shaka.extern.Manifest} manifest
   * @param {shaka.extern.Restrictions} restrictions
   * @param {{width: number, height:number}} maxHwResolution
   */
  static filterByRestrictions(manifest, restrictions, maxHwResolution) {
    for (const period of manifest.periods) {
      period.variants = period.variants.filter((variant) => {
        return StreamUtils.meetsRestrictions(
          variant, restrictions, maxHwResolution)
      })
    }
  }
  /* *
   * Filter the variants in the |manifest| to only include those that are
   * supported by media source.
   *
   * @param {shaka.extern.Manifest} manifest
   */
  static filterByMediaSourceSupport(manifest) {
    for (const period of manifest.periods) {
      period.variants = period.variants.filter((variant) => {
        let supported = true
        if (variant.audio) {
          supported =
              supported && MediaSourceEngine.isStreamSupported(variant.audio)
        }
        if (variant.video) {
          supported =
              supported && MediaSourceEngine.isStreamSupported(variant.video)
        }
        return supported
      })
    }
  }

  /* *
   * Filter the variants in |manifest| to only include those that are supported
   * by |drm|.
   *
   * @param {shaka.extern.Manifest} manifest
   * @param {!DrmEngine} drmEngine
   */
  static filterByDrmSupport(manifest, drmEngine) {
    for (const period of manifest.periods) {
      period.variants = period.variants.filter((variant) => {
        return drmEngine.supportsVariant(variant)
      })
    }
  }

  /* *
   * Filter the variants in |manifest| to only include those that use codecs
   * that will be supported in each variant. This ensures playback from the
   * first period to the last period by 'jumping between' compatible variants.
   *
   * @param {shaka.extern.Manifest} manifest
   */
  static filterByCommonCodecs(manifest) {
    console.assert(manifest.periods.length > 0,
      'There should be at least be one period')

    const ManifestFilter = ManifestFilter

    // Create a set of summaries that occur in each period.
    /* * @type {!ManifestFilter.VariantCodecSummarySet} */
    const common = new ManifestFilter.VariantCodecSummarySet()

    let first = true
    for (const period of manifest.periods) {
      /* * @type {!ManifestFilter.VariantCodecSummarySet} */
      const next = ManifestFilter.VariantCodecSummarySet.fromVariants(
        period.variants)

      if (first) {
        common.includeAll(next)
        first = false
      } else {
        common.onlyKeep(next)
      }
    }

    // Filter the variants in the period by whether they match a summary that
    // occurs in every period.
    for (const period of manifest.periods) {
      period.variants = period.variants.filter((variant) => {
        const summary = new ManifestFilter.VariantCodecSummary(variant)
        return common.contains(summary)
      })
    }
  }

  /* *
   * Go through each period and apply the filter to the set of variants.
   * |filter| will only be given the set of variants in the current period that
   * are compatible with at least one variant in the previous period.
   *
   * @param {shaka.extern.Manifest} manifest
   * @param {function(shaka.extern.Period):!Promise} filter
   * @return {!Promise}
   */
  static async rollingFilter(manifest, filter) {
    // Store a reference to the variants so that the next period can easily
    // reference them too.
    /* * @type {ManifestFilter.VariantCodecSummarySet} */
    let previous = null

    for (const period of manifest.periods) {
      // Remove all variants that don't have a compatible variant in the
      // previous period. If we were to only use the first variant, we would
      // risk a variant being removed from a later period that would break that
      // path across all periods.
      if (previous) {
        period.variants = period.variants.filter((variant) => {
          const summary =
              new ManifestFilter.VariantCodecSummary(variant)
          return previous.contains(summary)
        })
      }

      // eslint-disable-next-line no-await-in-loop
      await filter(period)

      // Use the results of filtering this period as the 'previous' for the
      // next period.
      previous = ManifestFilter.VariantCodecSummarySet.fromVariants(
        period.variants)
    }
  }
}
/* *
 * The variant codec summary is a summary of the codec information for a given
 * codec. This can be used to test the compatibility between variants by
 * checking that their summaries contain the same information.
 *
 * @final
 */
ManifestFilter.VariantCodecSummary = class {
  /* *
   * @param {shaka.extern.Variant} variant
   */
  constructor(variant) {
    // We summarize a variant based on the basic mime type and the basic
    // codec because they must match for two variants to be compatible. For
    // example, we can't adapt between WebM and MP4, nor can we adapt between
    // mp4a.* to ec-3.

    const audio = variant.audio
    const video = variant.video

    /* * @private {?string} */
    this.audioMime_ = audio ? audio.mimeType : null
    /* * @private {?string} */
    this.audioCodec_ = audio ? audio.codecs.split('.')[0] : null
    /* * @private {?string} */
    this.videoMime_ = video ? video.mimeType : null
    /* * @private {?string} */
    this.videoCodec_ = video ? video.codecs.split('.')[0] : null
  }

  /* *
   * Check if this summaries is equal to another.
   *
   * @param {!ManifestFilter.VariantCodecSummary} other
   * @return {boolean}
   */
  equals(other) {
    return this.audioMime_ === other.audioMime_ &&
           this.audioCodec_ === other.audioCodec_ &&
           this.videoMime_ === other.videoMime_ &&
           this.videoCodec_ === other.videoCodec_
  }
}
/* *
 * @final
 */
ManifestFilter.VariantCodecSummarySet = class {
  constructor() {
    /* * @private {!Array.<!ManifestFilter.VariantCodecSummary>} */
    this.all_ = []
  }

  /* *
   * @param {!ManifestFilter.VariantCodecSummary} summary
   */
  add(summary) {
    if (!this.contains(summary)) {
      this.all_.push(summary)
    }
  }

  /* *
   * Add all items from |other| to |this|.
   * @param {!ManifestFilter.VariantCodecSummarySet} other
   */
  includeAll(other) {
    for (const item of other.all_) {
      this.add(item)
    }
  }

  /* *
   * Remove all items from |this| that are not in |other|.
   * @param {!ManifestFilter.VariantCodecSummarySet} other
   */
  onlyKeep(other) {
    this.all_ = this.all_.filter((x) => other.contains(x))
  }

  /* *
   * @param {!ManifestFilter.VariantCodecSummary} summary
   * @return {boolean}
   */
  contains(summary) {
    return this.all_.some((x) => summary.equals(x))
  }

  /* *
   * Create a set of variant codec summaries for a list of variants. The set
   * may have fewer elements than the list if there are variants with similar
   * codecs.
   *
   * @param {!Array.<shaka.extern.Variant>} variants
   * @return {!ManifestFilter.VariantCodecSummarySet}
   */
  static fromVariants(variants) {
    const set = new ManifestFilter.VariantCodecSummarySet()
    for (const variant of variants) {
      set.add(new ManifestFilter.VariantCodecSummary(variant))
    }
    return set
  }
}
