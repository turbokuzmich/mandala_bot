import BaseComponent from "./base.js";
import { mandalaBlockSize, mandalaBlocksCount } from "../constants.js";

function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180);
}

const sin30 = Math.sin(degreesToRadians(30));
const cos30 = Math.cos(degreesToRadians(30));
const deg60 = degreesToRadians(60);
const sidesCount = 6;

export default class Mandala extends BaseComponent {
  _measure = null;
  _indices = null;
  _blockRows = null;
  _blocksCount = null;
  _blockProjectionWidth = 0;
  _blockProjectionHeight = 0;

  lines = [];
  colors = [];

  get measure() {
    if (!this._measure) {
      this._measure = {
        width:
          cos30 *
          (mandalaBlockSize * mandalaBlocksCount + this.blockProjectionWidth) *
          2,
        height:
          (mandalaBlockSize * mandalaBlocksCount + this.blockProjectionHeight) *
          2,
      };
    }

    return this._measure;
  }

  get blockProjectionWidth() {
    if (!this._blockProjectionWidth) {
      this._blockProjectionWidth = mandalaBlockSize * cos30;
    }

    return this._blockProjectionWidth;
  }

  get blockProjectionHeight() {
    if (!this._blockProjectionHeight) {
      this._blockProjectionHeight = mandalaBlockSize * sin30;
    }

    return this._blockProjectionHeight;
  }

  get indices() {
    if (!this._indices) {
      this._indices = this.lines.reduceRight(
        (result, line) => [...result, line],
        []
      );
    }

    return this._indices;
  }

  get blockRows() {
    if (!this._blockRows) {
      this._blockRows = [...new BlockRowsGenerator(mandalaBlocksCount)];
    }

    return this._blockRows;
  }

  get blocksCount() {
    if (!this._blocksCount) {
      this._blocksCount =
        this.blockRows.reduce((total, { count }) => total + count, 0) *
        sidesCount;
    }

    return this._blocksCount;
  }

  constructor(context, lines, colors, animations = {}) {
    super(context, animations);

    this.lines = lines;
    this.colors = colors;
  }

  addRowsAnimation({
    property,
    start = 0,
    duration = 10,
    durationGrowth = 0,
    delay = 5,
    delayGrowth = 0,
    values,
    easing,
  }) {
    const { animations } = this.blockRows.reduce(
      (
        { currentStart, currentDelay, currentDuration, animations },
        { row }
      ) => {
        return {
          currentStart: currentStart + currentDelay,
          currentDelay: currentDelay + delayGrowth,
          currentDuration: currentDuration + durationGrowth,
          animations: {
            ...animations,
            [`${property}_${row}`]: [
              [currentStart, currentStart + currentDuration - 1],
              values,
              easing,
            ],
          },
        };
      },
      {
        currentStart: start,
        currentDelay: delay,
        currentDuration: duration,
        animations: {},
      }
    );

    this.animations = { ...this.animations, ...animations };
  }

  render() {
    super.render();

    this.context.save();

    this.context.translate(
      this.measure.width / 2 + this.animate("x", 0),
      mandalaBlockSize * mandalaBlocksCount +
        this.blockProjectionHeight +
        this.animate("y", 0)
    );

    for (let sideIndex = 0; sideIndex < sidesCount; sideIndex++) {
      this.context.save();
      this.context.rotate(deg60 * sideIndex);

      for (const { row, count } of this.blockRows) {
        for (let blockIndex = 0; blockIndex < count; blockIndex++) {
          const x1 = row * this.blockProjectionWidth;
          const y1 =
            mandalaBlockSize * blockIndex + row * this.blockProjectionHeight;
          const x2 = x1 + this.blockProjectionWidth;
          const y2 = y1 + this.blockProjectionHeight;
          const x3 = x2;
          const y3 = y2 + mandalaBlockSize;
          const x4 = x1;
          const y4 = y1 + mandalaBlockSize;

          const newOpacity =
            this.animate("opacity", 1) *
            this.animate(`opacity_${blockIndex + row}`, 1);

          const color =
            this.colors[this.indices[blockIndex + row][blockIndex].index - 1];
          const newColor = color.alpha(color.alpha() * newOpacity);

          this.context.fillStyle = newColor.rgb();

          this.context.beginPath();
          this.context.moveTo(x1, y1);
          this.context.lineTo(x2, y2);
          this.context.lineTo(x3, y3);
          this.context.lineTo(x4, y4);
          this.context.closePath();
          this.context.fill();
        }
      }

      this.context.restore();
    }

    this.context.restore();
  }
}

class BlockRowsGenerator {
  side = 16;

  constructor(side = 16) {
    this.side = side;
  }

  [Symbol.iterator]() {
    let row = 0;

    return {
      next: () => {
        if (row === this.side) {
          return { done: true };
        }

        const result = { row, count: this.side - row };

        row++;

        return { done: false, value: result };
      },
    };
  }
}
