import property from "lodash/property.js";

import {
  base,
  resultTitle,
  lettersIndexMap,
  minimumCalculatableSize,
  ResultFormat,
  CalculationStatus,
} from "./constants.js";

function getSum(indexA, indexB, ceil = base) {
  const sum = indexA + indexB;

  return sum > ceil ? sum - ceil : sum;
}

class MinimumCalculatableSizeLetters {
  letters = [];
  size = minimumCalculatableSize;

  constructor(letters, size = minimumCalculatableSize) {
    this.letters = letters;
    this.size = Math.max(size, this.letters.length);
  }

  [Symbol.iterator]() {
    const size = this.size;
    const letters = this.letters;

    let index = 0;
    let lastTwo = [0, 0];

    return {
      next() {
        if (index === size) {
          return { done: true };
        }

        if (index < letters.length) {
          const letter = letters[index];

          lastTwo = [lastTwo[1], letter.index];
          index = index + 1;

          return {
            done: false,
            value: letter,
          };
        } else {
          const letterIndex = getSum(...lastTwo);

          lastTwo = [lastTwo[1], letterIndex];
          index = index + 1;

          return {
            done: false,
            value: { letter: "", index: letterIndex },
          };
        }
      },
    };
  }
}

class MandalaLine {
  from = [];

  constructor(from) {
    this.from = from;
  }

  [Symbol.iterator]() {
    const from = this.from;

    let index = 1;

    return {
      next() {
        if (index === from.length) {
          return { done: true };
        }

        const value = {
          letter: "",
          index: getSum(from[index - 1].index, from[index].index),
        };

        index++;

        return { done: false, value };
      },
    };
  }
}

class MandalaLines {
  source = [];

  constructor(source) {
    this.source = source;
  }

  [Symbol.iterator]() {
    let source = this.source;

    return {
      next() {
        if (source.length === 1) {
          return { done: true };
        }

        const value = [...new MandalaLine(source)];

        source = value;

        return {
          done: false,
          value,
        };
      },
    };
  }
}

function trim(input) {
  const { result = "" } = input;

  const trimmed = result.trim();

  const data = {
    ...input.data,
    trim: {
      originalSize: result.length,
      timmedSize: trimmed.length,
      originalText: result,
      trimmedText: trimmed,
    },
  };

  return trimmed.length < 2
    ? {
        ...input,
        data,
        pipelineOk: false,
        result: {
          status: CalculationStatus.Validation,
          message:
            "Слишкой короткий текст. Нужно хотя бы 2 символа для расчета.",
        },
      }
    : {
        ...input,
        data,
        pipelineOk: true,
        result: trimmed,
      };
}

function letters(input) {
  const { result } = input;

  const indexes = result.split("").reduce((result, symbol) => {
    const lowerSymbol = symbol.toLowerCase();

    if (lowerSymbol in lettersIndexMap) {
      return [
        ...result,
        { letter: lowerSymbol, index: lettersIndexMap[lowerSymbol] },
      ];
    }

    return result;
  }, []);

  const data = { ...input.data, letters: indexes.map(({ letter }) => letter) };

  return indexes.length === 0
    ? {
        ...input,
        data,
        pipelineOk: false,
        result: {
          status: CalculationStatus.Validation,
          message:
            "Некорректные символы в строке. Допускаются только буквы русского и анлийского алфавита",
        },
      }
    : {
        ...input,
        data,
        pipelineOk: true,
        result: indexes,
      };
}

function size(input) {
  const { result } = input;
  const correctedSizeResult = new MinimumCalculatableSizeLetters(result);

  return {
    ...input,
    pipelineOk: true,
    result: [...correctedSizeResult],
  };
}

function build(input) {
  const { result } = input;

  return {
    ...input,
    pipelineOk: true,
    result: [result, ...new MandalaLines(result)],
  };
}

function getFormattedLines(input) {
  const {
    result,
    data: { letters },
  } = input;

  const header = letters.join(" ");

  const lines = result.map(
    (line, index) =>
      `${" ".repeat(index)}${line.map(({ index }) => `${index}`).join(" ")}`
  );

  return [header, ...lines];
}

function formatForFile(input) {
  const {
    data: {
      trim: { originalText },
    },
  } = input;

  return [resultTitle, `«${originalText}»`, ""]
    .concat(getFormattedLines(input))
    .join("\n");
}

function formatForMandala(input) {
  const line = input.result[input.result.length - 8];
  const reversed = line.reduceRight((result, item) => [...result, item], []);
  const start = line.concat(reversed);

  return [start, ...new MandalaLines(start)];
}

function format(input) {
  const { data } = input;

  const formats = [
    [ResultFormat.Raw, property("result")],
    [ResultFormat.Mandala, formatForMandala],
    [ResultFormat.TextFile, formatForFile],
  ]
    .filter(([_, isPossible]) => isPossible)
    .reduce(
      (formats, [format, formatter]) => ({
        ...formats,
        [format]: formatter(input),
      }),
      {}
    );

  return {
    result: {
      data,
      formats,
      status: CalculationStatus.Success,
    },
  };
}

export default function calculate(text) {
  const { result } = [trim, letters, size, build, format].reduce(
    (result, processor) => {
      if (result.pipelineOk) {
        return processor(result);
      } else {
        return result;
      }
    },
    { pipelineOk: true, result: text }
  );

  return result;
}
