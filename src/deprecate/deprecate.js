import Enforcer from './enforcer'
import Version from './version'

/* *
 * |shaka.Deprecate| is the front-end of the deprecation system, allowing for
 * any part of the code to say that 'this block of code should be removed by
 * version X'.
 *
 * @final
 */
export default class Deprecate {
  /* *
   * Initialize the system. This must happen before any calls to |enforce|. In
   * our code base, |shaka.Player| will be the only one to call this (it has the
   * version string).
   *
   * If the |Deprecate| called |Player.version| to initialize itself, it would
   * mean that |Player| could not use |Deprecate| because it would create a
   * circular dependency. To work around this, we provide this method so that
   * |Player| can give us the version without us needing to know about |Player|.
   *
   * This will initialize the system to:
   *  - print warning messages when the feature is scheduled to be removed in a
   *    later version
   *  - print errors and fail assertions when the feature should be removed now
   *
   * @param {string} versionString
   */
  static init(versionString) {
    console.assert(Deprecate.enforcer_ == null, 'Deprecate.init should only be called once.')
    Deprecate.enforcer_ = new Enforcer(
      Version.parse(versionString),
      Deprecate.onPending_,
      Deprecate.onExpired_)
  }

  /* *
   * Ask the deprecation system to require this feature to be removed by the
   * given version.
   *
   * @param {number} major
   * @param {number} minor
   * @param {string} name
   * @param {string} description
   */
  static deprecateFeature(major, minor, name, description) {
    const enforcer = Deprecate.enforcer_
    console.assert(
      enforcer,
      'Missing deprecation enforcer. Was |init| called?')

    const expiresAt = new Version(major, minor)
    enforcer.enforce(expiresAt, name, description)
  }

  /* *
   * @param {!Version} libraryVersion
   * @param {!Version} featureVersion
   * @param {string} name
   * @param {string} description
   * @private
   */
  static onPending_(libraryVersion, featureVersion, name, description) {
    // If we were to pass each value to the log call, it would be printed as
    // a comma-separated list. To make the print state appear more natural to
    // the reader, create one string for the message.
    console.warn([
      name,
      'has been deprecated and will be removed in',
      featureVersion,
      '. We are currently at version',
      libraryVersion,
      '. Additional information:',
      description
    ].join(' '))
  }

  /* *
   * @param {!Version} libraryVersion
   * @param {!Version} featureVersion
   * @param {string} name
   * @param {string} description
   * @private
   */
  static onExpired_(libraryVersion, featureVersion, name, description) {
    // If we were to pass each value to the log call, it would be printed as
    // a comma-separated list. To make the print state appear more natural to
    // the reader, create one string for the message.
    const errorMessage = [
      name,
      'has been deprecated and has been removed in',
      featureVersion,
      '. We are now at version',
      libraryVersion,
      '. Additional information:',
      description
    ].join('')

    console.error(errorMessage)
    console.assert(false, errorMessage)
  }
}

Deprecate.enforcer_ = null
