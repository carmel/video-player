import AdaptationSet from '../media/adaptation_set'
import StreamUtils from '../util/stream_utils'
import LanguageUtils from '../util/language_utils'

/**
 * An adaptation set criteria is a unit of logic that can take a set of
 * variants and return a subset of variants that should (and can) be
 * adapted between.
 *
 * @interface
 */
export class AdaptationSetCriteria {
  /**
   * Take a set of variants, and return a subset of variants that can be
   * adapted between.
   *
   * @param {!Array.<shaka.extern.Variant>} variants
   * @return {!AdaptationSet}
   */
  create(variants) {}
}
/**
 * @implements {AdaptationSetCriteria}
 * @final
 */
export class ExampleBasedCriteria {
  /**
   * @param {shaka.extern.Variant} example
   */
  constructor(example) {
    /** @private {shaka.extern.Variant} */
    this.example_ = example

    // We can't know if role and label are really important, so we don't use
    // role and label for this.
    const role = ''
    const label = ''
    const channelCount = example.audio && example.audio.channelsCount
      ? example.audio.channelsCount
      : 0

    /** @private {!AdaptationSetCriteria} */
    this.fallback_ = new PreferenceBasedCriteria(
      example.language, role, channelCount, label)
  }

  /** @override */
  create(variants) {
    // We can't assume that the example is in |variants| because it could
    // actually be from another period.
    const shortList = variants.filter((variant) => {
      return AdaptationSet.areAdaptable(this.example_, variant)
    })

    if (shortList.length) {
      // Use the first item in the short list as the root. It should not matter
      // which element we use as all items in the short list should already be
      // compatible.
      return new AdaptationSet(shortList[0], shortList)
    } else {
      return this.fallback_.create(variants)
    }
  }
}
/**
 * @implements {AdaptationSetCriteria}
 * @final
 */
export class PreferenceBasedCriteria {
  /**
   * @param {string} language
   * @param {string} role
   * @param {number} channelCount
   * @param {string=} label
   * @param {string=} type
   */
  constructor(language, role, channelCount, label = '', type = '') {
    /** @private {string} */
    this.language_ = language
    /** @private {string} */
    this.role_ = role
    /** @private {number} */
    this.channelCount_ = channelCount
    /** @private {string} */
    this.label_ = label
    /** @private {string} */
    this.type_ = type
  }

  /** @override */
  create(variants) {
    const Class = PreferenceBasedCriteria
    let current = []

    const byLanguage = Class.filterByLanguage_(variants, this.language_)
    const byPrimary = variants.filter((variant) => variant.primary)

    if (byLanguage.length) {
      current = byLanguage
    } else if (byPrimary.length) {
      current = byPrimary
    } else {
      current = variants
    }

    // Now refine the choice based on role preference.
    if (this.role_) {
      const byRole = Class.filterVariantsByRole_(current, this.role_,
        this.type_)
      if (byRole.length) {
        current = byRole
      } else {
        console.warn('No exact match for variant role could be found.')
      }
    }

    if (this.channelCount_) {
      const byChannel = StreamUtils.filterVariantsByAudioChannelCount(
        current, this.channelCount_)
      if (byChannel.length) {
        current = byChannel
      } else {
        console.warn(
          'No exact match for the channel count could be found.')
      }
    }

    if (this.label_) {
      const byLabel = Class.filterVariantsByLabel_(current, this.label_)
      if (byLabel.length) {
        current = byLabel
      } else {
        console.warn('No exact match for variant label could be found.')
      }
    }

    // Make sure we only return a valid adaptation set.
    const set = new AdaptationSet(current[0])
    for (const variant of current) {
      if (set.canInclude(variant)) {
        set.add(variant)
      }
    }

    return set
  }

  /**
   * @param {!Array.<shaka.extern.Variant>} variants
   * @param {string} preferredLanguage
   * @return {!Array.<shaka.extern.Variant>}
   * @private
   */
  static filterByLanguage_(variants, preferredLanguage) {
    /** @type {string} */
    const preferredLocale = LanguageUtils.normalize(preferredLanguage)

    /** @type {?string} */
    const closestLocale = LanguageUtils.findClosestLocale(
      preferredLocale,
      variants.map((variant) => LanguageUtils.getLocaleForVariant(variant)))

    // There were no locales close to what we preferred.
    if (!closestLocale) {
      return []
    }

    // Find the variants that use the closest variant.
    return variants.filter((variant) => {
      return closestLocale === LanguageUtils.getLocaleForVariant(variant)
    })
  }

  /**
   * Filter Variants by role.
   *
   * @param {!Array.<shaka.extern.Variant>} variants
   * @param {string} preferredRole
   * @param {string} type
   * @return {!Array.<shaka.extern.Variant>}
   * @private
   */
  static filterVariantsByRole_(variants, preferredRole, type) {
    return variants.filter((variant) => {
      if (type) {
        const stream = variant[type]
        return stream && stream.roles.includes(preferredRole)
      } else {
        const audio = variant.audio
        const video = variant.video
        return (audio && audio.roles.includes(preferredRole)) ||
               (video && video.roles.includes(preferredRole))
      }
    })
  }

  /**
   * Filter Variants by label.
   *
   * @param {!Array.<shaka.extern.Variant>} variants
   * @param {string} preferredLabel
   * @return {!Array.<shaka.extern.Variant>}
   * @private
   */
  static filterVariantsByLabel_(variants, preferredLabel) {
    return variants.filter((variant) => {
      if (!variant.audio) {
        return false
      }

      const label1 = variant.audio.label.toLowerCase()
      const label2 = preferredLabel.toLowerCase()
      return label1 === label2
    })
  }
}
