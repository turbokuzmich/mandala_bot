import { resolve } from "path";
import { move } from "piscina";
import { Canvas, FontLibrary } from "skia-canvas";

const symbolWidth = 70;
const symbolHeight = 50;
const padding = 100;

async function initialize() {
  FontLibrary.use("Roboto", resolve(process.cwd(), "roboto.ttf"));

  return async function (lines) {
    const width = lines[0].length * symbolWidth + padding * 2;
    const height = (lines.length + 1) * symbolHeight + padding * 2;

    const canvas = new Canvas(width, height);
    const context = canvas.getContext("2d");

    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);

    context.font = "36px Roboto";
    context.fillStyle = "#000";

    context.save();
    context.translate(padding, padding);

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
    context.translate(padding, padding + symbolHeight);
    context.save();

    lines.forEach((line, lineIndex) => {
      const lineTopPadding = symbolHeight * lineIndex;
      const lineLeftPadding =
        (width - (padding * 2 + symbolWidth * line.length)) / 2;

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

    return move(await canvas.toBuffer("png"));
  };
}

export default initialize();
