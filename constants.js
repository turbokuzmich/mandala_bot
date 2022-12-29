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
export const mandalaBlockSize = 20;
export const mandalaBlocksCount = 16;
export const mandalaPadding = 70;

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
