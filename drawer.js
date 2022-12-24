import fs from "fs";
import property from "lodash/property.js";
import fileUrl from "file-url";
import { move } from "piscina";
import { resolve } from "path";
import { promisify } from "util";
import { withFile } from "tmp-promise";
import puppeteer from "puppeteer";
import template from "lodash/template.js";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const symbolWidth = 70;
const symbolHeight = 50;
const padding = 100;

export default async function draw(lines) {
  const width = lines[0].length * symbolWidth + padding * 2;
  const height = (lines.length + 1) * symbolHeight + padding * 2;
  const compile = template(await readFile("./template.html"));
  const browser = await puppeteer.launch();

  try {
    const page = await browser.newPage();
    const html = compile({
      lines,
      font: resolve(process.cwd(), "roboto.ttf"),
      letters: lines[0].map(property("letter")),
    });

    const buffer = await withFile(
      async function ({ path }) {
        await writeFile(path, html);
        await page.goto(fileUrl(path));
        await page.setViewport({ width, height, deviceScaleFactor: 2 });

        return await page.screenshot({
          clip: {
            x: 0,
            y: 0,
            width,
            height,
          },
        });
      },
      { name: "index.html" }
    );

    return move(buffer);
  } finally {
    await browser.close();
  }
}
