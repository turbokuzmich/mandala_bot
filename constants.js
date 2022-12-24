export const CalculationStatus = {
  Validation: "validation",
  Success: "success",
  Fail: "fail",
};

export const ResultFormat = {
  Raw: "raw",
  TextFile: "textfile",
  Messages: "messages",
};

export const calculationTimeout = 10000;
export const minimumCalculatableSize = 8;
export const base = 9;
export const maxTelegramMessageSize = 4096;
export const messageWrapperSize = "</code>".length * 2;
export const maxTextSizeForMessage = Math.floor(
  (maxTelegramMessageSize - messageWrapperSize) / 2
);

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
