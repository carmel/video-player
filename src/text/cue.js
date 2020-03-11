/**
 * @implements {shaka.extern.Cue}
 * @export
 */
export class Cue {
  /**
   * @param {number} startTime
   * @param {number} endTime
   * @param {string} payload
   */
  constructor(startTime, endTime, payload) {
    /**
     * @override
     * @exportInterface
     */
    this.startTime = startTime

    /**
     * @override
     * @exportInterface
     */
    this.direction = Cue.direction.HORIZONTAL_LEFT_TO_RIGHT

    /**
     * @override
     * @exportInterface
     */
    this.endTime = endTime

    /**
     * @override
     * @exportInterface
     */
    this.payload = payload

    /**
     * @override
     * @exportInterface
     */
    this.region = new CueRegion()

    /**
     * @override
     * @exportInterface
     */
    this.position = null

    /**
     * @override
     * @exportInterface
     */
    this.positionAlign = Cue.positionAlign.AUTO

    /**
     * @override
     * @exportInterface
     */
    this.size = 100

    /**
     * @override
     * @exportInterface
     */
    this.textAlign = Cue.textAlign.CENTER

    /**
     * @override
     * @exportInterface
     */
    this.writingMode = Cue.writingMode.HORIZONTAL_TOP_TO_BOTTOM

    /**
     * @override
     * @exportInterface
     */
    this.lineInterpretation = Cue.lineInterpretation.LINE_NUMBER

    /**
     * @override
     * @exportInterface
     */
    this.line = null

    /**
     * @override
     * @exportInterface
     */
    this.lineHeight = ''

    /**
     * Line Alignment is set to start by default.
     * @override
     * @exportInterface
     */
    this.lineAlign = Cue.lineAlign.START

    /**
     * Set the captions at the bottom of the text container by default.
     * @override
     * @exportInterface
     */
    this.displayAlign = Cue.displayAlign.AFTER

    /**
     * @override
     * @exportInterface
     */
    this.color = ''

    /**
     * @override
     * @exportInterface
     */
    this.backgroundColor = ''

    /**
     * @override
     * @exportInterface
     */
    this.backgroundImage = ''

    /**
     * @override
     * @exportInterface
     */
    this.border = ''

    /**
     * @override
     * @exportInterface
     */
    this.fontSize = ''

    /**
     * @override
     * @exportInterface
     */
    this.fontWeight = Cue.fontWeight.NORMAL

    /**
     * @override
     * @exportInterface
     */
    this.fontStyle = Cue.fontStyle.NORMAL

    /**
     * @override
     * @exportInterface
     */
    this.fontFamily = ''

    /**
     * @override
     * @exportInterface
     */
    this.letterSpacing = ''

    /**
     * @override
     * @exportInterface
     */
    this.opacity = 1

    /**
     * @override
     * @exportInterface
     */
    this.textDecoration = []

    /**
     * @override
     * @exportInterface
     */
    this.wrapLine = true

    /**
     * @override
     * @exportInterface
     */
    this.id = ''

    /**
     * @override
     * @exportInterface
     */
    this.nestedCues = []

    /**
     * @override
     * @exportInterface
     */
    this.spacer = false

    /**
     * @override
     * @exportInterface
     */
    this.cellResolution = {
      columns: 32,
      rows: 15
    }
  }
}
/**
 * @enum {string}
 * @export
 */
Cue.positionAlign = {
  'LEFT': 'line-left',
  'RIGHT': 'line-right',
  'CENTER': 'center',
  'AUTO': 'auto'
}
/**
 * @enum {string}
 * @export
 */
Cue.textAlign = {
  'LEFT': 'left',
  'RIGHT': 'right',
  'CENTER': 'center',
  'START': 'start',
  'END': 'end'
}
/**
 * Vertical alignments of the cues within their extents.
 * 'BEFORE' means displaying at the top of the captions container box, 'CENTER'
 *  means in the middle, 'BOTTOM' means at the bottom.
 * @enum {string}
 * @export
 */
Cue.displayAlign = {
  'BEFORE': 'before',
  'CENTER': 'center',
  'AFTER': 'after'
}
/**
 * @enum {string}
 * @export
 */
Cue.direction = {
  'HORIZONTAL_LEFT_TO_RIGHT': 'ltr',
  'HORIZONTAL_RIGHT_TO_LEFT': 'rtl'
}
/**
 * @enum {string}
 * @export
 */
Cue.writingMode = {
  'HORIZONTAL_TOP_TO_BOTTOM': 'horizontal-tb',
  'VERTICAL_LEFT_TO_RIGHT': 'vertical-lr',
  'VERTICAL_RIGHT_TO_LEFT': 'vertical-rl'
}
/**
 * @enum {number}
 * @export
 */
Cue.lineInterpretation = {
  'LINE_NUMBER': 0,
  'PERCENTAGE': 1
}
/**
 * @enum {string}
 * @export
 */
Cue.lineAlign = {
  'CENTER': 'center',
  'START': 'start',
  'END': 'end'
}
/**
 * In CSS font weight can be a number, where 400 is normal and 700 is bold.
 * Use these values for the enum for consistency.
 * @enum {number}
 * @export
 */
Cue.fontWeight = {
  'NORMAL': 400,
  'BOLD': 700
}
/**
 * @enum {string}
 * @export
 */
Cue.fontStyle = {
  'NORMAL': 'normal',
  'ITALIC': 'italic',
  'OBLIQUE': 'oblique'
}
/**
 * @enum {string}
 * @export
 */
Cue.textDecoration = {
  'UNDERLINE': 'underline',
  'LINE_THROUGH': 'lineThrough',
  'OVERLINE': 'overline'
}
/**
 * @implements {shaka.extern.CueRegion}
 * @struct
 * @export
 */
export class CueRegion {
  constructor() {
    const CueRegion = CueRegion

    /**
     * @override
     * @exportInterface
     */
    this.id = ''

    /**
     * @override
     * @exportInterface
     */
    this.viewportAnchorX = 0

    /**
     * @override
     * @exportInterface
     */
    this.viewportAnchorY = 0

    /**
     * @override
     * @exportInterface
     */
    this.regionAnchorX = 0

    /**
     * @override
     * @exportInterface
     */
    this.regionAnchorY = 0

    /**
     * @override
     * @exportInterface
     */
    this.width = 100

    /**
     * @override
     * @exportInterface
     */
    this.height = 100

    /**
     * @override
     * @exportInterface
     */
    this.heightUnits = CueRegion.units.PERCENTAGE

    /**
     * @override
     * @exportInterface
     */
    this.widthUnits = CueRegion.units.PERCENTAGE

    /**
     * @override
     * @exportInterface
     */
    this.viewportAnchorUnits = CueRegion.units.PERCENTAGE

    /**
     * @override
     * @exportInterface
     */
    this.scroll = CueRegion.scrollMode.NONE
  }
}
/**
 * @enum {number}
 * @export
 */
CueRegion.units = {
  'PX': 0,
  'PERCENTAGE': 1,
  'LINES': 2
}
/**
 * @enum {string}
 * @export
 */
CueRegion.scrollMode = {
  'NONE': '',
  'UP': 'up'
}
