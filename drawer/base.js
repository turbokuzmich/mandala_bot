import entries from "lodash/entries.js";
import get from "lodash/get.js";

export default class BaseComponent {
  context = null;
  frame = null;
  animations = {};
  animated = {};

  constructor(context, animations = {}) {
    this.context = context;
    this.animations = animations;
  }

  getFramesCount() {
    return Math.max(
      ...Object.values(this.animations).map(([[_, endFrame]]) => endFrame + 1),
      0
    );
  }

  setFrame(frame) {
    this.frame = frame;
  }

  render() {
    if (this.frame === null) {
      return;
    }

    for (const [
      key,
      [inputRange, outputRange, easing = Easing.linear],
    ] of entries(this.animations)) {
      this.animated[key] = interpolate(this.frame, inputRange, outputRange, {
        easing,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
  }

  animate(property, defaults) {
    return get(this.animated, property, defaults);
  }

  animateColorOpacity(color) {
    return color.alpha(get(this.animated, "opacity", color.alpha()));
  }
}

const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const kSplineTableSize = 11;
const kSampleStepSize = 1.0 / (kSplineTableSize - 1.0);
const float32ArraySupported = typeof Float32Array === "function";
function a(aA1, aA2) {
  return 1.0 - 3.0 * aA2 + 3.0 * aA1;
}
function b(aA1, aA2) {
  return 3.0 * aA2 - 6.0 * aA1;
}
function c(aA1) {
  return 3.0 * aA1;
}
// Returns x(t) given t, x1, and x2, or y(t) given t, y1, and y2.
function calcBezier(aT, aA1, aA2) {
  return ((a(aA1, aA2) * aT + b(aA1, aA2)) * aT + c(aA1)) * aT;
}
// Returns dx/dt given t, x1, and x2, or dy/dt given t, y1, and y2.
function getSlope(aT, aA1, aA2) {
  return 3.0 * a(aA1, aA2) * aT * aT + 2.0 * b(aA1, aA2) * aT + c(aA1);
}
function binarySubdivide({ aX, _aA, _aB, mX1, mX2 }) {
  let currentX;
  let currentT;
  let i = 0;
  let aA = _aA;
  let aB = _aB;
  do {
    currentT = aA + (aB - aA) / 2.0;
    currentX = calcBezier(currentT, mX1, mX2) - aX;
    if (currentX > 0.0) {
      aB = currentT;
    } else {
      aA = currentT;
    }
  } while (
    Math.abs(currentX) > SUBDIVISION_PRECISION &&
    ++i < SUBDIVISION_MAX_ITERATIONS
  );
  return currentT;
}
function newtonRaphsonIterate(aX, _aGuessT, mX1, mX2) {
  let aGuessT = _aGuessT;
  for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
    const currentSlope = getSlope(aGuessT, mX1, mX2);
    if (currentSlope === 0.0) {
      return aGuessT;
    }
    const currentX = calcBezier(aGuessT, mX1, mX2) - aX;
    aGuessT -= currentX / currentSlope;
  }
  return aGuessT;
}
function bezier(mX1, mY1, mX2, mY2) {
  if (!(mX1 >= 0 && mX1 <= 1 && mX2 >= 0 && mX2 <= 1)) {
    throw new Error("bezier x values must be in [0, 1] range");
  }
  // Precompute samples table
  const sampleValues = float32ArraySupported
    ? new Float32Array(kSplineTableSize)
    : new Array(kSplineTableSize);
  if (mX1 !== mY1 || mX2 !== mY2) {
    for (let i = 0; i < kSplineTableSize; ++i) {
      sampleValues[i] = calcBezier(i * kSampleStepSize, mX1, mX2);
    }
  }
  function getTForX(aX) {
    let intervalStart = 0.0;
    let currentSample = 1;
    const lastSample = kSplineTableSize - 1;
    for (
      ;
      currentSample !== lastSample && sampleValues[currentSample] <= aX;
      ++currentSample
    ) {
      intervalStart += kSampleStepSize;
    }
    --currentSample;
    // Interpolate to provide an initial guess for t
    const dist =
      (aX - sampleValues[currentSample]) /
      (sampleValues[currentSample + 1] - sampleValues[currentSample]);
    const guessForT = intervalStart + dist * kSampleStepSize;
    const initialSlope = getSlope(guessForT, mX1, mX2);
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      return newtonRaphsonIterate(aX, guessForT, mX1, mX2);
    }
    if (initialSlope === 0.0) {
      return guessForT;
    }
    return binarySubdivide({
      aX,
      _aA: intervalStart,
      _aB: intervalStart + kSampleStepSize,
      mX1,
      mX2,
    });
  }
  return function (x) {
    if (mX1 === mY1 && mX2 === mY2) {
      return x; // linear
    }
    // Because JavaScript number are imprecise, we should guarantee the extremes are right.
    if (x === 0) {
      return 0;
    }
    if (x === 1) {
      return 1;
    }
    return calcBezier(getTForX(x), mY1, mY2);
  };
}

export class Easing {
  static step0(n) {
    return n > 0 ? 1 : 0;
  }
  static step1(n) {
    return n >= 1 ? 1 : 0;
  }
  static linear(t) {
    return t;
  }
  static ease(t) {
    return Easing.bezier(0.42, 0, 1, 1)(t);
  }
  static quad(t) {
    return t * t;
  }
  static cubic(t) {
    return t * t * t;
  }
  static poly(n) {
    return (t) => t ** n;
  }
  static sin(t) {
    return 1 - Math.cos((t * Math.PI) / 2);
  }
  static circle(t) {
    return 1 - Math.sqrt(1 - t * t);
  }
  static exp(t) {
    return 2 ** (10 * (t - 1));
  }
  static elastic(bounciness = 1) {
    const p = bounciness * Math.PI;
    return (t) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
  }
  static back(s = 1.70158) {
    return (t) => t * t * ((s + 1) * t - s);
  }
  static bounce(t) {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    }
    if (t < 2 / 2.75) {
      const t2_ = t - 1.5 / 2.75;
      return 7.5625 * t2_ * t2_ + 0.75;
    }
    if (t < 2.5 / 2.75) {
      const t2_ = t - 2.25 / 2.75;
      return 7.5625 * t2_ * t2_ + 0.9375;
    }
    const t2 = t - 2.625 / 2.75;
    return 7.5625 * t2 * t2 + 0.984375;
  }
  static bezier(x1, y1, x2, y2) {
    return bezier(x1, y1, x2, y2);
  }
  static in(easing) {
    return easing;
  }
  static out(easing) {
    return (t) => 1 - easing(1 - t);
  }
  static inOut(easing) {
    return (t) => {
      if (t < 0.5) {
        return easing(t * 2) / 2;
      }
      return 1 - easing((1 - t) * 2) / 2;
    };
  }
}

function interpolateFunction(input, inputRange, outputRange, options) {
  const { extrapolateLeft, extrapolateRight, easing } = options;
  let result = input;
  const [inputMin, inputMax] = inputRange;
  const [outputMin, outputMax] = outputRange;
  if (result < inputMin) {
    if (extrapolateLeft === "identity") {
      return result;
    }
    if (extrapolateLeft === "clamp") {
      result = inputMin;
    } else if (extrapolateLeft === "extend") {
      // noop
    }
  }
  if (result > inputMax) {
    if (extrapolateRight === "identity") {
      return result;
    }
    if (extrapolateRight === "clamp") {
      result = inputMax;
    } else if (extrapolateRight === "extend") {
      // noop
    }
  }
  if (outputMin === outputMax) {
    return outputMin;
  }
  // Input Range
  result = (result - inputMin) / (inputMax - inputMin);
  // Easing
  result = easing(result);
  // Output Range
  result = result * (outputMax - outputMin) + outputMin;
  return result;
}
function findRange(input, inputRange) {
  let i;
  for (i = 1; i < inputRange.length - 1; ++i) {
    if (inputRange[i] >= input) {
      break;
    }
  }
  return i - 1;
}
function checkValidInputRange(arr) {
  for (let i = 1; i < arr.length; ++i) {
    if (!(arr[i] > arr[i - 1])) {
      throw new Error(
        `inputRange must be strictly monotonically non-decreasing but got [${arr.join(
          ","
        )}]`
      );
    }
  }
}
function checkInfiniteRange(name, arr) {
  if (arr.length < 2) {
    throw new Error(name + " must have at least 2 elements");
  }
  for (const index in arr) {
    if (typeof arr[index] !== "number") {
      throw new Error(`${name} must contain only numbers`);
    }
    if (arr[index] === -Infinity || arr[index] === Infinity) {
      throw new Error(
        `${name} must contain only finite numbers, but got [${arr.join(",")}]`
      );
    }
  }
}
/**
 * Map a value from an input range to an output range.
 * @link https://www.remotion.dev/docs/interpolate
 * @param {!number} input value to interpolate
 * @param {!number[]} inputRange range of values that you expect the input to assume.
 * @param {!number[]} outputRange range of output values that you want the input to map to.
 * @param {?object} options
 * @param {?Function} options.easing easing function which allows you to customize the input, for example to apply a certain easing function. By default, the input is left unmodified, resulting in a pure linear interpolation {@link https://www.remotion.dev/docs/easing}
 * @param {string=} [options.extrapolateLeft="extend"] What should happen if the input value is outside left the input range, default: "extend" {@link https://www.remotion.dev/docs/interpolate#extrapolateleft}
 * @param {string=} [options.extrapolateRight="extend"] Same as extrapolateLeft, except for values outside right the input range {@link https://www.remotion.dev/docs/interpolate#extrapolateright}
 */
export function interpolate(input, inputRange, outputRange, options) {
  var _a;
  if (typeof input === "undefined") {
    throw new Error("input can not be undefined");
  }
  if (typeof inputRange === "undefined") {
    throw new Error("inputRange can not be undefined");
  }
  if (typeof outputRange === "undefined") {
    throw new Error("outputRange can not be undefined");
  }
  if (inputRange.length !== outputRange.length) {
    throw new Error(
      "inputRange (" +
        inputRange.length +
        ") and outputRange (" +
        outputRange.length +
        ") must have the same length"
    );
  }
  checkInfiniteRange("inputRange", inputRange);
  checkInfiniteRange("outputRange", outputRange);
  checkValidInputRange(inputRange);
  const easing =
    (_a = options === null || options === void 0 ? void 0 : options.easing) !==
      null && _a !== void 0
      ? _a
      : (num) => num;
  let extrapolateLeft = "extend";
  if (
    (options === null || options === void 0
      ? void 0
      : options.extrapolateLeft) !== undefined
  ) {
    extrapolateLeft = options.extrapolateLeft;
  }
  let extrapolateRight = "extend";
  if (
    (options === null || options === void 0
      ? void 0
      : options.extrapolateRight) !== undefined
  ) {
    extrapolateRight = options.extrapolateRight;
  }
  if (typeof input !== "number") {
    throw new TypeError("Cannot interpolate an input which is not a number");
  }
  const range = findRange(input, inputRange);
  return interpolateFunction(
    input,
    [inputRange[range], inputRange[range + 1]],
    [outputRange[range], outputRange[range + 1]],
    {
      easing,
      extrapolateLeft,
      extrapolateRight,
    }
  );
}
