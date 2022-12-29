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
  titlePadding,
  resultTitle,
} from "./constants.js";

function calculateCanvasSize(context, originalText, lines) {
  const linesWidth = lines[0].length * symbolWidth;
  const linesHeight = (lines.length + 1) * symbolHeight;
  const {
    lines: [titleMeasure],
  } = context.measureText(resultTitle, Infinity);
  const {
    lines: [textMeasure],
  } = context.measureText(`«${originalText}»`, Infinity);

  const titleHeight = Math.ceil(titleMeasure.height + textMeasure.height);

  const contentWidth =
    Math.ceil(Math.max(titleMeasure.width, textMeasure.width, linesWidth)) +
    padding * 2;
  const contentHeight = titleHeight + titlePadding + linesHeight + padding * 2;

  return [contentWidth, contentHeight, titleHeight];
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

function drawCalculations(context, lines, titleHeight) {
  const linesContentLeftOffset =
    padding +
    (context.canvas.width - padding * 2 - lines[0].length * symbolWidth) / 2;

  context.save();
  context.translate(
    linesContentLeftOffset,
    padding + titleHeight + titlePadding
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
    padding + titleHeight + titlePadding + symbolHeight
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
}

async function initialize() {
  FontLibrary.use("Roboto", resolve(process.cwd(), "roboto.ttf"));

  return async function ({ originalText, lines }) {
    const canvas = new Canvas();
    const context = canvas.getContext("2d");

    context.font = font;

    const [width, height, titleHeight] = calculateCanvasSize(
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
    drawCalculations(context, lines, titleHeight);

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

export default initialize();
