import Color from "color";

const sec = (value = 1) => value * 1000;
const min = (value = 1) => value * sec(60);

export const CalculationStatus = {
  Validation: "validation",
  Success: "success",
  Fail: "fail",
};

export const ResultFormat = {
  Raw: "raw",
  Mandala: "mandala",
  TextFile: "textfile",
};

export const resultTitle = "РАСЧЕТ МАНДАЛЫ";
export const font = "36px Roboto";
export const symbolWidth = 70;
export const symbolHeight = 50;
export const padding = 100;
export const titlePadding = 70;
export const calculationTimeout = 10000;
export const minimumCalculatableSize = 8;
export const base = 9;
export const mandalaBlockSize = 30;
export const mandalaBlocksCount = 16;
export const mandalaPadding = 70;
export const watchDistance = 500;
export const liveLocationTimeout = min(2);

export const PointStatus = {
  created: "created",
  voted: "voted",
  unvotedWeak: "unvoted-weak",
  unvotedStrong: "unvoted-strong",
};

export const PointStatusDescription = {
  [PointStatus.created]: "Приехал недавно",
  [PointStatus.voted]: "Подтвержден",
  [PointStatus.unvotedWeak]: "Без подтверждений",
  [PointStatus.unvotedStrong]: "Давно без подтверждений",
};

export const pointTimeouts = {
  [PointStatus.created]: min(),
  [PointStatus.voted]: min(2),
  [PointStatus.unvotedWeak]: min(5),
  [PointStatus.unvotedStrong]: min(10),
};

export const checkPointsInterval = sec(10);

export const ipcId = "mandala_bot_ipc_channel";
export const ipcMessageName = "mandala_bot_ipc_message";
export const ipcResponseTimeout = 2000;

export const colorBlack = Color({ r: 0, g: 0, b: 0 });

const russianLetters = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const englishLetters = "abcdefghijklmnopqrstuvwxyz";

function indexifyLetters(letters, start = 1, end = base) {
  return letters.split("").reduce(
    (result, letter) => {
      const { index, map } = result;

      const update = {
        ...map,
        [letter]: index,
      };

      return {
        index: index === end ? start : index + 1,
        map: update,
      };
    },
    { index: start, map: {} }
  ).map;
}

export const lettersIndexMap = {
  ...indexifyLetters(russianLetters),
  ...indexifyLetters(englishLetters),
};
