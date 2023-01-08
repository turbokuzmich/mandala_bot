import Color from "color";
import range from "lodash/range.js";

export default class ColorGenerator {
  size = 3;

  minHue = 0;
  maxHue = 360;

  restrictedHueStart = 280;
  restrictedHueEnd = 316;

  minSaturation = 90;
  maxSaturation = 100;

  minLightness = 70;
  maxLightness = 80;

  rotation = 10;

  static getColors(count) {
    return [...new ColorGenerator(count, 20 + Math.round(Math.random() * 40))];
  }

  constructor(size = 3, rotation = 10) {
    this.size = size;
    this.rotation = rotation;
  }

  random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  rotate(hue) {
    const newHue = hue + this.rotation;
    const correctedHue = newHue > this.maxHue ? newHue - this.maxHue : newHue;

    if (
      correctedHue > this.restrictedHueStart &&
      correctedHue < this.restrictedHueEnd
    ) {
      const beautifulHue =
        this.restrictedHueEnd + correctedHue - this.restrictedHueStart;

      return beautifulHue > this.maxHue
        ? beautifulHue - this.maxHue
        : beautifulHue;
    }

    return correctedHue;
  }

  getHue() {
    while (true) {
      const hue = this.random(this.minHue, this.maxHue);

      if (hue > this.restrictedHueStart && hue < this.restrictedHueEnd) {
        continue;
      }

      return hue;
    }
  }

  [Symbol.iterator]() {
    let index = 0;
    let baseColor = null;

    return {
      next: () => {
        if (index === this.size) {
          return { done: true };
        }

        const current = index;
        index++;

        if (current === 0) {
          const hue = this.getHue();
          const saturation = this.random(
            this.minSaturation,
            this.maxSaturation
          );
          const lightness = this.random(this.minLightness, this.maxLightness);

          baseColor = Color.hsl(hue, saturation, lightness);

          return { done: false, value: baseColor };
        } else {
          const {
            color: [baseHue, baseSaturation],
          } = baseColor;

          const hue = range(current).reduce((hue) => this.rotate(hue), baseHue);
          const lightness = this.random(this.minLightness, this.maxLightness);

          return {
            done: false,
            value: Color.hsl(hue, baseSaturation, lightness),
          };
        }
      },
    };
  }
}
