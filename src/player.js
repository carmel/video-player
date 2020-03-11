import FakeEventTarget from './util/fake_event_target'
import EventManager from './util/event_manager'
import FakeEvent from './util/fake_event'
import ActiveStreamMap from './media/active_stream_map'
import { MuxJSClosedCaptionParser, NoopCaptionParser } from './media/closed_caption_parser'
import { PreferenceBasedCriteria } from './media/adaptation_set_criteria'
import BufferingObserver from './media/buffering_observer'
import MediaSourceEngine from './media/media_source_engine'
import ManifestParser from './media/manifest_parser'
import RegionTimeline from './media/region_timeline'
import { SrcEqualsPlayhead, MediaSourcePlayhead } from './media/playhead'
import PlayRateController from './media/play_rate_controller'
import PeriodObserver from './media/period_observer'
import RegionObserver from './media/region_observer'
import { PlayheadObserverManager } from './media/playhead_observer'
import StreamingEngine from './media/streaming_engine'
import PlayerConfiguration from './util/player_configuration'
import SimpleTextDisplayer from './text/simple_text_displayer'
import { NetworkingEngine } from './net/networking_engine'
import Functional from './util/functional'
import AbortableOperation from './util/abortable_operation'
import Stats from './util/stats'
import Timer from './util/timer'
import Platform from './util/platform'
import ObjectUtils from './util/object_utils'
import PublicPromise from './util/public_promise'
import ManifestParserUtils from './util/manifest_parser_utils'
import MimeUtils from './util/mime_utils'
import StreamUtils from './util/stream_utils'
import ArrayUtils from './util/array_utils'
import TimeRangesUtils from './media/time_ranges_utils'
import { Walker } from './routing/walker'
import Deprecate from './deprecate/deprecate'
import ConfigUtils from './util/config_utils'
import Error from './util/error'
import conf from './config'

const LoadMode = {
  'DESTROYED': 0,
  'NOT_LOADED': 1,
  'MEDIA_SOURCE': 2,
  'SRC_EQUALS': 3
}

/* *
 * The typical buffering threshold.  When we have less than this buffered (in
 * seconds), we enter a buffering state.  This specific value is based on manual
 * testing and evaluation across a variety of platforms.
 *
 * To make the buffering logic work in all cases, this 'typical' threshold will
 * be overridden if the rebufferingGoal configuration is too low.
 *
 * @const {number}
 * @private
 */
const TYPICAL_BUFFERING_THRESHOLD_ = 0.5

const restrictedStatuses_ = ['output-restricted', 'internal-error']

export default class Player extends FakeEventTarget {
  /* *
   * @param {dom元素} mediaElement
   *    When provided, the player will attach to <code>mediaElement</code>,
   *    similar to calling <code>attach</code>. When not provided, the player
   *    will remain detached.
   */
  constructor(mediaElement) {
    super()
    this.loadMode_ = LoadMode.NOT_LOADED

    /* * @private {HTMLMediaElement} */
    this.video_ = null

    /* *
     * Since we may not always have a text displayer created (e.g. before |load|
     * is called), we need to track what text visibility SHOULD be so that we
     * can ensure that when we create the text displayer. When we create our
     * text displayer, we will use this to show (or not show) text as per the
     * user's requests.
     *
     * @private {boolean}
     */
    this.isTextVisible_ = false

    /* * @private {EventManager} */
    this.eventManager_ = new EventManager()

    /* * @private {media.MediaSourceEngine} */
    this.mediaSourceEngine_ = null

    /* * @private {media.Playhead} */
    this.playhead_ = null

    /* *
     * The playhead observers are used to monitor the position of the playhead
     * and some other source of data (e.g. buffered content), and raise events.
     * 用于监视播放头和其他数据源（例如，缓冲的内容）的位置，并触发相应事件
     * @private {media.PlayheadObserverManager}
     */
    this.playheadObservers_ = null

    /* *
     * This is our control over the playback rate of the media element. This
     * provides the missing functionality that we need to provide trick play,
     * for example a negative playback rate.
     * 媒体元素播放速率的控制器
     * @private {media.PlayRateController}
     */
    this.playRateController_ = null

    // We use the buffering observer and timer to track when we move from having
    // enough buffered content to not enough. They only exist when content has
    // been loaded and are not re-used between loads.
    // 使用缓冲的观察器和计时器来跟踪何时从拥有足够的缓冲内容变为不足
    /* * @private {Timer} */
    this.bufferPoller_ = null

    /* * @private {media.BufferingObserver} */
    this.bufferObserver_ = null

    /* * @private {media.RegionTimeline} */
    this.regionTimeline_ = null

    /* * @private {media.StreamingEngine} */
    this.streamingEngine_ = null

    /* * @private {shaka.extern.ManifestParser} */
    this.parser_ = null

    /* * @private {?shaka.extern.ManifestParser.Factory} */
    this.parserFactory_ = null

    /* * @private {?shaka.extern.Manifest} */
    this.manifest_ = null

    /* * @private {?string} */
    this.assetUri_ = null

    /* * @private {shaka.extern.AbrManager} */
    this.abrManager_ = null

    /* *
     * The factory that was used to create the abrManager_ instance.
     * @private {?shaka.extern.AbrManager.Factory}
     */
    this.abrManagerFactory_ = null

    /* *
     * Contains an ID for use with creating streams.  The manifest parser should
     * start with small IDs, so this starts with a large one.
     * @private {number}
     */
    this.nextExternalStreamId_ = 1e9

    /* * @private {!Set.<shaka.extern.Stream>} */
    this.loadingTextStreams_ = new Set()

    /* * @private {boolean} */
    this.switchingPeriods_ = true

    /* * @private {?shaka.extern.Variant} */
    this.deferredVariant_ = null

    /* * @private {boolean} */
    this.deferredVariantClearBuffer_ = false

    /* * @private {number} */
    this.deferredVariantClearBufferSafeMargin_ = 0

    /* * @private {?shaka.extern.Stream} */
    this.deferredTextStream_ = null

    /* *
     * A mapping of which streams are/were active in each period. Used when the
     * current period (the one containing playhead) differs from the active
     * period (the one being streamed in by streaming engine).
     *
     * @private {!media.ActiveStreamMap}
     */
    this.activeStreams_ = new ActiveStreamMap()

    this.config_ = this.defaultConfig_()

    /* *
     * The TextDisplayerFactory that was last used to make a text displayer.
     * Stored so that we can tell if a new type of text displayer is desired.
     * @private {?shaka.extern.TextDisplayer.Factory}
     */
    this.lastTextFactory_

    /* * @private {{width: number, height: number}} */
    this.maxHwRes_ = { width: Infinity, height: Infinity }

    /* * @private {Stats} */
    this.stats_ = null

    /* * @private {!media.AdaptationSetCriteria} */
    this.currentAdaptationSetCriteria_ =
        new PreferenceBasedCriteria(
          this.config_.preferredAudioLanguage,
          this.config_.preferredVariantRole,
          this.config_.preferredAudioChannelCount)

    /* * @private {string} */
    this.currentTextLanguage_ = this.config_.preferredTextLanguage

    /* * @private {string} */
    this.currentTextRole_ = this.config_.preferredTextRole

    this.networkingEngine_ = this.createNetworkingEngine()

    /* * @private {shaka.extern.IAdManager} */
    this.adManager_ = null

    if (Player.adManagerFactory_) {
      this.adManager_ = Functional.callFactory(Player.adManagerFactory_)
    }

    // If the browser comes back online after being offline, then try to play again.
    this.eventManager_.listen(window, 'online', () => {
      this.retryStreaming()
    })

    /* * @private {shaka.routing.Node} */
    this.detachNode_ = { name: 'detach' }
    /* * @private {shaka.routing.Node} */
    this.attachNode_ = { name: 'attach' }
    /* * @private {shaka.routing.Node} */
    this.unloadNode_ = { name: 'unload' }
    /* * @private {shaka.routing.Node} */
    this.parserNode_ = { name: 'manifest-parser' }
    /* * @private {shaka.routing.Node} */
    this.manifestNode_ = { name: 'manifest' }
    /* * @private {shaka.routing.Node} */
    this.mediaSourceNode_ = { name: 'media-source' }
    /* * @private {shaka.routing.Node} */
    this.loadNode_ = { name: 'load' }
    /* * @private {shaka.routing.Node} */
    this.srcEqualsNode_ = { name: 'src-equals' }

    const actions = new Map()
    actions.set(this.attachNode_, (has, wants) => {
      return AbortableOperation.notAbortable(this.onAttach_(has, wants))
    })
    actions.set(this.detachNode_, (has, wants) => {
      return AbortableOperation.notAbortable(this.onDetach_(has, wants))
    })
    actions.set(this.unloadNode_, (has, wants) => {
      return AbortableOperation.notAbortable(this.onUnload_(has, wants))
    })
    actions.set(this.mediaSourceNode_, (has, wants) => {
      const p = this.onInitializeMediaSourceEngine_(has, wants)
      return AbortableOperation.notAbortable(p)
    })
    actions.set(this.parserNode_, (has, wants) => {
      const p = this.onInitializeParser_(has, wants)
      return AbortableOperation.notAbortable(p)
    })
    actions.set(this.manifestNode_, (has, wants) => {
      // This action is actually abortable, so unlike the other callbacks, this
      // one will return an abortable operation.
      return this.onParseManifest_(has, wants)
    })
    actions.set(this.loadNode_, (has, wants) => {
      return AbortableOperation.notAbortable(this.onLoad_(has, wants))
    })
    actions.set(this.srcEqualsNode_, (has, wants) => {
      return this.onSrcEquals_(has, wants)
    })

    /* * @private {routing.Walker.Implementation} */
    const walkerImplementation = {
      getNext: (at, has, goingTo, wants) => {
        return this.getNextStep_(at, has, goingTo, wants)
      },
      enterNode: (node, has, wants) => {
        this.dispatchEvent(this.makeEvent_(
          /*  name= */ conf.EventName.OnStateChange,
          /*  data= */ { 'state': node.name }))

        const action = actions.get(node)
        return action(has, wants)
      },
      handleError: async(has, error) => {
        console.warn('The walker saw an error:')
        if (error instanceof Error) {
          console.error('Error Code:', error.code)
        } else {
          console.error('Error Message:', error.message)
          console.error('Error Stack:', error.stack)
        }

        // Regardless of what state we were in, if there is an error, we unload.
        // This ensures that any initialized system will be torn-down and we
        // will go back to a safe foundation. We assume that the media element
        // is always safe to use after an error.
        await this.onUnload_(has, Player.createEmptyPayload_())

        // There are only two nodes that come before we start loading content,
        // attach and detach. If we have a media element, it means we were
        // attached to the element, and we can safely return to the attach state
        // (we assume that the video element is always re-usable). We favor
        // returning to the attach node since it means that the app won't need
        // to re-attach if it saw an error.
        return has.mediaElement ? this.attachNode_ : this.detachNode_
      },
      onIdle: (node) => {
        this.dispatchEvent(this.makeEvent_(
          /*  name= */ conf.EventName.OnStateIdle,
          /*  data= */ { 'state': node.name }))
      }
    }

    /* * @private {routing.Walker} */
    this.walker_ = new Walker(this.detachNode_, Player.createEmptyPayload_(), walkerImplementation)

    // Even though |attach| will start in later interpreter cycles, it should be
    // the LAST thing we do in the constructor because conceptually it relies on
    // player having been initialized.
    if (mediaElement) {
      this.attach(mediaElement, /*  initializeMediaSource= */ true)
    }
  }
  /* *
   * @return {Payload}
   * @private
   */
  static createEmptyPayload_() {
    return {
      mediaElement: null,
      mimeType: null,
      startTime: null,
      startTimeOfLoad: null,
      uri: null
    }
  }
  /* *
   * Applies playRangeStart and playRangeEnd to the given timeline. This will
   * only affect non-live content.
   *
   * @param {PresentationTimeline} timeline
   * @param {number} playRangeStart
   * @param {number} playRangeEnd
   *
   * @private
   */
  static applyPlayRange_(timeline, playRangeStart, playRangeEnd) {
    if (playRangeStart > 0) {
      if (timeline.isLive()) {
        console.warning(
          '|playRangeStart| has been configured for live content. ' +
            'Ignoring the setting.')
      } else {
        timeline.setUserSeekStart(playRangeStart)
      }
    }

    // If the playback has been configured to end before the end of the
    // presentation, update the duration unless it's live content.
    const fullDuration = timeline.getDuration()
    if (playRangeEnd < fullDuration) {
      if (timeline.isLive()) {
        console.warning(
          '|playRangeEnd| has been configured for live content. ' +
            'Ignoring the setting.')
      } else {
        timeline.setDuration(playRangeEnd)
      }
    }
  }
  /* *
   * @return {shaka.extern.PlayerConfiguration}
   * @private
   */
  defaultConfig_() {
    const config = PlayerConfiguration.createDefault()
    config.streaming.failureCallback = (error) => {
      this.defaultStreamingFailureCallback_(error)
    }

    // Because this.video_ may not be set when the config is built, the default
    // TextDisplay factory must capture a reference to `this`.
    config.textDisplayFactory = () => new SimpleTextDisplayer(this.video_)

    return config
  }
  defaultStreamingFailureCallback_(error) {
    const retryErrorCodes = [
      Error.Code.BAD_HTTP_STATUS,
      Error.Code.HTTP_ERROR,
      Error.Code.TIMEOUT
    ]

    if (this.isLive() && retryErrorCodes.includes(error.code)) {
      error.severity = Error.Severity.RECOVERABLE

      console.warning('Live streaming error.  Retrying automatically...')
      this.retryStreaming()
    }
  }
  createNetworkingEngine() {
    /* * @type {function(number, number)} */
    const onProgressUpdated_ = (deltaTimeMs, bytesDownloaded) => {
      // In some situations, such as during offline storage, the abr manager
      // might not yet exist. Therefore, we need to check if abr manager has
      // been initialized before using it.
      if (this.abrManager_) {
        this.abrManager_.segmentDownloaded(deltaTimeMs, bytesDownloaded)
      }
    }
    return new NetworkingEngine(onProgressUpdated_)
  }
  retryStreaming() {
    return this.loadMode_ === LoadMode.MEDIA_SOURCE ? this.streamingEngine_.retry() : false
  }
  /* *
   * This should only be called by the load graph when it is time to attach to
   * a media element. The only times this may be called are when we are being
   * asked to re-attach to the current media element, or attach to a new media
   * element while not attached to a media element.
   *
   * This method assumes that it is safe for it to execute, the load-graph is
   * responsible for ensuring all assumptions are true.
   *
   * Attaching to a media element is defined as:
   *  - Registering error listeners to the media element.
   *  - Caching the video element for use outside of the load graph.
   *
   * @param {Payload} has
   * @param {Payload} wants
   * @return {!Promise}
   * @private
   */
  onAttach_(has, wants) {
    // If we don't have a media element yet, it means we are entering
    // 'attach' from another node.
    //
    // If we have a media element, it should match |wants.mediaElement|
    // because it means we are going from 'attach' to 'attach'.
    //
    // These constraints should be maintained and guaranteed by the routing
    // logic in |getNextStep_|.
    console.assert(has.mediaElement === null || has.mediaElement === wants.mediaElement,
      'The routing logic failed. MediaElement requirement failed.')

    if (has.mediaElement === null) {
      has.mediaElement = wants.mediaElement
      const onError = (error) => this.onVideoError_(error)
      this.eventManager_.listen(has.mediaElement, 'error', onError)
    }

    this.video_ = has.mediaElement
    return Promise.resolve()
  }
  /* *
   * This should only be called by the load graph when it is time to detach from
   * a media element. The only times this may be called are when we are being
   * asked to detach from the current media element, or detach when we are
   * already detached.
   *
   * This method assumes that it is safe for it to execute, the load-graph is
   * responsible for ensuring all assumptions are true.
   *
   * Detaching from a media element is defined as:
   *  - Removing error listeners from the media element.
   *  - Dropping the cached reference to the video element.
   *
   * @param {Payload} has
   * @param {Payload} wants
   * @return {!Promise}
   * @private
   */
  onDetach_(has, wants) {
    // If we are going from 'detached' to 'detached' we wouldn't have a media element to detach from.
    if (has.mediaElement) {
      this.eventManager_.unlisten(has.mediaElement, 'error')
      has.mediaElement = null
    }

    // Clear our cached copy of the media element.
    this.video_ = null
    return Promise.resolve()
  }
  /* *
   * This should only be called by the load graph when it is time to unload all
   * currently initialized playback components. Unlike the other load actions,
   * this action is built to be more general. We need to do this because we
   * don't know what state the player will be in before unloading (including
   * after an error occurred in the middle of a transition).
   *
   * This method assumes that any component could be |null| and should be safe
   * to call from any point in the load graph.
   *
   * @param {Payload} has
   * @param {Payload} wants
   * @return {!Promise}
   * @private
   */
  async onUnload_(has, wants) {
    // Set the load mode to unload right away so that all the public methods
    // will stop using the internal components. We need to make sure that we
    // are not overriding the destroyed state because we will unload when we are
    // destroying the player.
    if (this.loadMode_ !== LoadMode.DESTROYED) {
      this.loadMode_ = LoadMode.NOT_LOADED
    }

    this.dispatchEvent(this.makeEvent_(conf.EventName.Unloading))

    // Remove everything that has to do with loading content from our payload
    // since we are releasing everything that depended on it.
    has.mimeType = null
    has.startTime = null
    has.uri = null

    // In most cases we should have a media element. The one exception would
    // be if there was an error and we, by chance, did not have a media element.
    if (has.mediaElement) {
      this.eventManager_.unlisten(has.mediaElement, 'loadeddata')
      this.eventManager_.unlisten(has.mediaElement, 'playing')
      this.eventManager_.unlisten(has.mediaElement, 'pause')
      this.eventManager_.unlisten(has.mediaElement, 'ended')
      this.eventManager_.unlisten(has.mediaElement, 'ratechange')
    }

    // Some observers use some playback components, shutting down the observers
    // first ensures that they don't try to use the playback components
    // mid-destroy.
    if (this.playheadObservers_) {
      this.playheadObservers_.release()
      this.playheadObservers_ = null
    }

    if (this.bufferPoller_) {
      this.bufferPoller_.stop()
      this.bufferPoller_ = null
    }

    // Stop the parser early. Since it is at the start of the pipeline, it
    // should be start early to avoid is pushing new data downstream.
    if (this.parser_) {
      await this.parser_.stop()
      this.parser_ = null
      this.parserFactory_ = null
    }

    // Abr Manager will tell streaming engine what to do, so we need to stop
    // it before we destroy streaming engine. Unlike with the other components,
    // we do not release the instance, we will reuse it in later loads.
    if (this.abrManager_) {
      await this.abrManager_.stop()
    }

    // Streaming engine will push new data to media source engine, so we need
    // to shut it down before destroy media source engine.
    if (this.streamingEngine_) {
      await this.streamingEngine_.destroy()
      this.streamingEngine_ = null
    }

    // Playhead is used by StreamingEngine, so we can't destroy this until after
    // StreamingEngine has stopped.
    if (this.playhead_) {
      this.playhead_.release()
      this.playhead_ = null
    }

    // Media source engine holds onto the media element, and in order to detach
    // the media keys (with drm engine), we need to break the connection between
    // media source engine and the media element.
    if (this.mediaSourceEngine_) {
      await this.mediaSourceEngine_.destroy()
      this.mediaSourceEngine_ = null
    }

    if (this.adManager_) {
      this.adManager_.onAssetUnload()
    }

    // In order to unload a media element, we need to remove the src attribute
    // and then load again. When we destroy media source engine, this will be
    // done for us, but for src=, we need to do it here.
    //
    // DrmEngine requires this to be done before we destroy DrmEngine itself.
    if (has.mediaElement && has.mediaElement.src) {
      // TODO: Investigate this more.  Only reproduces on Firefox 69.
      // Introduce a delay before detaching the video source.  We are seeing
      // spurious Promise rejections involving an AbortError in our tests
      // otherwise.
      await new Promise((resolve) => new Timer(resolve).tickAfter(0.1))
      has.mediaElement.removeAttribute('src')
      has.mediaElement.load()
    }

    this.activeStreams_.clear()
    this.assetUri_ = null
    this.bufferObserver_ = null
    this.loadingTextStreams_.clear()
    this.manifest_ = null
    this.stats_ = new Stats() // Replace with a clean stats object.
    this.lastTextFactory_ = null
    this.switchingPeriods_ = true
    // Make sure that the app knows of the new buffering state.
    this.updateBufferState_()
  }
  /* *
   * Update the buffering state to be either 'we are buffering' or 'we are not
   * buffering', firing events to the app as needed.
   *
   * @private
   */
  updateBufferState_() {
    const isBuffering = this.isBuffering()
    console.info('Player changing buffering state to', isBuffering)
    // Make sure we have all the components we need before we consider ourselves as being loaded.
    // TODO: Make the check for 'loaded' simpler.
    const loaded = this.stats_ && this.bufferObserver_ && this.playhead_

    if (loaded) {
      this.playRateController_.setBuffering(isBuffering)
      this.updateStateHistory_()
    }

    // Surface the buffering event so that the app knows if/when we are
    // buffering.
    const eventName = conf.EventName.Buffering
    this.dispatchEvent(this.makeEvent_(eventName, { 'buffering': isBuffering }))
  }
  /* *
   * Try updating the state history. If the player has not finished
   * initializing, this will be a no-op.
   *
   * @private
   */
  updateStateHistory_() {
    // If we have not finish initializing, this will be a no-op.
    if (!this.stats_) {
      return
    }
    if (!this.bufferObserver_) {
      return
    }

    const history = this.stats_.getStateHistory()

    if (this.bufferObserver_.getState() === BufferingObserver.State.STARVING) {
      history.update('buffering')
    } else if (this.video_.paused) {
      history.update('paused')
    } else if (this.video_.ended) {
      history.update('ended')
    } else {
      history.update('playing')
    }
  }
  /* *
   * @param {!conf.EventName} name
   * @param {Object=} data
   * @return {!FakeEvent}
   * @private
   */
  makeEvent_(name, data) {
    return new FakeEvent(name, data)
  }
  /* *
   * This should only be called by the load graph when it is time to initialize
   * media source engine. The only time this may be called is when we are
   * attached to the same media element as in the request.
   *
   * This method assumes that it is safe for it to execute. The load-graph is
   * responsible for ensuring all assumptions are true.
   *
   * @param {Payload} has
   * @param {Payload} wants
   *
   * @return {!Promise}
   * @private
   */
  async onInitializeMediaSourceEngine_(has, wants) {
    console.assert(Platform.supportsMediaSource(), 'We should not be initializing media source on a platform that does not support media source.')
    console.assert(has.mediaElement, 'We should have a media element when initializing media source.')
    console.assert(has.mediaElement === wants.mediaElement, '|has| and |wants| should have the same media element when initializing media source.')
    console.assert(this.mediaSourceEngine_ === null, 'We should not have a media source engine yet.')

    const closedCaptionsParser = MuxJSClosedCaptionParser.isSupported() ? new MuxJSClosedCaptionParser() : new NoopCaptionParser()

    // When changing text visibility we need to update both the text displayer
    // and streaming engine because we don't always stream text. To ensure that
    // text displayer and streaming engine are always in sync, wait until they
    // are both initialized before setting the initial value.
    const textDisplayerFactory = this.config_.textDisplayFactory
    const textDisplayer = Functional.callFactory(textDisplayerFactory)
    this.lastTextFactory_ = textDisplayerFactory

    const mediaSourceEngine = this.createMediaSourceEngine(has.mediaElement, closedCaptionsParser, textDisplayer)

    // Wait for media source engine to finish opening. This promise should
    // NEVER be rejected as per the media source engine implementation.
    await mediaSourceEngine.open()

    // Wait until it is ready to actually store the reference.
    this.mediaSourceEngine_ = mediaSourceEngine
  }
  /* *
   * Create a new media source engine. This will ONLY be replaced by tests as a
   * way to inject fake media source engine instances.
   *
   * @param {!HTMLMediaElement} mediaElement
   * @param {!IClosedCaptionParser} closedCaptionsParser
   * @param {!extern.TextDisplayer} textDisplayer
   *
   * @return {!MediaSourceEngine}
   */
  createMediaSourceEngine(mediaElement, closedCaptionsParser, textDisplayer) {
    return new MediaSourceEngine(mediaElement, closedCaptionsParser, textDisplayer)
  }
  /* *
   * Create the parser for the asset located at |wants.uri|. This should only be
   * called as part of the load graph.
   *
   * This method assumes that it is safe for it to execute, the load-graph is
   * responsible for ensuring all assumptions are true.
   *
   * @param {Payload} has
   * @param {Payload} wants
   * @return {!Promise}
   * @private
   */
  async onInitializeParser_(has, wants) {
    console.assert(has.mediaElement, 'We should have a media element when initializing the parser.')
    console.assert(has.mediaElement === wants.mediaElement, '|has| and |wants| should have the same media element when initializing the parser.')
    console.assert(this.networkingEngine_, 'Need networking engine when initializing the parser.')
    console.assert(this.config_, 'Need player config when initializing the parser.')

    // We are going to 'lock-in' the mime type and uri since they are
    // what we are going to use to create our parser and parse the manifest.
    has.mimeType = wants.mimeType
    has.uri = wants.uri
    console.assert(has.uri, 'We should have an asset uri when initializing the parsing.')

    // Store references to things we asserted so that we don't need to reassert
    // them again later.
    const assetUri = has.uri
    const networkingEngine = this.networkingEngine_

    // Save the uri so that it can be used outside of the load-graph.
    this.assetUri_ = assetUri

    // Create the parser that we will use to parse the manifest.
    this.parserFactory_ = await ManifestParser.getFactory(assetUri, networkingEngine, this.config_.manifest.retryParameters, has.mimeType)
    console.assert(this.parserFactory_, 'Must have manifest parser')
    this.parser_ = Functional.callFactory(this.parserFactory_)

    const manifestConfig = ObjectUtils.cloneObject(this.config_.manifest)
    // Don't read video segments if the player is attached to an audio element
    if (wants.mediaElement && wants.mediaElement.nodeName === 'AUDIO') {
      manifestConfig.disableVideo = true
    }

    this.parser_.configure(manifestConfig)
  }
  /* *
   * Parse the manifest at |has.uri| using the parser that should have already
   * been created. This should only be called as part of the load graph.
   *
   * This method assumes that it is safe for it to execute, the load-graph is
   * responsible for ensuring all assumptions are true.
   *
   * @param {Payload} has
   * @param {Payload} wants
   * @return {!AbortableOperation}
   * @private
   */
  onParseManifest_(has, wants) {
    console.assert(has.mimeType === wants.mimeType, '|has| and |wants| should have the same mime type when parsing.')
    console.assert(has.uri === wants.uri, '|has| and |wants| should have the same uri when parsing.')
    console.assert(has.uri, '|has| should have a valid uri when parsing.')
    console.assert(has.uri === this.assetUri_, '|has.uri| should match the cached asset uri.')
    console.assert(this.networkingEngine_, 'Need networking engine to parse manifest.')
    console.assert(this.config_, 'Need player config to parse manifest.')
    console.assert(this.parser_, '|this.parser_| should have been set in an earlier step.')

    // Store references to things we asserted so that we don't need to reassert
    // them again later.
    const assetUri = has.uri
    const networkingEngine = this.networkingEngine_

    // This will be needed by the parser once it starts parsing, so we will
    // initialize it now even through it appears a little out-of-place.
    this.regionTimeline_ = new RegionTimeline()
    this.regionTimeline_.setListeners(/*  onRegionAdded= */ (region) => {
      this.onRegionEvent_(conf.EventName.TimelineRegionAdded, region)
    })

    const playerInterface = {
      networkingEngine: networkingEngine,
      filterNewPeriod: (period) => this.filterNewPeriod_(period),
      filterAllPeriods: (periods) => this.filterAllPeriods_(periods),
      // Called when the parser finds a timeline region. This can be called
      // before we start playback or during playback (live/in-progress
      // manifest).
      onTimelineRegionAdded: (region) => this.regionTimeline_.addRegion(region),
      onEvent: (event) => this.dispatchEvent(event),
      onError: (error) => this.onError_(error)
    }

    const startTime = Date.now() / 1000

    return new AbortableOperation(
      /*  promise= */ (async() => {
        this.manifest_ = await this.parser_.start(assetUri, playerInterface)

        // This event is fired after the manifest is parsed, but before any
        // filtering takes place.
        const event = this.makeEvent_(conf.EventName.ManifestParsed)
        this.dispatchEvent(event)

        // We require all manifests to have already one period.
        if (this.manifest_.periods.length === 0) {
          throw new Error(
            Error.Severity.CRITICAL,
            Error.Category.MANIFEST,
            Error.Code.NO_PERIODS)
        }

        // Make sure that all periods are either: audio-only, video-only, or
        // audio-video.
        Player.filterForAVVariants_(this.manifest_.periods)

        const now = Date.now() / 1000
        const delta = now - startTime
        this.stats_.setManifestTime(delta)
      })(),
      /*  onAbort= */ () => {
        console.info('Aborting parser step...')
        return this.parser_.stop()
      })
  }
  /* *
   * This should only be called by the load graph when it is time to set-up the
   * media element to play content using src=. The only times this may be called
   * is when we are attached to the same media element as in the request.
   *
   * This method assumes that it is safe for it to execute, the load-graph is
   * responsible for ensuring all assumptions are true.
   *
   * @param {Payload} has
   * @param {Payload} wants
   * @return {!AbortableOperation}
   *
   * @private
   */
  onSrcEquals_(has, wants) {
    console.assert(has.mediaElement, 'We should have a media element when loading.')
    console.assert(wants.uri, '|has| should have a valid uri when loading.')
    console.assert(wants.startTimeOfLoad, '|wants| should tell us when the load was originally requested')
    console.assert(this.video_ === has.mediaElement, 'The video element should match our media element')

    // Lock-in the values that we are using so that the routing logic knows what
    // we have.
    has.uri = wants.uri
    has.startTime = wants.startTime

    // Save the uri so that it can be used outside of the load-graph.
    this.assetUri_ = has.uri

    this.playhead_ = new SrcEqualsPlayhead(has.mediaElement)

    if (has.startTime !== null) {
      this.playhead_.setStartTime(has.startTime)
    }

    this.playRateController_ = new PlayRateController({
      getRate: () => has.mediaElement.playbackRate,
      setRate: (rate) => { has.mediaElement.playbackRate = rate },
      movePlayhead: (delta) => { has.mediaElement.currentTime += delta }
    })

    // We need to start the buffer management code near the end because it will
    // set the initial buffering state and that depends on other components
    // being initialized.
    this.startBufferManagement_(this.config_.streaming.rebufferingGoal)

    // Add all media element listeners.
    const updateStateHistory = () => this.updateStateHistory_()
    this.eventManager_.listen(has.mediaElement, 'playing', updateStateHistory)
    this.eventManager_.listen(has.mediaElement, 'pause', updateStateHistory)
    this.eventManager_.listen(has.mediaElement, 'ended', updateStateHistory)

    // Wait for the 'loadeddata' event to measure load() latency.
    this.eventManager_.listenOnce(has.mediaElement, 'loadeddata', () => {
      const now = Date.now() / 1000
      const delta = now - wants.startTimeOfLoad
      this.stats_.setLoadLatency(delta)
    })

    // The audio tracks are only available on Safari at the moment, but this
    // drives the tracks API for Safari's native HLS. So when they change,
    // fire the corresponding Shaka Player event.
    if (this.video_.audioTracks) {
      this.eventManager_.listen(this.video_.audioTracks, 'addtrack', () => this.onTracksChanged_())
      this.eventManager_.listen(this.video_.audioTracks, 'removetrack', () => this.onTracksChanged_())
      this.eventManager_.listen(this.video_.audioTracks, 'change', () => this.onTracksChanged_())
    }
    if (this.video_.textTracks) {
      // This is a real EventTarget, but the compiler doesn't know that.
      // TODO: File a bug or send a PR to the compiler externs to fix this.
      const textTracks = /* * @type {EventTarget} */(this.video_.textTracks)
      this.eventManager_.listen(textTracks, 'addtrack', () => this.onTracksChanged_())
      this.eventManager_.listen(textTracks, 'removetrack', () => this.onTracksChanged_())
      this.eventManager_.listen(textTracks, 'change', () => this.onTracksChanged_())
    }

    // By setting |src| we are done 'loading' with src=. We don't need to set
    // the current time because |playhead| will do that for us.
    has.mediaElement.src = has.uri

    // Set the load mode last so that we know that all our components are
    // initialized.
    this.loadMode_ = LoadMode.SRC_EQUALS

    // The event doesn't mean as much for src= playback, since we don't control
    // streaming.  But we should fire it in this path anyway since some
    // applications may be expecting it as a life-cycle event.
    this.dispatchEvent(this.makeEvent_(conf.EventName.Streaming))

    // This is fully loaded when we have loaded the first frame.
    const fullyLoaded = new PublicPromise()
    if (this.video_.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      // Already done!
      fullyLoaded.resolve()
    } else if (this.video_.error) {
      // Already failed!
      fullyLoaded.reject(this.videoErrorToShakaError_())
    } else {
      // Wait for success or failure.
      this.eventManager_.listenOnce(this.video_, 'loadeddata', () => {
        fullyLoaded.resolve()
      })
      this.eventManager_.listenOnce(this.video_, 'error', () => {
        fullyLoaded.reject(this.videoErrorToShakaError_())
      })
    }
    return new AbortableOperation(fullyLoaded, /*  onAbort= */ () => {
      const abortedError = new Error(
        Error.Severity.CRITICAL,
        Error.Category.PLAYER,
        Error.Code.OPERATION_ABORTED)
      fullyLoaded.reject(abortedError)
      return Promise.resolve() // Abort complete.
    })
  }
  /* *
   * Initialize and start the buffering system (observer and timer) so that we
   * can monitor our buffer lead during playback.
   *
   * @param {number} rebufferingGoal
   * @private
   */
  startBufferManagement_(rebufferingGoal) {
    console.assert(!this.bufferObserver_, 'No buffering observer should exist before initialization.')
    console.assert(!this.bufferPoller_, 'No buffer timer should exist before initialization.')

    // Give dummy values, will be updated below.
    this.bufferObserver_ = new BufferingObserver(1, 2)

    // Force us back to a buffering state. This ensure everything is starting in
    // the same state.
    this.bufferObserver_.setState(BufferingObserver.State.STARVING)
    this.updateBufferingSettings_(rebufferingGoal)
    this.updateBufferState_()

    // TODO: We should take some time to look into the effects of our
    //       quarter-second refresh practice. We often use a quarter-second
    //       but we have no documentation about why.
    this.bufferPoller_ = new Timer(() => {
      this.pollBufferState_()
    }).tickEvery(/*  seconds= */ 0.25)
  }
  /* *
   * Updates the buffering thresholds based on the new rebuffering goal.
   * @param {number} rebufferingGoal
   * @private
   */
  updateBufferingSettings_(rebufferingGoal) {
    // The threshold to transition back to satisfied when starving.
    const starvingThreshold = rebufferingGoal
    // The threshold to transition into starving when satisfied.
    // We use a 'typical' threshold, unless the rebufferingGoal is unusually
    // low.
    // Then we force the value down to half the rebufferingGoal, since
    // starvingThreshold must be strictly larger than satisfiedThreshold for the
    // logic in BufferingObserver to work correctly.
    const satisfiedThreshold = Math.min(TYPICAL_BUFFERING_THRESHOLD_, rebufferingGoal / 2)
    this.bufferObserver_.setThresholds(starvingThreshold, satisfiedThreshold)
  }
  /* *
   * This method is called periodically to check what the buffering observer
   * says so that we can update the rest of the buffering behaviours.
   *
   * @private
   */
  pollBufferState_() {
    console.assert(this.video_, 'Need a media element to update the buffering observer')
    console.assert(this.bufferObserver_, 'Need a buffering observer to update')

    let bufferedToEnd
    switch (this.loadMode_) {
      case LoadMode.SRC_EQUALS:
        bufferedToEnd = this.isBufferedToEndSrc_()
        break
      case LoadMode.MEDIA_SOURCE:
        bufferedToEnd = this.isBufferedToEndMS_()
        break
      default:
        bufferedToEnd = false
        break
    }

    const bufferLead = TimeRangesUtils.bufferedAheadOf(this.video_.buffered, this.video_.currentTime)
    const stateChanged = this.bufferObserver_.update(bufferLead, bufferedToEnd)

    // If the state changed, we need to surface the event.
    if (stateChanged) {
      this.updateBufferState_()
    }
  }
  /* *
   * Fire an event, but wait a little bit so that the immediate execution can
   * complete before the event is handled.
   *
   * @param {!FakeEvent} event
   * @private
   */
  async delayDispatchEvent_(event) {
    // Wait until the next interpreter cycle.
    await Promise.resolve()

    // Only dispatch the event if we are still alive.
    if (this.loadMode_ !== LoadMode.DESTROYED) {
      this.dispatchEvent(event)
    }
  }
  /* *
   * Dispatches a 'trackschanged' event.
   * @private
   */
  onTracksChanged_() {
    // Delay the 'trackschanged' event so StreamingEngine has time to absorb the
    // changes before the user tries to query it.
    const event = this.makeEvent_(conf.EventName.TracksChanged)
    this.delayDispatchEvent_(event)
  }
  /* *
   * Tell the player to use <code>mediaElement</code> for all <code>load</code>
   * requests until <code>detach</code> or <code>destroy</code> are called.
   *
   * <p>
   * Calling <code>attach</code> with <code>initializedMediaSource=true</code>
   * will tell the player to take the initial load step and initialize media
   * source.
   *
   * <p>
   * Calls to <code>attach</code> will interrupt any in-progress calls to
   * <code>load</code> but cannot interrupt calls to <code>attach</code>,
   * <code>detach</code>, or <code>unload</code>.
   *
   * @param {!HTMLMediaElement} mediaElement
   * @param {boolean=} initializeMediaSource
   * @return {!Promise}
   * @export
   */
  attach(mediaElement, initializeMediaSource = true) {
    // Do not allow the player to be used after |destroy| is called.
    if (this.loadMode_ === LoadMode.DESTROYED) {
      return Promise.reject(this.createAbortLoadError_())
    }

    const payload = Player.createEmptyPayload_()
    payload.mediaElement = mediaElement

    // If the platform does not support media source, we will never want to
    // initialize media source.
    if (!Platform.supportsMediaSource()) {
      initializeMediaSource = false
    }

    const destination = initializeMediaSource ? this.mediaSourceNode_ : this.attachNode_

    // Do not allow this route to be interrupted because calls after this attach
    // call will depend on the media element being attached.
    const events = this.walker_.startNewRoute((currentPayload) => {
      return {
        node: destination,
        payload: payload,
        interruptible: false
      }
    })

    // List to the events that can occur with our request.
    events.onStart = () => console.info('Starting attach...')
    return this.wrapWalkerListenersWithPromise_(events)
  }

  /* *
   * Tell the player to stop using its current media element. If the player is:
   * <ul>
   *  <li>detached, this will do nothing,
   *  <li>attached, this will release the media element,
   *  <li>loading, this will abort loading, unload, and release the media
   *      element,
   *  <li>playing content, this will stop playback, unload, and release the
   *      media element.
   * </ul>
   *
   * <p>
   * Calls to <code>detach</code> will interrupt any in-progress calls to
   * <code>load</code> but cannot interrupt calls to <code>attach</code>,
   * <code>detach</code>, or <code>unload</code>.
   *
   * @return {!Promise}
   * @export
   */
  detach() {
    // Do not allow the player to be used after |destroy| is called.
    if (this.loadMode_ === LoadMode.DESTROYED) {
      return Promise.reject(this.createAbortLoadError_())
    }

    // Tell the walker to go 'detached', but do not allow it to be interrupted.
    // If it could be interrupted it means that our media element could fall out
    // of sync.
    const events = this.walker_.startNewRoute((currentPayload) => {
      return {
        node: this.detachNode_,
        payload: Player.createEmptyPayload_(),
        interruptible: false
      }
    })

    events.onStart = () => console.info('Starting detach...')
    return this.wrapWalkerListenersWithPromise_(events)
  }
  createAbortLoadError_() {
    return new Error(
      Error.Severity.CRITICAL,
      Error.Category.PLAYER,
      Error.Code.LOAD_INTERRUPTED)
  }
  /* *
   * This should only be called by the load graph when it is time to load all
   * playback components needed for playback. The only times this may be called
   * is when we are attached to the same media element as in the request.
   *
   * This method assumes that it is safe for it to execute, the load-graph is
   * responsible for ensuring all assumptions are true.
   *
   * Loading is defined as:
   *  - Attaching all playback-related listeners to the media element
   *  - Initializing playback and observers
   *  - Initializing ABR Manager
   *  - Initializing Streaming Engine
   *  - Starting playback at |wants.startTime|
   *
   * @param {Payload} has
   * @param {Payload} wants
   * @private
   */
  async onLoad_(has, wants) {
    console.assert(has.mimeType === wants.mimeType, '|has| and |wants| should have the same mime type when loading.')
    console.assert(has.uri === wants.uri, '|has| and |wants| should have the same uri when loading.')
    console.assert(has.mediaElement, 'We should have a media element when loading.')
    console.assert(wants.startTimeOfLoad !== null, '|wants| should tell us when the load was originally requested')

    // Since we are about to start playback, we will lock in the start time as
    // something we are now depending on.
    has.startTime = wants.startTime

    // Store a reference to values in |has| after asserting so that closure will
    // know that they will still be non-null between calls to await.
    const mediaElement = has.mediaElement
    const assetUri = has.uri

    // Save the uri so that it can be used outside of the load-graph.
    this.assetUri_ = assetUri

    const updateStateHistory = () => this.updateStateHistory_()
    const onRateChange = () => this.onRateChange_()
    this.eventManager_.listen(mediaElement, 'playing', updateStateHistory)
    this.eventManager_.listen(mediaElement, 'pause', updateStateHistory)
    this.eventManager_.listen(mediaElement, 'ended', updateStateHistory)
    this.eventManager_.listen(mediaElement, 'ratechange', onRateChange)

    const abrFactory = this.config_.abrFactory
    if (!this.abrManager_ || this.abrManagerFactory_ !== abrFactory) {
      this.abrManagerFactory_ = abrFactory
      this.abrManager_ = Functional.callFactory(abrFactory)
      if (typeof this.abrManager_.playbackRateChanged !== 'function') {
        Deprecate.deprecateFeature(
          2, 7,
          'AbrManager',
          'Please use an AbrManager with playbackRateChanged function.')
        this.abrManager_.playbackRateChanged = (rate) => {}
      }
      this.abrManager_.configure(this.config_.abr)
    }

    // TODO: When a manifest update adds a new period, that period's closed
    // captions should also be turned into text streams. This should be called
    // for each new period as well.
    this.createTextStreamsForClosedCaptions_(this.manifest_.periods)

    // Copy preferred languages from the config again, in case the config was
    // changed between construction and playback.
    this.currentAdaptationSetCriteria_ =
        new PreferenceBasedCriteria(
          this.config_.preferredAudioLanguage,
          this.config_.preferredVariantRole,
          this.config_.preferredAudioChannelCount)

    this.currentTextLanguage_ = this.config_.preferredTextLanguage

    Player.applyPlayRange_(this.manifest_.presentationTimeline,
      this.config_.playRangeStart,
      this.config_.playRangeEnd)

    this.abrManager_.init((variant, clearBuffer, safeMargin) => {
      return this.switch_(variant, clearBuffer, safeMargin)
    })

    this.playhead_ = this.createPlayhead(has.startTime)
    this.playheadObservers_ = this.createPlayheadObserversForMSE_()

    this.playRateController_ = new PlayRateController({
      getRate: () => has.mediaElement.playbackRate,
      setRate: (rate) => { has.mediaElement.playbackRate = rate },
      movePlayhead: (delta) => { has.mediaElement.currentTime += delta }
    })

    // We need to start the buffer management code near the end because it will
    // set the initial buffering state and that depends on other components
    // being initialized.
    const rebufferThreshold = Math.max(
      this.manifest_.minBufferTime, this.config_.streaming.rebufferingGoal)
    this.startBufferManagement_(rebufferThreshold)

    this.streamingEngine_ = this.createStreamingEngine()
    this.streamingEngine_.configure(this.config_.streaming)

    // If the content is multi-codec and the browser can play more than one of
    // them, choose codecs now before we initialize streaming.
    this.chooseCodecsAndFilterManifest_()

    // Set the load mode to 'loaded with media source' as late as possible so
    // that public methods won't try to access internal components until
    // they're all initialized. We MUST switch to loaded before calling
    // 'streaming' so that they can access internal information.
    this.loadMode_ = LoadMode.MEDIA_SOURCE

    // The event must be fired after we filter by restrictions but before the
    // active stream is picked to allow those listening for the 'streaming'
    // event to make changes before streaming starts.
    this.dispatchEvent(this.makeEvent_(conf.EventName.Streaming))

    // Start streaming content. This will start the flow of content down to
    // media source, including picking the initial streams to play.
    await this.streamingEngine_.start()

    // We MUST wait until after we create streaming engine to adjust the start
    // time because we rely on the active audio and video streams, which are
    // selected in |StreamingEngine.init|.
    if (this.config_.streaming.startAtSegmentBoundary) {
      const startTime = this.playhead_.getTime()
      const adjustedTime = this.adjustStartTime_(startTime)

      this.playhead_.setStartTime(adjustedTime)
    }

    // Re-filter the manifest after streams have been chosen.
    for (const period of this.manifest_.periods) {
      this.filterNewPeriod_(period)
    }
    // Dispatch a 'trackschanged' event now that all initial filtering is done.
    this.onTracksChanged_()
    // Since the first streams just became active, send an adaptation event.
    this.onAdaptation_()

    // Now that we've filtered out variants that aren't compatible with the
    // active one, update abr manager with filtered variants for the current
    // period.
    /* * @type {extern.Period} */
    const currentPeriod = this.getPresentationPeriod_() || this.manifest_.periods[0]
    const hasPrimary = currentPeriod.variants.some((v) => v.primary)

    if (!this.config_.preferredAudioLanguage && !hasPrimary) {
      console.warning('No preferred audio language set.  We will choose an arbitrary language initially')
    }

    this.chooseVariant_(currentPeriod.variants)

    // Wait for the 'loadeddata' event to measure load() latency.
    this.eventManager_.listenOnce(mediaElement, 'loadeddata', () => {
      const now = Date.now() / 1000
      const delta = now - wants.startTimeOfLoad
      this.stats_.setLoadLatency(delta)
    })
  }
  /* *
   * For CEA closed captions embedded in the video streams, create dummy text
   * stream.
   * @param {!Array.<!extern.Period>} periods
   * @private
   */
  createTextStreamsForClosedCaptions_(periods) {
    const ContentType = ManifestParserUtils.ContentType
    const TextStreamKind = ManifestParserUtils.TextStreamKind

    for (const period of periods) {
      // A map of the closed captions id and the new dummy text stream.
      const closedCaptionsMap = new Map()
      for (const variant of period.variants) {
        if (variant.video && variant.video.closedCaptions) {
          const video = variant.video
          for (const id of video.closedCaptions.keys()) {
            if (!closedCaptionsMap.has(id)) {
              const textStream = {
                id: this.nextExternalStreamId_++, // A globally unique ID.
                originalId: id, // The CC ID string, like 'CC1', 'CC3', etc.
                createSegmentIndex: () => Promise.resolve(),
                segmentIndex: null,
                mimeType: MimeUtils.CLOSED_CAPTION_MIMETYPE,
                codecs: '',
                kind: TextStreamKind.CLOSED_CAPTION,
                encrypted: false,
                keyId: null,
                language: video.closedCaptions.get(id),
                label: null,
                type: ContentType.TEXT,
                primary: false,
                trickModeVideo: null,
                emsgSchemeIdUris: null,
                roles: video.roles,
                channelsCount: null,
                audioSamplingRate: null,
                closedCaptions: null
              }
              closedCaptionsMap.set(id, textStream)
            }
          }
        }
      }
      for (const textStream of closedCaptionsMap.values()) {
        period.textStreams.push(textStream)
      }
    }
  }
  /* *
   * Dispatches an 'adaptation' event.
   * @private
   */
  onAdaptation_() {
    // Delay the 'adaptation' event so that StreamingEngine has time to absorb
    // the changes before the user tries to query it.
    const event = this.makeEvent_(conf.EventName.Adaptation)
    this.delayDispatchEvent_(event)
  }
  /* *
   * Get the period that is on the screen. This will return |null| if nothing
   * is loaded.
   *
   * @return {extern.Period}
   * @private
   */
  getPresentationPeriod_() {
    console.assert(this.manifest_ && this.playhead_, 'Only ask for the presentation period when loaded with media source.')
    const presentationTime = this.playhead_.getTime()

    let lastPeriod = null

    // Periods are ordered by |startTime|. If we always keep the last period
    // that started before our presentation time, it means we will have the
    // best guess at which period we are presenting.
    for (const period of this.manifest_.periods) {
      if (period.startTime <= presentationTime) {
        lastPeriod = period
      }
    }

    console.assert(lastPeriod, 'Should have found a period.')
    return lastPeriod
  }
  /* *
   * Filters a new period.
   * @param {extern.Period} period
   * @private
   */
  filterNewPeriod_(period) {
    console.assert(this.video_, 'Must not be destroyed')
    /* * @type {?extern.Stream} */
    const activeAudio = this.streamingEngine_ ? this.streamingEngine_.getBufferingAudio() : null
    /* * @type {?extern.Stream} */
    const activeVideo = this.streamingEngine_ ? this.streamingEngine_.getBufferingVideo() : null

    StreamUtils.filterNewPeriod(activeAudio, activeVideo, period)

    /* * @type {!Array.<extern.Variant>} */
    const variants = period.variants

    // Check for playable variants before restrictions, so that we can give a
    // special error when there were tracks but they were all filtered.
    const hasPlayableVariant = variants.some(StreamUtils.isPlayable)
    if (!hasPlayableVariant) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.UNPLAYABLE_PERIOD)
    }

    this.checkRestrictedVariants_(period.variants)

    const tracksChanged = StreamUtils.applyRestrictions(
      variants, this.config_.restrictions, this.maxHwRes_)

    // Trigger the track change event if the restrictions now prevent use from
    // using a variant that we previously thought we could use.
    if (tracksChanged && this.streamingEngine_ &&
        this.getPresentationPeriod_() === period) {
      this.onTracksChanged_()
    }
  }
  /* *
   * Filters a list of periods.
   * @param {!Array.<!extern.Period>} periods
   * @private
   */
  filterAllPeriods_(periods) {
    console.assert(this.video_, 'Must not be destroyed')

    /* * @type {?extern.Stream} */
    const activeAudio = this.streamingEngine_ ? this.streamingEngine_.getBufferingAudio() : null
    /* * @type {?extern.Stream} */
    const activeVideo = this.streamingEngine_ ? this.streamingEngine_.getBufferingVideo() : null

    for (const period of periods) {
      StreamUtils.filterNewPeriod(activeAudio, activeVideo, period)
    }

    const validPeriodsCount = ArrayUtils.count(periods, (period) => {
      return period.variants.some(StreamUtils.isPlayable)
    })

    // If none of the periods are playable, throw
    // CONTENT_UNSUPPORTED_BY_BROWSER.
    if (validPeriodsCount === 0) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.CONTENT_UNSUPPORTED_BY_BROWSER)
    }

    // If only some of the periods are playable, throw UNPLAYABLE_PERIOD.
    if (validPeriodsCount < periods.length) {
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.UNPLAYABLE_PERIOD)
    }

    for (const period of periods) {
      const tracksChanged = StreamUtils.applyRestrictions(
        period.variants, this.config_.restrictions, this.maxHwRes_)
      if (tracksChanged && this.streamingEngine_ &&
          this.getPresentationPeriod_() === period) {
        this.onTracksChanged_()
      }

      this.checkRestrictedVariants_(period.variants)
    }
  }
  /* *
   * When we fire region events, we need to copy the information out of the
   * region to break the connection with the player's internal data. We do the
   * copy here because this is the transition point between the player and the
   * app.
   *
   * @param {!conf.EventName} eventName
   * @param {extern.TimelineRegionInfo} region
   *
   * @private
   */
  onRegionEvent_(eventName, region) {
    // Always make a copy to avoid exposing our internal data to the app.
    const clone = {
      schemeIdUri: region.schemeIdUri,
      value: region.value,
      startTime: region.startTime,
      endTime: region.endTime,
      id: region.id,
      eventElement: region.eventElement
    }

    this.dispatchEvent(this.makeEvent_(eventName, { detail: clone }))
  }
  /* *
   * Chooses a variant from all possible variants while taking into account
   * restrictions, preferences, and ABR.
   *
   * On error, this dispatches an error event and returns null.
   *
   * @param {!Array.<extern.Variant>} allVariants
   * @return {?extern.Variant}
   * @private
   */
  chooseVariant_(allVariants) {
    console.assert(this.config_, 'Must not be destroyed')

    try {
      // |variants| are the filtered variants, use |period.variants| so we know
      // why they we restricted.
      this.checkRestrictedVariants_(allVariants)
    } catch (e) {
      this.onError_(e)
      return null
    }

    console.assert(
      allVariants.length, 'Should have thrown for no Variants.')

    const playableVariants = allVariants.filter((variant) => {
      return StreamUtils.isPlayable(variant)
    })

    // Update the abr manager with newly filtered variants.
    const adaptationSet = this.currentAdaptationSetCriteria_.create(
      playableVariants)
    this.abrManager_.setVariants(Array.from(adaptationSet.values()))
    return this.abrManager_.chooseVariant()
  }
  /* *
   * Checks the given variants and if they are all restricted, throw an
   * appropriate exception.
   *
   * @param {!Array.<extern.Variant>} variants
   * @private
   */
  checkRestrictedVariants_(variants) {
    const keyStatusMap = {}
    const keyIds = Object.keys(keyStatusMap)
    const isGlobalStatus = keyIds.length && keyIds[0] === '00'

    let hasPlayable = false
    let hasAppRestrict = false
    const missingKeys = []
    const badKeyStatuses = []

    for (const variant of variants) {
      // TODO: Combine with onKeyStatus_.
      const streams = []
      if (variant.audio) {
        streams.push(variant.audio)
      }
      if (variant.video) {
        streams.push(variant.video)
      }

      for (const stream of streams) {
        if (stream.keyId) {
          const keyStatus = keyStatusMap[isGlobalStatus ? '00' : stream.keyId]
          if (!keyStatus) {
            if (!missingKeys.includes(stream.keyId)) {
              missingKeys.push(stream.keyId)
            }
          } else if (restrictedStatuses_.includes(keyStatus)) {
            if (!badKeyStatuses.includes(keyStatus)) {
              badKeyStatuses.push(keyStatus)
            }
          }
        }
      }

      if (!variant.allowedByApplication) {
        hasAppRestrict = true
      } else if (variant.allowedByKeySystem) {
        hasPlayable = true
      }
    }

    if (!hasPlayable) {
      /* * @type {extern.RestrictionInfo} */
      const data = {
        hasAppRestrictions: hasAppRestrict,
        missingKeys: missingKeys,
        restrictedKeyStatuses: badKeyStatuses
      }
      throw new Error(
        Error.Severity.CRITICAL,
        Error.Category.MANIFEST,
        Error.Code.RESTRICTIONS_CANNOT_BE_MET,
        data)
    }
  }
  /* *
   * Creates a new instance of Playhead.  This can be replaced by tests to
   * create fake instances instead.
   *
   * @param {?number} startTime
   * @return {!Playhead}
   */
  createPlayhead(startTime) {
    console.assert(this.manifest_, 'Must have manifest')
    console.assert(this.video_, 'Must have video')
    return new MediaSourcePlayhead(
      this.video_,
      this.manifest_,
      this.config_.streaming,
      startTime,
      () => this.onSeek_(),
      (event) => this.dispatchEvent(event))
  }
  /* *
   * Callback from Playhead.
   *
   * @private
   */
  onSeek_() {
    if (this.playheadObservers_) {
      this.playheadObservers_.notifyOfSeek()
    }
    if (this.streamingEngine_) {
      this.streamingEngine_.seeked()
    }
    if (this.bufferObserver_) {
      // If we seek into an unbuffered range, we should fire a 'buffering' event
      // immediately.  If StreamingEngine can buffer fast enough, we may not
      // update our buffering tracking otherwise.
      this.pollBufferState_()
    }
  }
  /* *
   * @param {!Error} error
   * @private
   */
  onError_(error) {
    console.assert(error instanceof Error, 'Wrong error type!')

    // Errors dispatched after |destroy| is called are not meaningful and should
    // be safe to ignore.
    if (this.loadMode_ === LoadMode.DESTROYED) {
      return
    }

    const eventName = conf.EventName.Error
    const event = this.makeEvent_(eventName, { 'detail': error })
    this.dispatchEvent(event)
    if (event.defaultPrevented) {
      error.handled = true
    }
  }
  /* *
   * @param {number} time
   * @return {number}
   * @private
   */
  adjustStartTime_(time) {
    /* * @type {?extern.Stream} */
    const activeAudio = this.streamingEngine_.getBufferingAudio()
    /* * @type {?extern.Stream} */
    const activeVideo = this.streamingEngine_.getBufferingVideo()
    /* * @type {extern.Period} */
    const period = this.getPresentationPeriod_()

    // This method is called after StreamingEngine.init resolves, which means
    // that all the active streams have had createSegmentIndex called.
    function getAdjustedTime(stream, time) {
      if (!stream) {
        return null
      }
      const idx = stream.segmentIndex.find(time - period.startTime)
      if (idx === null) {
        return null
      }
      const ref = stream.segmentIndex.get(idx)
      if (!ref) {
        return null
      }
      const refTime = ref.startTime + period.startTime
      console.assert(refTime <= time, 'Segment should start before time')
      return refTime
    }

    const audioStartTime = getAdjustedTime(activeAudio, time)
    const videoStartTime = getAdjustedTime(activeVideo, time)

    // If we have both video and audio times, pick the larger one.  If we picked
    // the smaller one, that one will download an entire segment to buffer the
    // difference.
    if (videoStartTime !== null && audioStartTime !== null) {
      return Math.max(videoStartTime, audioStartTime)
    } else if (videoStartTime !== null) {
      return videoStartTime
    } else if (audioStartTime !== null) {
      return audioStartTime
    } else {
      return time
    }
  }
  /* *
   * Creates a new instance of StreamingEngine.  This can be replaced by tests
   * to create fake instances instead.
   *
   * @return {!StreamingEngine}
   */
  createStreamingEngine() {
    console.assert(this.playhead_ && this.abrManager_ && this.mediaSourceEngine_ && this.manifest_, 'Must not be destroyed')

    /* * @type {StreamingEngine.PlayerInterface} */
    const playerInterface = {
      getPresentationTime: () => this.playhead_.getTime(),
      getBandwidthEstimate: () => this.abrManager_.getBandwidthEstimate(),
      mediaSourceEngine: this.mediaSourceEngine_,
      netEngine: this.networkingEngine_,
      onChooseStreams: (period) => this.onChooseStreams_(period),
      onCanSwitch: () => this.canSwitch_(),
      onError: (error) => this.onError_(error),
      onEvent: (event) => this.dispatchEvent(event),
      onManifestUpdate: () => this.onManifestUpdate_(),
      onSegmentAppended: () => this.onSegmentAppended_()
    }

    return new StreamingEngine(this.manifest_, playerInterface)
  }
  /* *
   * Create the observers for MSE playback. These observers are responsible for
   * notifying the app and player of specific events during MSE playback.
   *
   * @return {!PlayheadObserverManager}
   * @private
   */
  createPlayheadObserversForMSE_() {
    console.assert(this.manifest_, 'Must have manifest')
    console.assert(this.regionTimeline_, 'Must have region timeline')
    console.assert(this.video_, 'Must have video element')

    // Create the period observer. This will allow us to notify the app when we
    // transition between periods.
    const periodObserver = new PeriodObserver(this.manifest_)
    periodObserver.setListeners((period) => this.onChangePeriod_())

    // Create the region observer. This will allow us to notify the app when we
    // move in and out of timeline regions.
    const regionObserver = new RegionObserver(this.regionTimeline_)
    const onEnterRegion = (region, seeking) => {
      this.onRegionEvent_(conf.EventName.TimelineRegionEnter, region)
    }
    const onExitRegion = (region, seeking) => {
      this.onRegionEvent_(conf.EventName.TimelineRegionExit, region)
    }
    const onSkipRegion = (region, seeking) => {
      // If we are seeking, we don't want to surface the enter/exit events since
      // they didn't play through them.
      if (!seeking) {
        this.onRegionEvent_(conf.EventName.TimelineRegionEnter, region)
        this.onRegionEvent_(conf.EventName.TimelineRegionExit, region)
      }
    }
    regionObserver.setListeners(onEnterRegion, onExitRegion, onSkipRegion)

    // Now that we have all our observers, create a manager for them.
    const manager = new PlayheadObserverManager(this.video_)
    manager.manage(periodObserver)
    manager.manage(regionObserver)

    return manager
  }
  /* *
   * Callback from AbrManager.
   *
   * @param {extern.Variant} variant
   * @param {boolean=} clearBuffer
   * @param {number=} safeMargin Optional amount of buffer (in seconds) to
   *   retain when clearing the buffer.
   *   Defaults to 0 if not provided. Ignored if clearBuffer is false.
   * @private
   */
  switch_(variant, clearBuffer = false, safeMargin = 0) {
    console.debug('switch_')
    console.assert(this.config_.abr.enabled, 'AbrManager should not call switch while disabled!')
    console.assert(!this.switchingPeriods_, 'AbrManager should not call switch while transitioning between Periods!')
    console.assert(this.manifest_, 'We need a manifest to switch variants.')

    const period = this.findPeriodWithVariant_(variant)
    console.assert(period, 'A period should contain the variant.')

    this.addVariantToSwitchHistory_(period, variant, /*  fromAdaptation= */ true)

    if (!this.streamingEngine_) {
      // There's no way to change it.
      return
    }

    if (this.streamingEngine_.switchVariant(variant, clearBuffer, safeMargin)) {
      this.onAdaptation_()
    }
  }
  /* *
   * Using a promise, wrap the listeners returned by |Walker.startNewRoute|.
   * This will work for most usages in |Player| but should not be used for
   * special cases.
   *
   * This will connect |onCancel|, |onEnd|, |onError|, and |onSkip| with
   * |resolve| and |reject| but will leave |onStart| unset.
   *
   * @param {Walker.Listeners} listeners
   * @return {!Promise}
   * @private
   */
  wrapWalkerListenersWithPromise_(listeners) {
    return new Promise((resolve, reject) => {
      listeners.onCancel = () => reject(this.createAbortLoadError_())
      listeners.onEnd = () => resolve()
      listeners.onError = (e) => reject(e)
      listeners.onSkip = () => reject(this.createAbortLoadError_())
    })
  }
  /* *
   * Assuming the player is playing content with media source, check if the
   * player has buffered enough content to make it to the end of the
   * presentation.
   *
   * @return {boolean}
   * @private
   */
  isBufferedToEndMS_() {
    console.assert(this.video_, 'We need a video element to get buffering information')
    console.assert(this.mediaSourceEngine_, 'We need a media source engine to get buffering information')
    console.assert(this.manifest_, 'We need a manifest to get buffering information')

    // This is a strong guarantee that we are buffered to the end, because it
    // means the playhead is already at that end.
    if (this.video_.ended) {
      return true
    }

    // This means that MediaSource has buffered the final segment in all
    // SourceBuffers and is no longer accepting additional segments.
    if (this.mediaSourceEngine_.ended()) {
      return true
    }

    // Live streams are 'buffered to the end' when they have buffered to the
    // live edge or beyond (into the region covered by the presentation delay).
    if (this.manifest_.presentationTimeline.isLive()) {
      const liveEdge = this.manifest_.presentationTimeline.getSegmentAvailabilityEnd()
      const bufferEnd = TimeRangesUtils.bufferEnd(this.video_.buffered)

      if (bufferEnd >= liveEdge) {
        return true
      }
    }

    return false
  }
  /* *
   * Assuming the player is playing content with src=, check if the player has
   * buffered enough content to make it to the end of the presentation.
   *
   * @return {boolean}
   * @private
   */
  isBufferedToEndSrc_() {
    console.assert(this.video_, 'We need a video element to get buffering information')

    // This is a strong guarantee that we are buffered to the end, because it
    // means the playhead is already at that end.
    if (this.video_.ended) {
      return true
    }

    // If we have buffered to the duration of the content, it means we will have
    // enough content to buffer to the end of the presentation.
    const bufferEnd = TimeRangesUtils.bufferEnd(this.video_.buffered)

    // Because Safari's native HLS reports slightly inaccurate values for
    // bufferEnd here, we use a fudge factor.  Without this, we can end up in a
    // buffering state at the end of the stream.  See issue #2117.
    // TODO: Try to remove the fudge here once we no longer manage buffering
    // state above the browser with playbackRate=0.
    const fudge = 1 // 1000 ms
    return bufferEnd >= this.video_.duration - fudge
  }
  /* *
   * Turn the media element's error object into a Shaka Player error object.
   *
   * @return {Error}
   * @private
   */
  videoErrorToShakaError_() {
    console.assert(this.video_.error,
      'Video error expected, but missing!')
    if (!this.video_.error) {
      return null
    }

    const code = this.video_.error.code
    if (code === 1 /*  MEDIA_ERR_ABORTED */) {
      // Ignore this error code, which should only occur when navigating away or
      // deliberately stopping playback of HTTP content.
      return null
    }

    // Extra error information from MS Edge and IE11:
    let extended = this.video_.error.msExtendedCode
    if (extended) {
      // Convert to unsigned:
      if (extended < 0) {
        extended += Math.pow(2, 32)
      }
      // Format as hex:
      extended = extended.toString(16)
    }

    // Extra error information from Chrome:
    const message = this.video_.error.message

    return new Error(
      Error.Severity.CRITICAL,
      Error.Category.MEDIA,
      Error.Code.VIDEO_ERROR,
      code, extended, message)
  }
  /* *
   * Key
   * ----------------------
   * D   : Detach Node
   * A   : Attach Node
   * MS  : Media Source Node
   * P   : Manifest Parser Node
   * M   : Manifest Node
   * DRM : Drm Engine Node
   * L   : Load Node
   * U   : Unloading Node
   * SRC : Src Equals Node
   *
   * Graph Topology
   * ----------------------
   *
   *        [SRC]-----+
   *         ^        |
   *         |        v
   * [D]<-->[A]<-----[U]
   *         |        ^
   *         v        |
   *        [MS]------+
   *         |        |
   *         v        |
   *        [P]-------+
   *         |        |
   *         v        |
   *        [M]-------+
   *         |        |
   *         v        |
   *        [DRM]-----+
   *         |        |
   *         v        |
   *        [L]-------+
   *
   * @param {!Node} currentlyAt
   * @param {Payload} currentlyWith
   * @param {!Node} wantsToBeAt
   * @param {Payload} wantsToHave
   * @return {?Node}
   * @private
   */
  getNextStep_(currentlyAt, currentlyWith, wantsToBeAt, wantsToHave) {
    let next = null

    // Detach is very simple, either stay in detach (because |detach| was called
    // while in detached) or go somewhere that requires us to attach to an
    // element.
    if (currentlyAt === this.detachNode_) {
      next = wantsToBeAt === this.detachNode_
        ? this.detachNode_
        : this.attachNode_
    }

    if (currentlyAt === this.attachNode_) {
      next = this.getNextAfterAttach_(wantsToBeAt, currentlyWith, wantsToHave)
    }

    if (currentlyAt === this.mediaSourceNode_) {
      next = this.getNextAfterMediaSource_(
        wantsToBeAt, currentlyWith, wantsToHave)
    }

    if (currentlyAt === this.parserNode_) {
      next = this.getNextMatchingAllDependencies_(
        /*  destination= */ this.loadNode_,
        /*  next= */ this.manifestNode_,
        /*  reset= */ this.unloadNode_,
        /*  goingTo= */ wantsToBeAt,
        /*  has= */ currentlyWith,
        /*  wants= */ wantsToHave)
    }

    // After we load content, always go through unload because we can't safely
    // use components after we have started playback.
    if (currentlyAt === this.loadNode_ || currentlyAt === this.srcEqualsNode_) {
      next = this.unloadNode_
    }

    if (currentlyAt === this.unloadNode_) {
      next = this.getNextAfterUnload_(wantsToBeAt, currentlyWith, wantsToHave)
    }

    console.assert(next, 'Missing next step!')
    return next
  }
  /* *
   * After unload there are only two options, attached or detached. This choice
   * is based on whether or not we have a media element. If we have a media
   * element, then we go to attach. If we don't have a media element, we go to
   * detach.
   *
   * @param {!Node} goingTo
   * @param {Payload} has
   * @param {Payload} wants
   * @return {?Node}
   * @private
   */
  getNextAfterUnload_(goingTo, has, wants) {
    // If we don't want a media element, detach.
    // If we have the wrong media element, detach.
    // Otherwise it means we want to attach to a media element and it is safe to
    // do so.
    return !wants.mediaElement || has.mediaElement !== wants.mediaElement
      ? this.detachNode_
      : this.attachNode_
  }
  /* *
   * A general method used to handle routing when we can either than one step
   * toward our destination (while all our dependencies match) or go to a node
   * that will reset us so we can try again.
   *
   * @param {!shaka.routing.Node} destinationNode
   *   What |goingTo| must be for us to step toward |nextNode|. Otherwise we
   *   will go to |resetNode|.
   * @param {!shaka.routing.Node} nextNode
   *   The node we will go to next if |goingTo == destinationNode| and all
   *   dependencies match.
   * @param {!shaka.routing.Node} resetNode
   *   The node we will go to next if |goingTo != destinationNode| or any
   *   dependency does not match.
   * @param {!shaka.routing.Node} goingTo
   *   The node that the walker is trying to go to.
   * @param {shaka.routing.Payload} has
   *   The payload that the walker currently has.
   * @param {shaka.routing.Payload} wants
   *   The payload that the walker wants to have when iy gets to |goingTo|.
   * @return {shaka.routing.Node}
   * @private
   */
  getNextMatchingAllDependencies_(destinationNode, nextNode, resetNode, goingTo,
    has, wants) {
    if (goingTo === destinationNode &&
      has.mediaElement === wants.mediaElement &&
      has.uri === wants.uri &&
      has.mimeType === wants.mimeType) {
      return nextNode
    }
    return resetNode
  }
  /* *
   * @param {!Node} goingTo
   * @param {Payload} has
   * @param {Payload} wants
   * @return {?Node}
   * @private
   */
  getNextAfterMediaSource_(goingTo, has, wants) {
    // We can only go to parse manifest or unload. If we want to go to load and
    // we have the right media element, we can go to parse manifest. If we
    // don't, no matter where we want to go, we must go through unload.
    if (goingTo === this.loadNode_ && has.mediaElement === wants.mediaElement) {
      return this.parserNode_
    }

    // Right now the unload node is responsible for tearing down all playback
    // components (including media source). So since we have created media
    // source, we need to unload since our dependencies are not compatible.
    //
    // TODO: We are structured this way to maintain a historic structure. Going
    //       forward, there is no reason to restrict ourselves to this. Going
    //       forward we should explore breaking apart |onUnload| and develop
    //       more meaningful terminology around tearing down playback resources.
    return this.unloadNode_
  }
  /* *
   * @param {!Node} goingTo
   * @param {Payload} has
   * @param {Payload} wants
   * @return {?Node}
   * @private
   */
  getNextAfterAttach_(goingTo, has, wants) {
    // Attach and detach are the only two nodes that we can directly go
    // back-and-forth between.
    if (goingTo === this.detachNode_) {
      return this.detachNode_
    }

    // If we are going anywhere other than detach, then we need the media
    // element to match, if they don't match, we need to go through detach
    // first.
    if (has.mediaElement !== wants.mediaElement) {
      return this.detachNode_
    }

    // If we are already in attached, and someone calls |attach| again (to the
    // same video element), we can handle the redundant request by re-entering
    // our current state.
    if (goingTo === this.attachNode_) {
      return this.attachNode_
    }

    // The next step from attached to loaded is through media source.
    if (goingTo === this.mediaSourceNode_ || goingTo === this.loadNode_) {
      return this.mediaSourceNode_
    }

    // We are missing a rule, the null will get caught by a common check in
    // the routing system.
    return null
  }
  /* *
   * @param {extern.Period} period
   * @param {extern.Variant} variant
   * @param {boolean} fromAdaptation
   * @private
   */
  addVariantToSwitchHistory_(period, variant, fromAdaptation) {
    this.activeStreams_.useVariant(period, variant)
    const switchHistory = this.stats_.getSwitchHistory()
    switchHistory.updateCurrentVariant(variant, fromAdaptation)
  }
  /* *
   * Find the period in |this.manifest_| that contains |variant|. If no period
   * contains |variant| this will return |null|.
   *
   * @param {extern.Variant} variant
   * @return {?extern.Period}
   * @private
   */
  findPeriodWithVariant_(variant) {
    for (const period of this.manifest_.periods) {
      if (period.variants.includes(variant)) {
        return period
      }
    }

    return null
  }
  /* *
   * Callback from StreamingEngine.
   *
   * @private
   */
  onSegmentAppended_() {
    // When we append a segment to media source (via streaming engine) we are
    // changing what data we have buffered, so notify the playhead of the
    // change.
    if (this.playhead_) {
      this.playhead_.notifyOfBufferingChange()
    }
    this.pollBufferState_()
  }
  /* *
   * Callback from StreamingEngine.
   *
   * @private
   */
  onManifestUpdate_() {
    if (this.parser_ && this.parser_.update) {
      this.parser_.update()
    }
  }
  /* *
   * Callback from StreamingEngine, invoked when the period is set up.
   *
   * @private
   */
  canSwitch_() {
    console.debug('canSwitch_')
    console.assert(this.config_, 'Must not be destroyed')

    this.switchingPeriods_ = false

    if (this.config_.abr.enabled) {
      this.abrManager_.enable()
      this.onAbrStatusChanged_()
    }

    // If we still have deferred switches, switch now.
    if (this.deferredVariant_) {
      this.streamingEngine_.switchVariant(
        this.deferredVariant_, this.deferredVariantClearBuffer_,
        this.deferredVariantClearBufferSafeMargin_)
      this.onVariantChanged_()
      this.deferredVariant_ = null
    }
    if (this.deferredTextStream_) {
      this.streamingEngine_.switchTextStream(this.deferredTextStream_)
      this.onTextChanged_()
      this.deferredTextStream_ = null
    }
  }
  /* *
   * Callback from StreamingEngine, invoked when a period starts. This method
   * must always 'succeed' so it may not throw an error. Any errors must be
   * routed to |onError|.
   *
   * @param {!extern.Period} period
   * @return {StreamingEngine.ChosenStreams}
   *    An object containing the chosen variant and text stream.
   * @private
   */
  onChooseStreams_(period) {
    console.debug('onChooseStreams_', period)

    console.assert(this.config_, 'Must not be destroyed')

    try {
      console.info('onChooseStreams_, choosing variant from ', period.variants)
      console.info('onChooseStreams_, choosing text from ', period.textStreams)

      const chosen = this.chooseStreams_(period)

      console.info('onChooseStreams_, chose variant ', chosen.variant)
      console.info('onChooseStreams_, chose text ', chosen.text)

      return chosen
    } catch (e) {
      this.onError_(e)
      return { variant: null, text: null }
    }
  }
  /* *
   * This is the internal logic for |onChooseStreams_|. This separation is done
   * to allow this implementation to throw errors without consequence.
   *
   * @param {extern.Period} period
   *    The period that we are selecting streams from.
   * @return {StreamingEngine.ChosenStreams}
   *    An object containing the chosen variant and text stream.
   * @private
   */
  chooseStreams_(period) {
    // We are switching Periods, so the AbrManager will be disabled.  But if we
    // want to abr.enabled, we do not want to call AbrManager.enable before
    // canSwitch_ is called.
    this.switchingPeriods_ = true
    this.abrManager_.disable()
    this.onAbrStatusChanged_()

    console.debug('Choosing new streams after period changed')

    let chosenVariant = this.chooseVariant_(period.variants)
    let chosenText = this.chooseTextStream_(period.textStreams)

    // Ignore deferred variant or text streams only if we are starting a new
    // period.  In this case, any deferred switches were from an older period,
    // so they do not apply.  We can still have deferred switches from the
    // current period in the case of an early call to select*Track while we are
    // setting up the first period.  This can happen with the 'streaming' event.
    if (this.deferredVariant_) {
      if (period.variants.includes(this.deferredVariant_)) {
        chosenVariant = this.deferredVariant_
      }
      this.deferredVariant_ = null
    }

    if (this.deferredTextStream_) {
      if (period.textStreams.includes(this.deferredTextStream_)) {
        chosenText = this.deferredTextStream_
      }
      this.deferredTextStream_ = null
    }

    if (chosenVariant) {
      this.addVariantToSwitchHistory_(
        period, chosenVariant, /*  fromAdaptation= */ true)
    }

    if (chosenText) {
      this.addTextStreamToSwitchHistory_(
        period, chosenText, /*  fromAdaptation= */ true)
    }

    // Check if we should show text (based on difference between audio and text
    // languages). Only check this during startup so we don't 'pop-up' captions
    // mid playback.
    const startingUp = !this.streamingEngine_.getBufferingPeriod()
    const chosenAudio = chosenVariant ? chosenVariant.audio : null
    if (startingUp && chosenText) {
      if (chosenAudio && this.shouldShowText_(chosenAudio, chosenText)) {
        this.isTextVisible_ = true
      }
      if (this.isTextVisible_) {
        // If the cached value says to show text, then update the text displayer
        // since it defaults to not shown.  Note that returning the |chosenText|
        // below will make StreamingEngine stream the text.
        this.mediaSourceEngine_.getTextDisplayer().setTextVisibility(true)
        console.assert(this.shouldStreamText_(),
          'Should be streaming text')
      }
      this.onTextTrackVisibility_()
    }

    // Don't fire a tracks-changed event since we aren't inside the new Period
    // yet.
    // Don't initialize with a text stream unless we should be streaming text.
    if (this.shouldStreamText_()) {
      return { variant: chosenVariant, text: chosenText }
    } else {
      return { variant: chosenVariant, text: null }
    }
  }
  /* *
   * Dispatches a 'textchanged' event.
   * @private
   */
  onTextChanged_() {
    // Delay the 'textchanged' event so StreamingEngine time to absorb the
    // changes before the user tries to query it.
    const event = this.makeEvent_(conf.EventName.TextChanged)
    this.delayDispatchEvent_(event)
  }
  /* *
   * Dispatches a 'variantchanged' event.
   * @private
   */
  onVariantChanged_() {
    // Delay the 'variantchanged' event so StreamingEngine has time to absorb
    // the changes before the user tries to query it.
    const event = this.makeEvent_(conf.EventName.VariantChanged)
    this.delayDispatchEvent_(event)
  }
  /* * @private */
  onAbrStatusChanged_() {
    const event = this.makeEvent_(conf.EventName.AbrStatusChanged, {
      newStatus: this.config_.abr.enabled
    })
    this.delayDispatchEvent_(event)
  }
  /* * @private */
  onTextTrackVisibility_() {
    const event = this.makeEvent_(conf.EventName.TextTrackVisibility)
    this.delayDispatchEvent_(event)
  }
  /* *
   * @return {boolean} true if we should stream text right now.
   * @private
   */
  shouldStreamText_() {
    return this.config_.streaming.alwaysStreamText || this.isTextTrackVisible()
  }
  /* *
   * Check if we should show text on screen automatically.
   *
   * The text should automatically be shown if the text is language-compatible
   * with the user's text language preference, but not compatible with the
   * audio.
   *
   * For example:
   *   preferred | chosen | chosen |
   *   text      | text   | audio  | show
   *   -----------------------------------
   *   en-CA     | en     | jp     | true
   *   en        | en-US  | fr     | true
   *   fr-CA     | en-US  | jp     | false
   *   en-CA     | en-US  | en-US  | false
   *
   * @param {extern.Stream} audioStream
   * @param {extern.Stream} textStream
   * @return {boolean}
   * @private
   */
  shouldShowText_(audioStream, textStream) {
    const LanguageUtils = LanguageUtils

    /* * @type {string} */
    const preferredTextLocale =
        LanguageUtils.normalize(this.config_.preferredTextLanguage)
    /* * @type {string} */
    const audioLocale = LanguageUtils.normalize(audioStream.language)
    /* * @type {string} */
    const textLocale = LanguageUtils.normalize(textStream.language)

    return (
      LanguageUtils.areLanguageCompatible(textLocale, preferredTextLocale) &&
      !LanguageUtils.areLanguageCompatible(audioLocale, textLocale))
  }
  /* *
   * @param {extern.Period} period
   * @param {extern.Stream} textStream
   * @param {boolean} fromAdaptation
   * @private
   */
  addTextStreamToSwitchHistory_(period, textStream, fromAdaptation) {
    this.activeStreams_.useText(period, textStream)
    const switchHistory = this.stats_.getSwitchHistory()
    switchHistory.updateCurrentText(textStream, fromAdaptation)
  }
  /* *
   * Choose a text stream from all possible text streams while taking into
   * account user preference.
   *
   * @param {!Array.<extern.Stream>} textStreams
   * @return {?extern.Stream}
   * @private
   */
  chooseTextStream_(textStreams) {
    const subset = StreamUtils.filterStreamsByLanguageAndRole(
      textStreams,
      this.currentTextLanguage_,
      this.currentTextRole_)

    return subset[0] || null
  }
  /* *
   * Changes configuration settings on the Player.  This checks the names of
   * keys and the types of values to avoid coding errors.  If there are errors,
   * this logs them to the console and returns false.  Correct fields are still
   * applied even if there are other errors.  You can pass an explicit
   * <code>undefined</code> value to restore the default value.  This has two
   * modes of operation:
   *
   * <p>
   * First, this can be passed a single `plain` object.  This object should
   * follow the {@link shaka.extern.PlayerConfiguration} object.  Not all fields
   * need to be set; unset fields retain their old values.
   *
   * <p>
   * Second, this can be passed two arguments.  The first is the name of the key
   * to set.  This should be a '.' separated path to the key.  For example,
   * <code>'streaming.alwaysStreamText'</code>.  The second argument is the
   * value to set.
   *
   * @param {string|!Object} config This should either be a field name or an
   *   object.
   * @param {*=} value In the second mode, this is the value to set.
   * @return {boolean} True if the passed config object was valid, false if
   *   there were invalid entries.
   * @export
   */
  configure(config, value) {
    console.assert(this.config_, 'Config must not be null!')
    console.assert(typeof (config) === 'object' || arguments.length === 2, 'String configs should have values!')

    // ('fieldName', value) format
    if (arguments.length === 2 && typeof (config) === 'string') {
      config = ConfigUtils.convertToConfigObject(config, value)
    }

    console.assert(typeof (config) === 'object', 'Should be an object!')

    const ret = PlayerConfiguration.mergeConfigObjects(
      this.config_, config, this.defaultConfig_())

    this.applyConfig_()
    return ret
  }
  /* *
   * Tell the player to load the content at <code>assetUri</code> and start
   * playback at <code>startTime</code>. Before calling <code>load</code>,
   * a call to <code>attach</code> must have succeeded.
   *
   * <p>
   * Calls to <code>load</code> will interrupt any in-progress calls to
   * <code>load</code> but cannot interrupt calls to <code>attach</code>,
   * <code>detach</code>, or <code>unload</code>.
   *
   * @param {string} assetUri
   * @param {?number=} startTime
   *    When <code>startTime</code> is <code>null</code> or
   *    <code>undefined</code>, playback will start at the default start time (0
   *    for VOD and liveEdge for LIVE).
   * @param {string=} mimeType
   * @return {!Promise}
   * @export
   */
  load(assetUri, startTime, mimeType) {
    // Do not allow the player to be used after |destroy| is called.
    if (this.loadMode_ === LoadMode.DESTROYED) {
      return Promise.reject(this.createAbortLoadError_())
    }

    // We dispatch the loading event when someone calls |load| because we want
    // to surface the user intent.
    this.dispatchEvent(this.makeEvent_(conf.EventName.Loading))

    // Right away we know what the asset uri and start-of-load time are. We will
    // fill-in the rest of the information later.
    const payload = Player.createEmptyPayload_()
    payload.uri = assetUri
    payload.startTimeOfLoad = Date.now() / 1000
    if (mimeType) {
      payload.mimeType = mimeType
    }

    // Because we allow |startTime| to be optional, it means that it will be
    // |undefined| when not provided. This means that we need to re-map
    // |undefined| to |null| while preserving |0| as a meaningful value.
    if (startTime !== undefined) {
      payload.startTime = startTime
    }

    // TODO: Refactor to determine whether it's a manifest or not, and whether
    // or not we can play it.  Then we could return a better error than
    // UNABLE_TO_GUESS_MANIFEST_TYPE for WebM in Safari.
    const useSrcEquals = this.shouldUseSrcEquals_(payload)
    const destination = useSrcEquals ? this.srcEqualsNode_ : this.loadNode_

    // Allow this request to be interrupted, this will allow other requests to
    // cancel a load and quickly start a new load.
    const events = this.walker_.startNewRoute((currentPayload) => {
      if (currentPayload.mediaElement == null) {
        // Because we return null, this `new route` will not be used.
        return null
      }

      // Keep using whatever media element we have right now.
      payload.mediaElement = currentPayload.mediaElement

      return {
        node: destination,
        payload: payload,
        interruptible: true
      }
    })

    // Stats are for a single playback/load session. Stats must be initialized
    // before we allow calls to |updateStateHistory|.
    this.stats_ = new Stats()

    // Load's request is a little different, so we can't use our normal
    // listeners-to-promise method. It is the only request where we may skip the
    // request, so we need to set the on skip callback to reject with a specific
    // error.
    events.onStart = () => console.info(`Starting load of ${assetUri}...`)
    return new Promise((resolve, reject) => {
      events.onSkip = () => reject(new Error(
        Error.Severity.CRITICAL,
        Error.Category.PLAYER,
        Error.Code.NO_VIDEO_ELEMENT))

      events.onEnd = () => {
        resolve()
        // We dispatch the loaded event when the load promise is resolved
        this.dispatchEvent(this.makeEvent_(conf.EventName.Loaded))
      }
      events.onCancel = () => reject(this.createAbortLoadError_())
      events.onError = (e) => reject(e)
    })
  }
  /* *
   * Check if src= should be used to load the asset at |uri|. Assume that media
   * source is the default option, and that src= is for special cases.
   *
   * @param {Payload} payload
   * @return {boolean}
   *    |true| if the content should be loaded with src=, |false| if the content
   *    should be loaded with MediaSource.
   * @private
   */
  shouldUseSrcEquals_(payload) {
    // If we are using a platform that does not support media source, we will
    // fall back to src= to handle all playback.
    if (!Platform.supportsMediaSource()) {
      return true
    }

    // The most accurate way to tell the player how to load the content is via
    // MIME type.  We can fall back to features of the URI if needed.
    let mimeType = payload.mimeType
    const uri = payload.uri || ''

    // If we don't have a MIME type, try to guess based on the file extension.
    // TODO: Too generic to belong to ManifestParser now.  Refactor.
    if (!mimeType) {
      // Try using the uri extension.
      const extension = ManifestParser.getExtension(uri)
      mimeType = {
        'mp4': 'video/mp4',
        'm4v': 'video/mp4',
        'm4a': 'audio/mp4',
        'webm': 'video/webm',
        'weba': 'audio/webm',
        'mkv': 'video/webm', // Chromium browsers supports it.
        'ts': 'video/mp2t',
        'ogv': 'video/ogg',
        'ogg': 'audio/ogg',
        'mpg': 'video/mpeg',
        'mpeg': 'video/mpeg',
        'm3u8': 'application/x-mpegurl',
        'mp3': 'audio/mpeg',
        'aac': 'audio/aac',
        'flac': 'audio/flac',
        'wav': 'audio/wav'
      }[extension]
    }

    // TODO: The load graph system has a design limitation that requires routing
    // destination to be chosen synchronously.  This means we can only make the
    // right choice about src= consistently if we have a well-known file
    // extension or API-provided MIME type.  Detection of MIME type from a HEAD
    // request (as is done for manifest types) can't be done yet.

    if (mimeType) {
      // If we have a MIME type, check if the browser can play it natively.
      // This will cover both single files and native HLS.
      const mediaElement = payload.mediaElement || Platform.anyMediaElement()
      const canPlayNatively = mediaElement.canPlayType(mimeType) !== ''

      // If we can't play natively, then src= isn't an option.
      if (!canPlayNatively) {
        return false
      }

      const canPlayMediaSource = ManifestParser.isSupported(uri, mimeType)

      // If MediaSource isn't an option, the native option is our only chance.
      if (!canPlayMediaSource) {
        return true
      }

      // If we land here, both are feasible.
      console.assert(canPlayNatively && canPlayMediaSource, 'Both native and MSE playback should be possible!')

      // We would prefer MediaSource in some cases, and src= in others.  For
      // example, Android has native HLS, but we'd prefer our own MediaSource
      // version there.  For Safari, the choice is governed by the
      // useNativeHlsOnSafari setting of the streaming config.
      return Platform.isApple() && this.config_.streaming.useNativeHlsOnSafari
    }

    // Unless there are good reasons to use src= (single-file playback or native
    // HLS), we prefer MediaSource.  So the final return value for choosing src=
    // is false.
    return false
  }
}
