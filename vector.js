import { resolve } from "path";
import { createSVGWindow } from "svgdom";
import { SVG, registerWindow } from "@svgdotjs/svg.js";
import { writeFileSync } from "fs";
import * as converter from "convert-svg-to-png";

const symbolWidth = 70;
const symbolHeight = 50;
const fontSize = 36;
const padding = 100;

const data = {
  data: {
    trim: {
      originalSize: 10,
      timmedSize: 10,
      originalText: "я счастлив",
      trimmedText: "я счастлив",
    },
    letters: ["я", "с", "ч", "а", "с", "т", "л", "и", "в"],
  },
  formats: {
    raw: [
      [
        {
          letter: "я",
          index: 6,
        },
        {
          letter: "с",
          index: 1,
        },
        {
          letter: "ч",
          index: 7,
        },
        {
          letter: "а",
          index: 1,
        },
        {
          letter: "с",
          index: 1,
        },
        {
          letter: "т",
          index: 2,
        },
        {
          letter: "л",
          index: 4,
        },
        {
          letter: "и",
          index: 1,
        },
        {
          letter: "в",
          index: 3,
        },
      ],
      [
        {
          letter: "",
          index: 7,
        },
        {
          letter: "",
          index: 8,
        },
        {
          letter: "",
          index: 8,
        },
        {
          letter: "",
          index: 2,
        },
        {
          letter: "",
          index: 3,
        },
        {
          letter: "",
          index: 6,
        },
        {
          letter: "",
          index: 5,
        },
        {
          letter: "",
          index: 4,
        },
      ],
      [
        {
          letter: "",
          index: 6,
        },
        {
          letter: "",
          index: 7,
        },
        {
          letter: "",
          index: 1,
        },
        {
          letter: "",
          index: 5,
        },
        {
          letter: "",
          index: 9,
        },
        {
          letter: "",
          index: 2,
        },
        {
          letter: "",
          index: 9,
        },
      ],
      [
        {
          letter: "",
          index: 4,
        },
        {
          letter: "",
          index: 8,
        },
        {
          letter: "",
          index: 6,
        },
        {
          letter: "",
          index: 5,
        },
        {
          letter: "",
          index: 2,
        },
        {
          letter: "",
          index: 2,
        },
      ],
      [
        {
          letter: "",
          index: 3,
        },
        {
          letter: "",
          index: 5,
        },
        {
          letter: "",
          index: 2,
        },
        {
          letter: "",
          index: 7,
        },
        {
          letter: "",
          index: 4,
        },
      ],
      [
        {
          letter: "",
          index: 8,
        },
        {
          letter: "",
          index: 7,
        },
        {
          letter: "",
          index: 9,
        },
        {
          letter: "",
          index: 2,
        },
      ],
      [
        {
          letter: "",
          index: 6,
        },
        {
          letter: "",
          index: 7,
        },
        {
          letter: "",
          index: 2,
        },
      ],
      [
        {
          letter: "",
          index: 4,
        },
        {
          letter: "",
          index: 9,
        },
      ],
      [
        {
          letter: "",
          index: 4,
        },
      ],
    ],
  },
};

function drawLine(container, spec, index = 0, offset = 0, mode = "index") {
  const line = container
    .group()
    .translate((offset * symbolWidth) / 2, index * symbolHeight);

  spec.forEach((data, index) => {
    const symbol = `${data[mode]}`;

    if (symbol.length === 0) {
      return;
    }

    line
      .rect(symbolWidth, symbolHeight)
      .x(index * symbolWidth)
      .y(0)
      .fill("#ff00ff");

    line
      .plain(symbol)
      .font({
        family: "Roboto",
        size: fontSize,
      })
      .x(index * symbolWidth)
      .y(0);
  });
}

async function main() {
  const width = data.formats.raw[0].length * symbolWidth + padding * 2;
  const height = (data.formats.raw.length + 1) * symbolHeight + padding * 2;

  const window = createSVGWindow();
  const document = window.document;

  registerWindow(window, document);

  const drawing = SVG(document.documentElement).size(width, height);
  const content = drawing.group().translate(padding, padding);

  drawing.fontface(
    "'Roboto'",
    `url('${resolve(process.cwd(), "roboto.ttf")}') format('truetype')`
  );

  drawLine(content, data.formats.raw[0], 0, 0, "letter");

  data.formats.raw.forEach((line, index) => {
    drawLine(content, line, index + 1, index);
  });

  const svg = drawing.svg();

  // writeFileSync("./icon.svg", svg);
  // writeFileSync("./icon.png", result);
}

main();
