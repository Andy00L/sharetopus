/*
 * Concept films: a small SVG scene engine and player for explanatory films in the spirit of
 * 3Blue1Brown. A scene is a list of objects, dated animations and narration lines. Any frame is
 * computed from its time alone, so a film can play, pause, rewind, seek and slow down, and a
 * headless browser can render any frame for the checks and the GIF export (scripts/films.py).
 *
 * Load it with a plain <script src="films.js"></script>; it defines window.ConceptFilms. Register
 * films with ConceptFilms.define(key, definition), then call ConceptFilms.mountAll() to mount one
 * on every element carrying data-film="key". The full API is in references/engine.md.
 */
(function () {
  'use strict';

  /** Frame size in SVG user units (16:9). Every coordinate in a film lives in this space. */
  const FRAME = Object.freeze({ width: 800, height: 450 });
  // Reading pace (sourceRef: design-playbook 3.7, 12 to 15 characters per second is comfortable,
  // 20 is the ceiling): a narration line stays up this base plus 1 s per 15 characters, and never
  // less than the minimum, so a three-word line still registers. scripts/films.py reads these.
  const PACING = Object.freeze({ baseSeconds: 0.8, charsPerSecond: 15, minSeconds: 1.6, maxCharsPerSecond: 20 });
  // The final frame holds this long after the last animation lands (design-playbook 3.7).
  const END_HOLD_SECONDS = 1.5;
  // Narration wraps at this many characters; scripts/films.py fails a line that needs a third row.
  const NARRATION_WRAP_CHARS = 84;
  const NARRATION_FONT_SIZE = 17;
  // A film plays by itself, once, the first time this share of its screen is visible.
  const AUTOPLAY_VISIBLE_RATIO = 0.55;
  const SEEK_STEP_SECONDS = 2;
  const PLAYBACK_SPEEDS = [1, 0.5, 1.5];
  // A fade always carries a small move (design-playbook 3.1): objects enter rising from this many
  // px below and leave sinking back down, the exit shorter than the entrance.
  const ENTRANCE_RISE = 12;
  const EXIT_DROP = 8;

  // Colors used when the page defines no --film-* tokens. The seven hues are manim's
  // (sourceRef: manim/utils/color/manim_colors.py, BLUE_C TEAL_C GREEN_C YELLOW_C GOLD_C RED_C
  // PURPLE_C); the neutrals are a warm near-black family with the ink at 16:1 on the background.
  const DEFAULT_PALETTE = {
    background: '#141311', ink: '#F2EEE6', muted: '#A9A396', faint: '#7A756B', grid: '#2A2824',
    rest: '#3D3A35', blue: '#58C4DD', teal: '#5CD0B3', green: '#83C167', yellow: '#F7D96F',
    gold: '#F0AC5F', red: '#FC6255', purple: '#9A72AC'
  };
  const DEFAULT_FONTS = {
    display: "Georgia, 'Times New Roman', serif",
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  };
  // The value of a property until an animation touches it.
  const PROPERTY_DEFAULTS = { dy: 0, scale: 1, rotation: 0, fraction: 1, reveal: 1 };
  const OBJECT_TYPES = ['text', 'rect', 'dot', 'line', 'arrow', 'arc', 'brace', 'axes', 'custom'];
  const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

  /** Page-level options, set before mounting: the number locale and the player labels. */
  const settings = {
    locale: 'en-US',
    labels: {
      play: 'Play', pause: 'Pause', resume: 'Resume', replay: 'Replay', restart: 'Restart',
      back: '−2 s', forward: '+2 s', backDescription: 'Back 2 seconds', forwardDescription: 'Forward 2 seconds',
      speed: 'Playback speed', position: 'Position in the film', fullscreen: 'Full screen', seconds: 's'
    }
  };

  const EASINGS = {
    // close to manim's "smooth": slow at both ends, for anything that moves or changes on screen
    smooth: (progress) => progress * progress * (3 - 2 * progress),
    // fast start and soft landing, for entrances and count-ups
    decelerate: (progress) => 1 - Math.pow(1 - progress, 3),
    // soft start and fast finish, for exits
    accelerate: (progress) => progress * progress * progress
  };

  /* ---------------- text and number formatting ---------------- */

  const numberFormats = new Map();
  /** Formats a number for the screen: grouped thousands, at most `decimals` decimals (0 by default). */
  function formatNumber(value, decimals) {
    const places = decimals === undefined ? 0 : decimals;
    const cacheKey = settings.locale + '|' + places;
    if (!numberFormats.has(cacheKey)) {
      numberFormats.set(cacheKey, new Intl.NumberFormat(settings.locale, { maximumFractionDigits: places }));
    }
    return numberFormats.get(cacheKey).format(value).replace(/[  ]/g, ' ');
  }
  /** Writes an integer power in superscript digits: 10 becomes ¹⁰. */
  function superscript(power) {
    return String(power).split('').map((character) => (character === '-' ? '⁻' : SUPERSCRIPT_DIGITS[Number(character)])).join('');
  }
  function escapeXml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttribute(text) {
    return escapeXml(text).replace(/"/g, '&quot;');
  }
  function roundCoordinate(value) {
    return Math.round(value * 10) / 10;
  }
  /** Splits a narration line into rows of at most NARRATION_WRAP_CHARS characters, on spaces. */
  function wrapNarration(text) {
    const rows = [''];
    String(text).split(' ').forEach((word) => {
      const current = rows[rows.length - 1];
      const attempt = current ? current + ' ' + word : word;
      if (attempt.length > NARRATION_WRAP_CHARS && current) { rows.push(word); } else { rows[rows.length - 1] = attempt; }
    });
    return rows;
  }

  /* ---------------- colors and interpolation ---------------- */

  function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  }
  function mixColors(fromColor, toColor, progress) {
    const fromValue = parseInt(fromColor.slice(1), 16);
    const toValue = parseInt(toColor.slice(1), 16);
    function mixChannel(shift) {
      return Math.round(((fromValue >> shift) & 255) * (1 - progress) + ((toValue >> shift) & 255) * progress);
    }
    return '#' + ((1 << 24) + (mixChannel(16) << 16) + (mixChannel(8) << 8) + mixChannel(0)).toString(16).slice(1);
  }
  // Numbers glide, #rrggbb colors blend, anything else (a string of text) switches at the end.
  function interpolate(fromValue, toValue, progress) {
    if (typeof fromValue === 'number' && typeof toValue === 'number') { return fromValue + (toValue - fromValue) * progress; }
    if (isHexColor(fromValue) && isHexColor(toValue)) { return mixColors(fromValue, toValue, progress); }
    return progress < 1 ? fromValue : toValue;
  }

  /* ---------------- theme: the --film-* tokens ---------------- */

  let theme = null;
  /** Reads the --film-* color and --film-font-* tokens once from the page, with the defaults above. */
  function resolveTheme() {
    if (theme) { return theme; }
    const styles = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const readToken = (name) => (styles ? styles.getPropertyValue(name).trim() : '');
    const palette = {};
    Object.keys(DEFAULT_PALETTE).forEach((role) => {
      const token = readToken('--film-' + role);
      if (token && !isHexColor(token)) { console.warn('[resolveTheme] --film-' + role + ' must be a #rrggbb color, got ' + token); }
      palette[role] = isHexColor(token) ? token : DEFAULT_PALETTE[role];
    });
    const fonts = {};
    Object.keys(DEFAULT_FONTS).forEach((role) => { fonts[role] = readToken('--film-font-' + role) || DEFAULT_FONTS[role]; });
    theme = { palette: Object.freeze(palette), fonts: Object.freeze(fonts) };
    return theme;
  }

  /* ---------------- SVG markup helpers ---------------- */

  /**
   * One line of SVG text. With `reveal` below 1 it is written left to right without moving: the part
   * not yet written already takes its place, transparent, so centered text never shifts.
   */
  function svgText(fonts, positionX, positionY, content, options) {
    const full = String(content);
    const visibleCount = Math.round(full.length * (options.reveal === undefined ? 1 : options.reveal));
    const body = visibleCount >= full.length ? escapeXml(full)
      : '<tspan>' + escapeXml(full.slice(0, visibleCount)) + '</tspan><tspan fill-opacity="0">' + escapeXml(full.slice(visibleCount)) + '</tspan>';
    const opacity = options.opacity === undefined ? 1 : options.opacity;
    return '<text x="' + roundCoordinate(positionX) + '" y="' + roundCoordinate(positionY) + '" fill="' + options.color +
      '" opacity="' + opacity.toFixed(3) + '" font-family="' + escapeAttribute(fonts[options.font || 'display']) +
      '" font-size="' + (options.size || 18) + '" text-anchor="' + (options.anchor || 'start') +
      '" dominant-baseline="central" xml:space="preserve">' + body + '</text>';
  }
  function pathFromPoints(points, offsetX, offsetY) {
    return points.map((point, pointIndex) => (pointIndex ? 'L' : 'M') + roundCoordinate(point[0] + (offsetX || 0)) + ' ' +
      roundCoordinate(point[1] + (offsetY || 0))).join(' ');
  }
  // The points of a polyline already drawn at `fraction`, the last segment cut to length.
  function tracePartially(points, fraction) {
    if (fraction <= 0.001 || points.length < 2) { return []; }
    const position = Math.min(1, fraction) * (points.length - 1);
    const wholeSegments = Math.floor(position);
    const remainder = position - wholeSegments;
    const traced = points.slice(0, wholeSegments + 1);
    if (wholeSegments < points.length - 1 && remainder > 0) {
      const segmentStart = points[wholeSegments];
      const segmentEnd = points[wholeSegments + 1];
      traced.push([segmentStart[0] + (segmentEnd[0] - segmentStart[0]) * remainder, segmentStart[1] + (segmentEnd[1] - segmentStart[1]) * remainder]);
    }
    return traced;
  }
  function arrowHead(tipX, tipY, angle, color) {
    return '<path d="M' + roundCoordinate(tipX) + ' ' + roundCoordinate(tipY) +
      ' L' + roundCoordinate(tipX - 12 * Math.cos(angle - 0.42)) + ' ' + roundCoordinate(tipY - 12 * Math.sin(angle - 0.42)) +
      ' L' + roundCoordinate(tipX - 12 * Math.cos(angle + 0.42)) + ' ' + roundCoordinate(tipY - 12 * Math.sin(angle + 0.42)) +
      ' Z" fill="' + color + '"/>';
  }
  // A horizontal brace from leftX to rightX; direction 1 points its tip down, -1 up.
  function horizontalBracePath(leftX, rightX, positionY, direction) {
    const middleX = (leftX + rightX) / 2;
    const fold = 8 * direction;
    const start = 'M' + roundCoordinate(leftX) + ' ' + roundCoordinate(positionY);
    if (rightX - leftX < 34) { return start + ' v' + fold + ' H' + roundCoordinate(rightX) + ' v' + (-fold); }
    return start + ' q0 ' + fold + ' 8 ' + fold + ' H' + roundCoordinate(middleX - 8) + ' q8 0 8 ' + fold +
      ' q0 ' + (-fold) + ' 8 ' + (-fold) + ' H' + roundCoordinate(rightX - 8) + ' q8 0 8 ' + (-fold);
  }
  // A vertical brace from topY to bottomY; direction 1 points its tip right, -1 left.
  function verticalBracePath(positionX, topY, bottomY, direction) {
    const middleY = (topY + bottomY) / 2;
    const fold = 8 * direction;
    const start = 'M' + roundCoordinate(positionX) + ' ' + roundCoordinate(topY);
    if (bottomY - topY < 34) { return start + ' h' + fold + ' V' + roundCoordinate(bottomY) + ' h' + (-fold); }
    return start + ' q' + fold + ' 0 ' + fold + ' 8 V' + roundCoordinate(middleY - 8) + ' q0 8 ' + fold + ' 8' +
      ' q' + (-fold) + ' 0 ' + (-fold) + ' 8 V' + roundCoordinate(bottomY - 8) + ' q0 8 ' + (-fold) + ' 8';
  }

  /* ---------------- the scene ---------------- */

  /**
   * Creates an empty scene. Objects start invisible (opacity 0) unless given an opacity; gestures
   * date every change; frame(time) returns the SVG markup of the scene at that instant.
   */
  function createScene() {
    const { palette, fonts } = resolveTheme();
    const objects = {};
    const drawOrder = [];
    const tracks = {};
    const narrations = [];
    let totalSeconds = 0;
    const scene = { palette, fonts };

    function trackKey(id, property) { return id + '|' + property; }

    function valueAt(id, property, time) {
      let value = objects[id].base[property];
      if (value === undefined) { value = PROPERTY_DEFAULTS[property]; }
      const clips = tracks[trackKey(id, property)];
      if (!clips) { return value; }
      for (const clip of clips) {
        if (time < clip.start) { break; }
        const progress = clip.end > clip.start && time < clip.end ? (time - clip.start) / (clip.end - clip.start) : 1;
        value = interpolate(clip.from, clip.to, EASINGS[clip.easing](Math.max(0, Math.min(1, progress))));
      }
      return value;
    }

    function stateAt(id, time) {
      const base = objects[id].base;
      const state = {};
      Object.keys(base).forEach((property) => {
        const raw = base[property];
        state[property] = typeof raw === 'number' || typeof raw === 'string' ? valueAt(id, property, time) : raw;
      });
      Object.keys(PROPERTY_DEFAULTS).forEach((property) => {
        if (state[property] === undefined) { state[property] = PROPERTY_DEFAULTS[property]; }
      });
      return state;
    }

    /** Adds an object of one of OBJECT_TYPES; later objects draw on top of earlier ones. */
    scene.add = function (id, type, props) {
      if (OBJECT_TYPES.indexOf(type) === -1) { console.warn('[scene.add] unknown type ' + type + ' for ' + id); return scene; }
      if (objects[id]) { console.warn('[scene.add] duplicate id ' + id); return scene; }
      const base = Object.assign({}, props);
      if (base.opacity === undefined) { base.opacity = 0; }
      objects[id] = { type, base };
      drawOrder.push(id);
      return scene;
    };

    /**
     * The one primitive every gesture uses. Without a `from` value the property starts from the
     * value it has at `start`, so a move can take over from another mid-flight.
     */
    scene.animate = function (id, property, from, to, start, seconds, easing) {
      const object = objects[id];
      if (!object) { console.warn('[scene.animate] unknown object ' + id); return scene; }
      const easingName = easing || 'smooth';
      if (!EASINGS[easingName]) { console.warn('[scene.animate] unknown easing ' + easingName + ' on ' + id); return scene; }
      let startValue = from === undefined ? valueAt(id, property, start) : from;
      if (startValue === undefined) { startValue = to; }
      if (!(property in object.base)) { object.base[property] = PROPERTY_DEFAULTS[property] !== undefined ? PROPERTY_DEFAULTS[property] : startValue; }
      const clip = { from: startValue, to, start, end: start + (seconds || 0), easing: easingName };
      const key = trackKey(id, property);
      const clips = tracks[key] || (tracks[key] = []);
      let insertAt = clips.length;
      while (insertAt > 0 && clips[insertAt - 1].start > start) { insertAt -= 1; }
      clips.splice(insertAt, 0, clip);
      totalSeconds = Math.max(totalSeconds, clip.end);
      return scene;
    };
    /** Glides several properties to their targets at once (manim's .animate). */
    scene.animateTo = function (id, targets, start, seconds) {
      Object.keys(targets).forEach((property) => {
        scene.animate(id, property, undefined, targets[property], start, seconds === undefined ? 0.8 : seconds, 'smooth');
      });
      return scene;
    };
    /** FadeIn with a rise: the object appears moving up into place. */
    scene.fadeIn = function (id, start, seconds) {
      const length = seconds === undefined ? 0.6 : seconds;
      scene.animate(id, 'opacity', undefined, 1, start, length, 'decelerate');
      return scene.animate(id, 'dy', ENTRANCE_RISE, 0, start, length, 'decelerate');
    };
    /** The inverse of fadeIn, shorter: the object sinks back down as it fades. */
    scene.fadeOut = function (id, start, seconds) {
      const length = seconds === undefined ? 0.4 : seconds;
      scene.animate(id, 'opacity', undefined, 0, start, length, 'accelerate');
      return scene.animate(id, 'dy', undefined, EXIT_DROP, start, length, 'accelerate');
    };
    /** Create: a line, an arrow, an arc or axes trace themselves from their origin. */
    scene.draw = function (id, start, seconds) {
      scene.animate(id, 'opacity', undefined, 1, start, 0.05);
      return scene.animate(id, 'fraction', 0, 1, start, seconds === undefined ? 1 : seconds);
    };
    /** Write: a text or a formula is written left to right. */
    scene.write = function (id, start, seconds) {
      scene.animate(id, 'opacity', undefined, 1, start, 0.05);
      return scene.animate(id, 'reveal', 0, 1, start, seconds === undefined ? 0.8 : seconds);
    };
    /** Changes an object's color, and the color of the label it carries when `ink` is given. */
    scene.recolor = function (id, color, start, seconds, ink) {
      const length = seconds === undefined ? 0.4 : seconds;
      scene.animate(id, 'color', undefined, color, start, length);
      if (ink) { scene.animate(id, 'ink', undefined, ink, start, length); }
      return scene;
    };
    /** A number counting from one value to another, on an object with a `template` such as 'n = {v}'. */
    scene.count = function (id, from, to, start, seconds) {
      return scene.animate(id, 'value', from, to, start, seconds === undefined ? 0.8 : seconds, 'decelerate');
    };
    /** Indicate: a short pulse that points at the object being talked about. */
    scene.indicate = function (id, start) {
      scene.animate(id, 'scale', 1, 1.2, start, 0.22);
      return scene.animate(id, 'scale', 1.2, 1, start + 0.22, 0.3);
    };
    /** A narration line, shown in the band at the bottom from `start` until the next one. */
    scene.say = function (start, text) {
      narrations.push({ start, text: String(text) });
      narrations.sort((first, second) => first.start - second.start);
      totalSeconds = Math.max(totalSeconds, start + 1.5);
      return scene;
    };
    /** Makes the film last at least until `time`. */
    scene.endAt = function (time) {
      totalSeconds = Math.max(totalSeconds, time);
      return scene;
    };
    /** A dead time: everything that starts at or after `at` moves later by `seconds`. */
    scene.insertPause = function (at, seconds) {
      Object.keys(tracks).forEach((key) => {
        tracks[key].forEach((clip) => {
          if (clip.start >= at - 1e-9) { clip.start += seconds; clip.end += seconds; }
        });
      });
      narrations.forEach((narration) => { if (narration.start >= at - 1e-9) { narration.start += seconds; } });
      totalSeconds += seconds;
      return scene;
    };
    /**
     * Gives every narration line its reading time (PACING: the base plus 1 s per charsPerSecond
     * characters, at least minSeconds) by pausing the scene before the next line when needed, then
     * holds the final frame END_HOLD_SECONDS. buildScene calls it once, after build().
     */
    scene.paceNarration = function () {
      for (let lineIndex = 0; lineIndex < narrations.length; lineIndex += 1) {
        const reading = Math.max(PACING.minSeconds, PACING.baseSeconds + narrations[lineIndex].text.length / PACING.charsPerSecond);
        const isLast = lineIndex + 1 === narrations.length;
        const available = (isLast ? totalSeconds : narrations[lineIndex + 1].start) - narrations[lineIndex].start;
        if (available >= reading) { continue; }
        if (isLast) { totalSeconds += reading - available; } else { scene.insertPause(narrations[lineIndex + 1].start, reading - available); }
      }
      let lastLanding = 0;
      Object.keys(tracks).forEach((key) => { tracks[key].forEach((clip) => { lastLanding = Math.max(lastLanding, clip.end); }); });
      totalSeconds = Math.max(totalSeconds, lastLanding + END_HOLD_SECONDS);
      return scene;
    };
    scene.duration = function () { return totalSeconds; };
    /** The narration lines with their paced start times, for the checks. */
    scene.narrationLog = function () { return narrations.map((narration) => ({ start: narration.start, text: narration.text })); };

    /* ----- helpers built on add() ----- */

    /** A text placed in the film, invisible until a gesture shows it. */
    scene.label = function (id, positionX, positionY, text, options) {
      const labelOptions = options || {};
      return scene.add(id, 'text', { x: positionX, y: positionY, text, size: labelOptions.size || 17,
        color: labelOptions.color || palette.ink, anchor: labelOptions.anchor, font: labelOptions.font });
    };
    /**
     * A formula line in colored pieces, such as [['T(n) = 2', palette.ink], ['T(n/2)', palette.yellow]].
     * Each piece color is an animatable property c0, c1, ...; write() reveals the line left to right.
     * Spaces are kept as typed, so a mono formula can align its = signs.
     */
    scene.formula = function (id, positionX, positionY, pieces, options) {
      const formulaOptions = options || {};
      const base = { x: positionX, y: positionY, size: formulaOptions.size || 20 };
      const totalLength = pieces.reduce((sum, piece) => sum + piece[0].length, 0);
      pieces.forEach((piece, pieceIndex) => { base['c' + pieceIndex] = piece[1] || palette.ink; });
      base.render = function (state) {
        const visibleCount = Math.round(totalLength * state.reveal);
        let shown = 0;
        const body = pieces.map((piece, pieceIndex) => {
          const visible = Math.max(0, Math.min(piece[0].length, visibleCount - shown));
          shown += piece[0].length;
          return '<tspan fill="' + state['c' + pieceIndex] + '">' + escapeXml(piece[0].slice(0, visible)) + '</tspan>' +
            (visible < piece[0].length ? '<tspan fill-opacity="0">' + escapeXml(piece[0].slice(visible)) + '</tspan>' : '');
        }).join('');
        return '<text x="' + roundCoordinate(state.x) + '" y="' + roundCoordinate(state.y + state.dy) + '" font-family="' +
          escapeAttribute(fonts[formulaOptions.font || 'display']) + '" font-size="' + state.size + '" text-anchor="' +
          (formulaOptions.anchor || 'start') + '" dominant-baseline="central" xml:space="preserve">' + body + '</text>';
      };
      return scene.add(id, 'custom', base);
    };
    /**
     * Lights a tile in a role color. The label switches to the background color on a bright hue and
     * to the ink on the resting and faint tones, so it always reads.
     */
    scene.lightUp = function (id, color, start, seconds) {
      const isDim = color === palette.rest || color === palette.faint;
      return scene.recolor(id, color, start, seconds === undefined ? 0.35 : seconds, isDim ? palette.ink : palette.background);
    };
    /** Axes, visible and traced from zero by draw(). */
    scene.addAxes = function (id, spec) {
      return scene.add(id, 'axes', Object.assign({}, spec, { opacity: 1, fraction: 0 }));
    };
    /** Markup helpers for custom objects: render(state) may return any SVG built with them. */
    scene.markup = {
      text: (positionX, positionY, content, options) => svgText(fonts, positionX, positionY, content,
        Object.assign({ color: palette.ink }, options)),
      path: pathFromPoints,
      arrowHead
    };

    /* ----- drawing ----- */

    function transformGroup(content, state, centerX, centerY, pivotX, pivotY) {
      let transform = '';
      if (state.rotation) { transform += 'rotate(' + roundCoordinate(state.rotation) + ' ' + roundCoordinate(pivotX) + ' ' + roundCoordinate(pivotY) + ') '; }
      if (Math.abs(state.scale - 1) > 0.001) {
        transform += 'translate(' + roundCoordinate(centerX) + ' ' + roundCoordinate(centerY) + ') scale(' + state.scale.toFixed(3) +
          ') translate(' + roundCoordinate(-centerX) + ' ' + roundCoordinate(-centerY) + ')';
      }
      return transform ? '<g transform="' + transform.trim() + '">' + content + '</g>' : content;
    }

    function drawObject(object, state) {
      const opacity = Math.max(0, Math.min(1, state.opacity));
      const base = object.base;
      if (opacity <= 0.002) { return ''; }
      const withOpacity = (content) => '<g opacity="' + opacity.toFixed(3) + '">' + content + '</g>';
      const labelOf = () => (base.template ? base.template.replace('{v}', formatNumber(state.value, base.decimals)) : state.text);

      if (object.type === 'text') {
        const lineY = state.y + state.dy;
        return transformGroup(svgText(fonts, state.x, lineY, labelOf(), { size: state.size, color: state.color, anchor: base.anchor,
          font: base.font, opacity, reveal: state.reveal }), state, state.x, lineY, state.x, lineY);
      }
      if (object.type === 'rect') {
        const topY = state.y + state.dy;
        let markup = '<rect x="' + roundCoordinate(state.x) + '" y="' + roundCoordinate(topY) + '" width="' + roundCoordinate(Math.max(0, state.width)) +
          '" height="' + roundCoordinate(Math.max(0, state.height)) + '" rx="' + (base.radius === undefined ? 6 : base.radius) + '"' +
          (base.outline ? ' fill="none" stroke="' + state.color + '" stroke-width="1.6"' : ' fill="' + state.color + '"') + '/>';
        const label = labelOf();
        if (label !== undefined && label !== '') {
          markup += svgText(fonts, state.x + state.width / 2, topY + state.height / 2, label,
            { size: state.size || 18, color: state.ink || palette.background, anchor: 'middle', font: base.font || 'mono' });
        }
        const pivotAtCorner = base.pivot === 'bottom-right';
        return transformGroup(withOpacity(markup), state, state.x + state.width / 2, topY + state.height / 2,
          pivotAtCorner ? state.x + state.width : state.x + state.width / 2, pivotAtCorner ? topY + state.height : topY + state.height / 2);
      }
      if (object.type === 'dot') {
        const centerY = state.y + state.dy;
        return transformGroup('<circle cx="' + roundCoordinate(state.x) + '" cy="' + roundCoordinate(centerY) + '" r="' + (state.r || 6) +
          '" fill="' + state.color + '" opacity="' + opacity.toFixed(3) + '"/>', state, state.x, centerY, state.x, centerY);
      }
      if (object.type === 'line') {
        const traced = tracePartially(base.points, state.fraction);
        if (traced.length < 2) { return ''; }
        return withOpacity('<path d="' + pathFromPoints(traced, state.x || 0, (state.y || 0) + state.dy) + '" fill="none" stroke="' +
          state.color + '" stroke-width="' + (base.thickness || 3) + '" stroke-linecap="round" stroke-linejoin="round"' +
          (base.dashed ? ' stroke-dasharray="6 6"' : '') + '/>');
      }
      if (object.type === 'arrow') {
        if (state.fraction <= 0.001) { return ''; }
        const angle = Math.atan2(state.y2 - state.y1, state.x2 - state.x1);
        const tipX = state.x1 + (state.x2 - state.x1) * state.fraction;
        const tipY = state.y1 + (state.y2 - state.y1) * state.fraction;
        const hasHead = state.fraction > 0.97;
        return withOpacity('<line x1="' + roundCoordinate(state.x1) + '" y1="' + roundCoordinate(state.y1) + '" x2="' +
          roundCoordinate(hasHead ? tipX - 6 * Math.cos(angle) : tipX) + '" y2="' + roundCoordinate(hasHead ? tipY - 6 * Math.sin(angle) : tipY) +
          '" stroke="' + state.color + '" stroke-width="' + (base.thickness || 2.5) + '" stroke-linecap="round"' +
          (base.dashed ? ' stroke-dasharray="6 5"' : '') + '/>' + (hasHead ? arrowHead(tipX, tipY, angle, state.color) : ''));
      }
      if (object.type === 'arc') {
        const middleX = (state.x1 + state.x2) / 2;
        const controlY = state.y - 2 * state.height;
        const arcPoints = [];
        for (let sample = 0; sample <= 30; sample += 1) {
          const along = sample / 30;
          const remaining = 1 - along;
          arcPoints.push([remaining * remaining * state.x1 + 2 * remaining * along * middleX + along * along * state.x2,
            remaining * remaining * state.y + 2 * remaining * along * controlY + along * along * state.y]);
        }
        const traced = tracePartially(arcPoints, state.fraction);
        if (traced.length < 2) { return ''; }
        const lastPoint = arcPoints[arcPoints.length - 1];
        const beforeLast = arcPoints[arcPoints.length - 3];
        return withOpacity('<path d="' + pathFromPoints(traced) + '" fill="none" stroke="' + state.color + '" stroke-width="2.5" stroke-linecap="round"/>' +
          (state.fraction > 0.97 ? arrowHead(lastPoint[0], lastPoint[1], Math.atan2(lastPoint[1] - beforeLast[1], lastPoint[0] - beforeLast[0]), state.color) : ''));
      }
      if (object.type === 'brace') {
        const direction = base.direction || 1;
        const labelStyle = { size: base.labelSize || 15, color: state.color, font: base.labelFont || 'mono' };
        let bracePath;
        let label = '';
        if (base.vertical) {
          bracePath = verticalBracePath(state.x, state.y1 + state.dy, state.y2 + state.dy, direction);
          if (base.label) {
            label = svgText(fonts, state.x + 26 * direction, (state.y1 + state.y2) / 2 + state.dy, base.label,
              Object.assign({ anchor: direction === 1 ? 'start' : 'end' }, labelStyle));
          }
        } else {
          bracePath = horizontalBracePath(state.x1, state.x2, state.y + state.dy, direction);
          if (base.label) {
            label = svgText(fonts, (state.x1 + state.x2) / 2, state.y + state.dy + (direction === 1 ? 32 : -30), base.label,
              Object.assign({ anchor: 'middle' }, labelStyle));
          }
        }
        return withOpacity('<path d="' + bracePath + '" fill="none" stroke="' + state.color +
          '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' + label);
      }
      if (object.type === 'axes') {
        let ticks = '';
        const progress = state.fraction;
        const tickLabel = { size: 13, color: palette.muted, font: 'mono' };
        (base.xTicks || []).forEach((tick) => {
          if (base.grid !== false) {
            ticks += '<line x1="' + roundCoordinate(tick[0]) + '" y1="' + base.y0 + '" x2="' + roundCoordinate(tick[0]) + '" y2="' + (base.y0 - base.height) +
              '" stroke="' + palette.grid + '" stroke-width="1"/>';
          }
          ticks += '<line x1="' + roundCoordinate(tick[0]) + '" y1="' + base.y0 + '" x2="' + roundCoordinate(tick[0]) + '" y2="' + (base.y0 + 6) +
            '" stroke="' + palette.muted + '" stroke-width="1.5"/>' + svgText(fonts, tick[0], base.y0 + 20, tick[1], Object.assign({ anchor: 'middle' }, tickLabel));
        });
        (base.yTicks || []).forEach((tick) => {
          if (base.grid !== false) {
            ticks += '<line x1="' + base.x0 + '" y1="' + roundCoordinate(tick[0]) + '" x2="' + (base.x0 + base.width) + '" y2="' + roundCoordinate(tick[0]) +
              '" stroke="' + palette.grid + '" stroke-width="1"/>';
          }
          ticks += '<line x1="' + base.x0 + '" y1="' + roundCoordinate(tick[0]) + '" x2="' + (base.x0 - 6) + '" y2="' + roundCoordinate(tick[0]) +
            '" stroke="' + palette.muted + '" stroke-width="1.5"/>' + svgText(fonts, base.x0 - 12, tick[0], tick[1], Object.assign({ anchor: 'end' }, tickLabel));
        });
        if (base.xLabel) { ticks += svgText(fonts, base.x0 + base.width + 12, base.y0, base.xLabel, { size: 16, color: palette.ink }); }
        if (base.yLabel) { ticks += svgText(fonts, base.x0, base.y0 - base.height - 18, base.yLabel, { size: 16, color: palette.ink, anchor: 'middle' }); }
        const lines = '<line x1="' + base.x0 + '" y1="' + base.y0 + '" x2="' + roundCoordinate(base.x0 + base.width * progress) + '" y2="' + base.y0 +
          '" stroke="' + palette.ink + '" stroke-width="2" stroke-linecap="round"/>' +
          '<line x1="' + base.x0 + '" y1="' + base.y0 + '" x2="' + base.x0 + '" y2="' + roundCoordinate(base.y0 - base.height * progress) +
          '" stroke="' + palette.ink + '" stroke-width="2" stroke-linecap="round"/>';
        return withOpacity('<g opacity="' + progress.toFixed(3) + '">' + ticks + '</g>' + lines);
      }
      if (object.type === 'custom') { return withOpacity(base.render(state)); }
      return '';
    }

    /** The SVG markup of the whole scene at `time`, background and narration included. */
    scene.frame = function (time) {
      let markup = '<rect class="film-background" x="0" y="0" width="' + FRAME.width + '" height="' + FRAME.height + '" fill="' + palette.background + '"/>';
      drawOrder.forEach((id) => {
        const drawing = drawObject(objects[id], stateAt(id, time));
        if (drawing) { markup += '<g data-object="' + escapeAttribute(id) + '">' + drawing + '</g>'; }
      });
      let active = null;
      narrations.forEach((narration) => { if (time >= narration.start) { active = narration; } });
      if (active) {
        const rows = wrapNarration(active.text);
        const bandHeight = rows.length > 1 ? 58 : 44;
        const bandTop = FRAME.height - bandHeight;
        const textOpacity = Math.min(1, Math.max(0, (time - active.start) / 0.35));
        markup += '<g class="narration"><rect x="0" y="' + bandTop + '" width="' + FRAME.width + '" height="' + bandHeight + '" fill="' + palette.background +
          '"/><line x1="40" y1="' + bandTop + '" x2="' + (FRAME.width - 40) + '" y2="' + bandTop + '" stroke="' + palette.grid +
          '" stroke-width="1" stroke-linecap="round"/>';
        rows.forEach((row, rowIndex) => {
          markup += svgText(fonts, FRAME.width / 2, rows.length > 1 ? bandTop + 18 + rowIndex * 22 : bandTop + bandHeight / 2, row,
            { size: NARRATION_FONT_SIZE, color: palette.ink, anchor: 'middle', opacity: textOpacity });
        });
        markup += '</g>';
      }
      return markup;
    };

    return scene;
  }

  /* ---------------- the registry ---------------- */

  const definitions = {};

  /**
   * Registers a film: { title, caption?, build(scene, variant), variants?: [{ name, ... }],
   * defaultVariant?: index }. Returns false (with a warning) when the definition cannot work.
   */
  function define(key, definition) {
    if (typeof key !== 'string' || !key) { console.warn('[define] a film needs a string key'); return false; }
    if (!definition || typeof definition.build !== 'function') { console.warn('[define] film ' + key + ' needs a build(scene, variant) function'); return false; }
    if (definitions[key]) { console.warn('[define] film ' + key + ' is defined twice; the last definition wins'); }
    definitions[key] = definition;
    return true;
  }
  /** The registered films: key, title and variant names. */
  function list() {
    return Object.keys(definitions).map((key) => ({ key, title: definitions[key].title || key,
      variants: (definitions[key].variants || []).map((variant) => variant.name) }));
  }
  /** Builds and paces one film. Returns null (with a warning) for an unknown key or variant. */
  function buildScene(key, variantIndex) {
    const definition = definitions[key];
    if (!definition) { console.warn('[buildScene] unknown film ' + key); return null; }
    const variants = definition.variants || [];
    const chosenIndex = variantIndex === undefined || variantIndex === null ? (definition.defaultVariant || 0) : variantIndex;
    const variant = variants.length ? variants[chosenIndex] : null;
    if (variants.length && !variant) { console.warn('[buildScene] film ' + key + ' has no variant ' + chosenIndex); return null; }
    const scene = createScene();
    definition.build(scene, variant);
    return scene.paceNarration();
  }

  /* ---------------- the player ---------------- */

  const players = new Set();
  const playersByScreen = new WeakMap();
  const autoplayedScreens = new WeakSet();
  let visibilityObserver = null;

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  // Plays a film once when it first becomes visible and pauses it when it leaves the screen.
  // Nothing plays by itself when the system asks for reduced motion.
  function observeForAutoplay(screen, player) {
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) { return; }
    if (!visibilityObserver) {
      visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const observed = playersByScreen.get(entry.target);
          if (!observed) { return; }
          if (!entry.isIntersecting) { observed.pause(); return; }
          if (entry.intersectionRatio >= AUTOPLAY_VISIBLE_RATIO && !autoplayedScreens.has(entry.target)) {
            autoplayedScreens.add(entry.target);
            observed.play(0);
          }
        });
      }, { threshold: [0, AUTOPLAY_VISIBLE_RATIO] });
    }
    playersByScreen.set(screen, player);
    visibilityObserver.observe(screen);
  }

  /**
   * Wires a player to an SVG screen and a controls host. load(scene) shows the scene's final frame
   * as the poster; only one film plays at a time on the page.
   */
  function createPlayer(screen, controls) {
    const labels = settings.labels;
    const secondsFormat = new Intl.NumberFormat(settings.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    let scene = null;
    let time = 0;
    let isPlaying = false;
    let lastTick = null;
    let speedIndex = 0;
    let hasPlayedOnce = false;

    controls.innerHTML =
      '<button type="button" class="concept-film-primary" data-action="toggle">' + escapeXml(labels.play) + '</button>' +
      '<button type="button" data-action="restart">' + escapeXml(labels.restart) + '</button>' +
      '<button type="button" data-action="back" aria-label="' + escapeAttribute(labels.backDescription) + '">' + escapeXml(labels.back) + '</button>' +
      '<button type="button" data-action="forward" aria-label="' + escapeAttribute(labels.forwardDescription) + '">' + escapeXml(labels.forward) + '</button>' +
      '<input type="range" min="0" max="1000" step="1" value="1000" aria-label="' + escapeAttribute(labels.position) + '">' +
      '<button type="button" data-action="speed" aria-label="' + escapeAttribute(labels.speed) + '">× 1</button>' +
      (screen.requestFullscreen ? '<button type="button" data-action="fullscreen">' + escapeXml(labels.fullscreen) + '</button>' : '') +
      '<span class="concept-film-time"></span>';
    const toggleButton = controls.querySelector('[data-action="toggle"]');
    const speedButton = controls.querySelector('[data-action="speed"]');
    const slider = controls.querySelector('input');
    const clock = controls.querySelector('.concept-film-time');

    function render() {
      if (!scene) { return; }
      const duration = scene.duration();
      screen.innerHTML = scene.frame(time);
      slider.value = String(Math.round(1000 * time / duration));
      clock.textContent = secondsFormat.format(time) + ' / ' + secondsFormat.format(duration) + ' ' + labels.seconds;
      if (isPlaying) { toggleButton.textContent = labels.pause; }
      else if (time >= duration) { toggleButton.textContent = hasPlayedOnce ? labels.replay : labels.play; }
      else { toggleButton.textContent = time > 0 ? labels.resume : labels.play; }
    }
    function tick(now) {
      if (!isPlaying) { return; }
      if (lastTick !== null) { time = Math.min(scene.duration(), time + PLAYBACK_SPEEDS[speedIndex] * (now - lastTick) / 1000); }
      lastTick = now;
      if (time >= scene.duration()) { isPlaying = false; lastTick = null; hasPlayedOnce = true; }
      render();
      if (isPlaying) { requestAnimationFrame(tick); }
    }

    const player = {
      load(nextScene) {
        player.pause();
        scene = nextScene;
        time = scene.duration();
        hasPlayedOnce = false;
        render();
      },
      play(from) {
        if (!scene) { return; }
        players.forEach((other) => { if (other !== player) { other.pause(); } });
        if (from !== undefined) { time = from; }
        if (time >= scene.duration()) { time = 0; }
        if (isPlaying) { return; }
        isPlaying = true;
        lastTick = null;
        render();
        requestAnimationFrame(tick);
      },
      pause() {
        if (!isPlaying) { return; }
        isPlaying = false;
        lastTick = null;
        render();
      },
      seek(target) {
        if (!scene) { return; }
        isPlaying = false;
        lastTick = null;
        time = Math.max(0, Math.min(scene.duration(), target));
        render();
      },
      toggle() {
        if (isPlaying) { player.pause(); } else { player.play(); }
      }
    };
    players.add(player);

    controls.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) { return; }
      const action = button.dataset.action;
      if (action === 'toggle') { player.toggle(); }
      if (action === 'restart') { player.seek(0); }
      if (action === 'back') { player.seek(time - SEEK_STEP_SECONDS); }
      if (action === 'forward') { player.seek(time + SEEK_STEP_SECONDS); }
      if (action === 'speed') {
        speedIndex = (speedIndex + 1) % PLAYBACK_SPEEDS.length;
        speedButton.textContent = '× ' + formatNumber(PLAYBACK_SPEEDS[speedIndex], 1);
      }
      if (action === 'fullscreen') {
        const request = screen.requestFullscreen();
        if (request && request.catch) { request.catch(() => console.warn('[createPlayer] full screen refused')); }
      }
    });
    slider.addEventListener('input', () => { if (scene) { player.seek(scene.duration() * Number(slider.value) / 1000); } });
    // On the screen itself: space or enter plays and pauses, the arrows move 2 s, a click toggles.
    screen.setAttribute('tabindex', '0');
    screen.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); player.toggle(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); player.seek(time - SEEK_STEP_SECONDS); }
      if (event.key === 'ArrowRight') { event.preventDefault(); player.seek(time + SEEK_STEP_SECONDS); }
    });
    screen.addEventListener('click', () => player.toggle());
    observeForAutoplay(screen, player);
    return player;
  }

  /**
   * Mounts a film into `container`: title, caption, variant buttons, the screen and the player.
   * options.title and options.caption set to false leave those out. Returns the player, or null.
   */
  function mount(key, container, options) {
    const definition = definitions[key];
    if (!definition) { console.warn('[mount] unknown film ' + key); return null; }
    const mountOptions = options || {};
    const variants = definition.variants || [];
    const defaultIndex = definition.defaultVariant || 0;
    const figure = document.createElement('figure');
    figure.className = 'concept-film';
    figure.innerHTML =
      (mountOptions.title === false ? '' : '<h3 class="concept-film-title">' + escapeXml(definition.title || key) + '</h3>') +
      (definition.caption && mountOptions.caption !== false ? '<p class="concept-film-caption">' + escapeXml(definition.caption) + '</p>' : '') +
      (variants.length > 1 ? '<div class="concept-film-variants" role="group">' + variants.map((variant, variantIndex) =>
        '<button type="button" data-variant="' + variantIndex + '" aria-pressed="' + (variantIndex === defaultIndex) + '">' +
        escapeXml(variant.name) + '</button>').join('') + '</div>' : '') +
      '<svg class="concept-film-screen" viewBox="0 0 ' + FRAME.width + ' ' + FRAME.height + '" role="img" aria-label="' +
      escapeAttribute(definition.title || key) + '"></svg><div class="concept-film-player"></div>';
    container.appendChild(figure);
    const player = createPlayer(figure.querySelector('svg'), figure.querySelector('.concept-film-player'));

    function loadVariant(variantIndex, playNow) {
      const scene = buildScene(key, variantIndex);
      if (!scene) { return; }
      player.load(scene);
      if (playNow) { player.play(0); }
    }
    loadVariant(defaultIndex, false);
    const variantGroup = figure.querySelector('.concept-film-variants');
    if (variantGroup) {
      variantGroup.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) { return; }
        Array.prototype.forEach.call(variantGroup.children, (other) => other.setAttribute('aria-pressed', String(other === button)));
        loadVariant(Number(button.dataset.variant), true);
      });
    }
    return player;
  }
  /**
   * Mounts every element carrying data-film="key" under `root` (the document by default), once. The
   * element's own content, the exported poster as an <img> for readers without JavaScript, gives way
   * to the live film; it stays when the key is unknown, so the reader never faces an empty slot.
   */
  function mountAll(root) {
    (root || document).querySelectorAll('[data-film]').forEach((element) => {
      if (element.dataset.filmMounted) { return; }
      if (!definitions[element.dataset.film]) { console.warn('[mountAll] unknown film ' + element.dataset.film); return; }
      element.dataset.filmMounted = 'true';
      element.replaceChildren();
      mount(element.dataset.film, element);
    });
  }

  window.ConceptFilms = {
    FRAME,
    PACING,
    settings,
    define,
    list,
    buildScene,
    mount,
    mountAll,
    formatNumber,
    superscript,
    wrapNarration,
    get palette() { return resolveTheme().palette; },
    get fonts() { return resolveTheme().fonts; }
  };
})();
