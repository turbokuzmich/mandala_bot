import BaseComponent from "./base.js";
import { symbolWidth, symbolHeight, colorBlack } from "../constants.js";

export default class Calculations extends BaseComponent {
  _measure = null;

  lines = null;
  colors = null;
  color = colorBlack;

  get measure() {
    if (!this._measure) {
      this._measure = {
        width: this.lines[0].length * symbolWidth,
        height: (this.lines.length + 1) * symbolHeight,
      };
    }

    return this._measure;
  }

  constructor(context, lines, colors, color = colorBlack, animations = {}) {
    super(context, animations);

    this.lines = [lines[0], ...lines];
    this.colors = colors;
    this.color = color;
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
    const { animations } = this.lines.reduce(
      ({ currentStart, currentDelay, currentDuration, animations }, _, row) => {
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

    this.context.translate(this.animate("x", 0), this.animate("y", 0));

    this.lines.forEach((line, index) => {
      if (index === 0) {
        this.renderLetters(line, index);
      } else {
        this.renderDigits(line, index);
      }
    });

    this.context.restore();
  }

  renderLetters(line, lineIndex) {
    line.forEach(({ letter }, index) => {
      const symbol = letter ? letter : "—";

      this.context.save();
      this.context.translate(symbolWidth * index, 0);

      const {
        lines: [{ y, width, height }],
      } = this.context.measureText(symbol);

      const newOpacity =
        this.animate("opacity", 1) * this.animate(`opacity_${lineIndex}`, 1);
      const newColor = this.color.alpha(this.color.alpha() * newOpacity);

      this.context.fillStyle = newColor.rgb();
      this.context.fillText(
        symbol,
        (symbolWidth - width) / 2,
        -y + (symbolHeight - height) / 2
      );

      this.context.restore();
    });
  }

  renderDigits(line, lineIndex) {
    line.forEach(({ index: symbol }, symbolIndex) => {
      this.context.save();

      this.context.translate(
        symbolWidth * symbolIndex +
          (this.measure.width - symbolWidth * line.length) / 2,
        symbolHeight * lineIndex
      );

      const {
        lines: [{ y, width, height }],
      } = this.context.measureText(symbol);

      const color = this.colors[symbol];
      const newOpacity =
        this.animate("opacity", 1) * this.animate(`opacity_${lineIndex}`, 1);
      const newColor = color.alpha(color.alpha() * newOpacity * 0.3);

      this.context.fillStyle = newColor.rgb();
      this.context.fillRect(0, 0, symbolWidth, symbolHeight);

      this.context.fillStyle = this.color
        .alpha(this.color.alpha() * newOpacity)
        .rgb();
      this.context.fillText(
        symbol,
        (symbolWidth - width) / 2,
        -y + (symbolHeight - height) / 2
      );

      this.context.restore();
    });
  }
}
