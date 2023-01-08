import Text from "./drawer/text.js";
import Title from "./drawer/title.js";
import Mandala from "./drawer/mandala.js";
import Calculations from "./drawer/calculations.js";
import Background from "./drawer/background.js";
import ColorGenerator from "./drawer/color-generator.js";
import { Easing } from "./drawer/base.js";
import { Layout, LayoutBlock } from "./drawer/layout.js";
import { isMainThread } from "worker_threads";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { move } from "piscina";
import { Canvas, FontLibrary } from "skia-canvas";

import { withDir } from "tmp-promise";
import { spawn } from "child_process";
import { copyFile } from "fs/promises";

import {
  font,
  padding,
  colorBlack,
  mandalaBlocksCount,
  mandalaPadding,
  titlePadding,
} from "./constants.js";

function buildAnimationFramesInput(duration = 10) {
  return function (start = 0) {
    return [start, start + duration - 1];
  };
}

async function initialize() {
  FontLibrary.use("Roboto", resolve(process.cwd(), "roboto.ttf"));

  return async function ({ originalText, mandala, lines }) {
    const animateTextFrom = buildAnimationFramesInput(80);

    const canvas = new Canvas();
    const context = canvas.getContext("2d");
    const colors = ColorGenerator.getColors(mandalaBlocksCount);
    const layout = new Layout(context);

    context.font = font;

    const title = new Title(context, colorBlack, {
      y: [animateTextFrom(0), [-100, 0], Easing.out(Easing.cubic)],
      opacity: [animateTextFrom(0), [0, 1], Easing.out(Easing.cubic)],
    });
    const text = new Text(context, originalText, colorBlack, {
      y: [animateTextFrom(10), [-100, 0], Easing.out(Easing.cubic)],
      opacity: [animateTextFrom(10), [0, 1], Easing.out(Easing.cubic)],
    });
    const blocks = new Mandala(context, mandala, colors);
    const calculations = new Calculations(context, lines, colors, colorBlack);

    blocks.addRowsAnimation({
      property: "opacity",
      start: 30,
      duration: 10,
      durationGrowth: 10,
      delay: 1,
      delayGrowth: 0,
      values: [0, 1],
      easing: Easing.out(Easing.cubic),
    });

    calculations.addRowsAnimation({
      property: "opacity",
      start: 40,
      duration: 10,
      durationGrowth: 10,
      delay: 1,
      delayGrowth: 0,
      values: [0, 1],
      easing: Easing.out(Easing.cubic),
    });

    const titleblock = new LayoutBlock(context, title, "center", {
      left: padding,
      top: padding,
      right: padding,
    });
    const textBlock = new LayoutBlock(context, text, "center", {
      left: padding,
      right: padding,
    });
    const blocksBlock = new LayoutBlock(context, blocks, "center", {
      left: padding,
      top: titlePadding,
      right: padding,
    });
    const calculationsBlock = new LayoutBlock(context, calculations, "center", {
      left: padding,
      top: mandalaPadding,
      right: padding,
      bottom: padding,
    });

    layout.appendBlock(titleblock);
    layout.appendBlock(textBlock);
    layout.appendBlock(blocksBlock);
    layout.appendBlock(calculationsBlock);

    const {
      size: { width, height },
    } = layout;

    canvas.width = width;
    canvas.height = height;

    const background = new Background(
      context,
      { y2: height },
      { width, height },
      [
        { at: 0, color: "#fefefe" },
        { at: 1, color: "#dddddd" },
      ]
    );

    background.render();

    context.font = font;

    layout.render();

    // const fps = 60;
    // const framesPerVideo = layout.getFramesCount();

    // await withDir(
    //   async function ({ path }) {
    //     try {
    //       for (let frame = 0; frame < framesPerVideo; frame++) {
    //         context.clearRect(0, 0, width, height);

    //         background.render();

    //         context.font = font;

    //         layout.setFrame(frame);
    //         layout.render();

    //         const name =
    //           "slice-" +
    //           ("000" + frame).substring(("000" + frame).length - 3) +
    //           ".png";

    //         await canvas.saveAs(resolve(path, name), { density: 2 });
    //         console.log("rendered", frame + 1, "of", framesPerVideo);
    //       }

    //       await renderVideo(path, fps);
    //       await copyFile(
    //         resolve(path, "video.mp4"),
    //         resolve(process.cwd(), "out", "video.mp4")
    //       );
    //     } catch (error) {
    //       console.log(error);
    //     }
    //   },
    //   {
    //     unsafeCleanup: true,
    //   }
    // );

    if (isMainThread) {
      await canvas.saveAs("./out.png");
    } else {
      return move(await canvas.toBuffer("png", { density: 2 }));
    }
  };
}

function renderVideo(path, fps) {
  return new Promise(function (resolve, reject) {
    const converter = spawn(
      "ffmpeg",
      [
        "-framerate",
        fps,
        "-i",
        "./slice-%03d.png",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "video.mp4",
      ],
      {
        cwd: path,
      }
    );

    converter.stdout.on("data", (data) => {
      console.log(`ffmpeg: ${data}`);
    });

    converter.stderr.on("data", (data) => {
      console.error(`ffmpeg: ${data}`);
    });

    converter.on("close", (code) => {
      if (code === 0) {
        console.log("ffmpeg: converted");
        resolve();
      } else {
        console.log("ffmpeg: failed");
        reject("ffmpeg failed");
      }
    });
  });
}

async function main() {
  const work = await initialize();
  const raw = await readFile("./data.json", "utf-8");
  const data = JSON.parse(raw);

  await work(data);
}

// main();
export default initialize();
