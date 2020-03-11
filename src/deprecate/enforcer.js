// import Version from './version'
/* *
 * The enforcer's job is to call the correct callback when a feature will need
 * to be removed later or removed now.
 *
 * The 'what should be done' is not part of the enforcer, that must be provided
 * to the enforcer when it is created. This separation was created so that
 * testing and production could be equal users of the enforcer.
 *
 * @final
 */
export default class Enforcer {
  /* *
   * @param {!Version} libraryVersion
   * @param {Listener} onPending
   * @param {Listener} onExpired
   */
  constructor(libraryVersion, onPending, onExpired) {
    /* * @private {!Version} */
    this.libraryVersion_ = libraryVersion

    /* * @private {Listener} */
    this.onPending_ = onPending
    /* * @private {Listener} */
    this.onExpired_ = onExpired
  }

  /* *
   * Tell the enforcer that a feature will expire on |expiredOn| and that it
   * should notify the listeners if it is pending or expired.
   *
   * @param {!Version} expiresOn
   * @param {string} name
   * @param {string} description
   */
  enforce(expiresOn, name, description) {
    // If the expiration version is larger than the library version
    // (compareTo > 0), it means the expiration is in the future, and is still
    // pending.
    const isPending = expiresOn.compareTo(this.libraryVersion_) > 0

    // Find the right callback (pending or expired) for this enforcement request
    // call it to handle this features pending/expired removal.
    const callback = isPending ? this.onPending_ : this.onExpired_
    callback(this.libraryVersion_, expiresOn, name, description)
  }
}

/* *
 * A callback for listening to deprecation events.
 *
 * Parameters:
 *  libraryVersion: !Version
 *  featureVersion: !Version
 *  name: string
 *  description: string
 *
 * libraryVersion: The current version of the library.
 * featureVersion: The version of the library when the feature should be
 *                 removed.
 * name: The name of the feature that will/should be removed.
 * description: A description of what is changing.
 *
 * @typedef {function(
 *    !Version,
 *    !Version,
 *    string,
 *    string)}
 */
// Listener
