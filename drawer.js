import Color from "color";
import range from "lodash/range.js";
import { isMainThread } from "worker_threads";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { move } from "piscina";
import { Canvas, FontLibrary } from "skia-canvas";

import {
  font,
  symbolWidth,
  symbolHeight,
  padding,
  mandalaBlockSize,
  mandalaBlocksCount,
  mandalaPadding,
  titlePadding,
  resultTitle,
} from "./constants.js";

class ColorGenerator {
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

function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180);
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

class BlockRowSpanGenerator {
  size = 16;

  constructor(size = 16) {
    this.size = size;
  }

  [Symbol.iterator]() {
    let index = 1;

    return {
      next: () => {
        if (index === this.size) {
          return { done: true };
        }

        const value = index / this.size;

        index++;

        return { done: false, value };
      },
    };
  }
}

function calculateCanvasSize(context, originalText, lines) {
  const linesWidth = lines[0].length * symbolWidth;
  const linesHeight = (lines.length + 1) * symbolHeight;

  const widthProjection = Math.cos(degreesToRadians(30));
  const heightProjection = Math.sin(degreesToRadians(30));
  const blockProjectionWidth = mandalaBlockSize * widthProjection;
  const blockProjectionHeight = mandalaBlockSize * heightProjection;

  const mandalaWidth =
    widthProjection *
    (mandalaBlockSize * mandalaBlocksCount + blockProjectionWidth) *
    2;

  const mandalaHeight =
    (mandalaBlockSize * mandalaBlocksCount + blockProjectionHeight) * 2;

  const {
    lines: [titleMeasure],
  } = context.measureText(resultTitle, Infinity);

  const {
    lines: [textMeasure],
  } = context.measureText(`«${originalText}»`, Infinity);

  const titleHeight = Math.ceil(titleMeasure.height + textMeasure.height);

  const contentWidth =
    Math.ceil(
      Math.max(titleMeasure.width, textMeasure.width, linesWidth, mandalaWidth)
    ) +
    padding * 2;

  const contentHeight =
    titleHeight +
    titlePadding +
    mandalaHeight +
    mandalaPadding +
    linesHeight +
    padding * 2;

  return [contentWidth, contentHeight, titleHeight, mandalaHeight];
}

function drawTitle(context, originalText) {
  const { canvas } = context;
  const text = `«${originalText}»`;

  const {
    lines: [titleMeasure],
  } = context.measureText(resultTitle, Infinity);
  const {
    lines: [textMeasure],
  } = context.measureText(text, Infinity);

  context.save();
  context.translate(
    padding + (canvas.width - padding * 2 - titleMeasure.width) / 2,
    padding
  );
  context.fillText(resultTitle, 0, -titleMeasure.y);
  context.restore();

  context.save();
  context.translate(
    padding + (canvas.width - padding * 2 - textMeasure.width) / 2,
    padding + titleMeasure.height
  );
  context.fillText(text, 0, -titleMeasure.y);
  context.restore();
}

function drawCalculations(context, lines, titleHeight, mandalaHeight) {
  const linesContentLeftOffset =
    padding +
    (context.canvas.width - padding * 2 - lines[0].length * symbolWidth) / 2;

  context.save();
  context.translate(
    linesContentLeftOffset,
    padding + titleHeight + titlePadding + mandalaHeight + mandalaPadding
  );

  lines[0].forEach(({ letter }, index) => {
    const symbol = letter ? letter : "—";

    context.save();
    context.translate(symbolWidth * index, 0);

    const {
      lines: [{ y, width, height }],
    } = context.measureText(symbol);

    context.fillText(
      symbol,
      (symbolWidth - width) / 2,
      -y + (symbolHeight - height) / 2
    );

    context.restore();
  });

  context.restore();
  context.translate(
    linesContentLeftOffset,
    padding +
      titleHeight +
      titlePadding +
      mandalaHeight +
      mandalaPadding +
      symbolHeight
  );
  context.save();

  lines.forEach((line, lineIndex) => {
    const lineTopPadding = symbolHeight * lineIndex;
    const lineLeftPadding =
      (context.canvas.width -
        (linesContentLeftOffset * 2 + symbolWidth * line.length)) /
      2;

    context.save();
    context.translate(lineLeftPadding, lineTopPadding);

    line.forEach(({ index: symbol }, symbolIndex) => {
      context.save();
      context.translate(symbolWidth * symbolIndex, 0);

      const {
        lines: [{ y, width, height }],
      } = context.measureText(symbol);

      context.fillText(
        symbol,
        (symbolWidth - width) / 2,
        -y + (symbolHeight - height) / 2
      );

      context.restore();
    });

    context.restore();
  });

  context.restore();
}

function drawMandala(context, lines, titleHeight) {
  const angle = degreesToRadians(60);
  const widthProjection = Math.cos(degreesToRadians(30));
  const heightProjection = Math.sin(degreesToRadians(30));

  const blockProjectionWidth = mandalaBlockSize * widthProjection;
  const blockProjectionHeight = mandalaBlockSize * heightProjection;
  const mandalaBlocksCount = 16;
  const blockRows = [...new BlockRowsGenerator(mandalaBlocksCount)];
  const blockSpans = [...new BlockRowSpanGenerator(mandalaBlocksCount)];

  const colors = [
    ...new ColorGenerator(
      mandalaBlocksCount,
      20 + Math.round(Math.random() * 40)
    ),
  ];

  context.save();

  context.translate(
    context.canvas.width / 2,
    padding +
      titleHeight +
      titlePadding +
      mandalaBlockSize * mandalaBlocksCount +
      blockProjectionHeight
  );

  for (let sideIndex = 0; sideIndex < 6; sideIndex++) {
    context.save();
    context.rotate(angle * sideIndex);

    for (const { row, count } of blockRows) {
      for (let blockIndex = 0; blockIndex < count; blockIndex++) {
        const x1 = row * blockProjectionWidth;
        const y1 = mandalaBlockSize * blockIndex + row * blockProjectionHeight;
        const x2 = x1 + blockProjectionWidth;
        const y2 = y1 + blockProjectionHeight;
        const x3 = x2;
        const y3 = y2 + mandalaBlockSize;
        const x4 = x1;
        const y4 = y1 + mandalaBlockSize;

        const proportion =
          Math.sqrt(x1 * x1 + y1 * y1) /
          ((Math.sin(angle) * (mandalaBlocksCount * mandalaBlockSize)) /
            Math.sin(degreesToRadians(120) - Math.atan2(x1, y1)));

        const { index } = blockSpans.reduce(
          (result, span, index) => {
            const delta = Math.abs(proportion - span);

            if (delta < result.delta) {
              result.delta = delta;
              result.index = index;
            }

            return result;
          },
          { delta: Infinity, index: 0 }
        );

        context.fillStyle = colors[index].hex();

        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.lineTo(x3, y3);
        context.lineTo(x4, y4);
        context.closePath();
        context.fill();
      }
    }

    context.restore();
  }

  context.restore();
}

async function initialize() {
  FontLibrary.use("Roboto", resolve(process.cwd(), "roboto.ttf"));

  return async function ({ originalText, lines }) {
    const canvas = new Canvas();
    const context = canvas.getContext("2d");

    context.font = font;

    const [width, height, titleHeight, mandalaHeight] = calculateCanvasSize(
      context,
      originalText,
      lines
    );

    canvas.width = width;
    canvas.height = height;

    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#000";

    context.font = font;

    drawTitle(context, originalText);
    drawMandala(context, lines, titleHeight);
    drawCalculations(context, lines, titleHeight, mandalaHeight);

    if (isMainThread) {
      await canvas.saveAs("./out.png");
    } else {
      return move(await canvas.toBuffer("png", { density: 2 }));
    }
  };
}

async function main() {
  const work = await initialize();
  const raw = await readFile("./data.json", "utf-8");
  const data = JSON.parse(raw);

  await work(data);
}

// main();
export default initialize();
