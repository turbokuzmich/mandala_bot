import { config } from "dotenv";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import Piscina from "piscina";
import AbortController from "abort-controller";
import timeout from "p-timeout";
import {
  CalculationStatus,
  calculationTimeout,
  ResultFormat,
} from "./constants.js";

config();

const isProduction = process.env.NODE_ENV === "production";

const commands = {
  mandala: { description: "Рассчитать мандалу" },
};

const botCommands = Object.entries(commands).map(
  ([command, { description }]) => ({
    command: `/${command}`,
    description,
  })
);

const commandRegExps = Object.keys(commands).reduce(
  (regExps, command) => ({
    ...regExps,
    [command]: new RegExp(`^\/${command}$`),
  }),
  {}
);

const commandsRegExpsList = Object.values(commandRegExps);

const mandalaRequests = new Set();

const calculator = new Piscina({
  filename: path.resolve(process.cwd(), "calculator.js"),
});

const drawer = new Piscina({
  minThreads: 1,
  maxThreads: 1,
  concurrentTasksPerWorker: 5,
  filename: path.resolve(process.cwd(), "drawer.js"),
});

const bot = new TelegramBot(
  process.env.TELEGRAM_API_TOKEN,
  isProduction ? { webHook: true } : { polling: true }
);

async function sendCalculationImage(chat, message, result) {
  if (!(ResultFormat.Raw in result.formats)) {
    return;
  }

  const { signal } = new AbortController();

  try {
    const buffer = await timeout(
      drawer.run(result.formats[ResultFormat.Raw], { signal }),
      {
        signal,
        milliseconds: calculationTimeout,
      }
    );

    await bot.sendDocument(
      chat,
      Buffer.from(buffer),
      {
        caption: "На картиночке",
        reply_to_message_id: message,
      },
      {
        filename: `${result.data.letters.join("")}.png`,
        contentType: "image/png",
      }
    );
  } catch (error) {
    console.log("fock", error);
  }
}

async function sendCalculationResult(chat, message, result) {
  const {
    formats,
    data: { letters },
  } = result;

  /*if (ResultFormat.Messages in formats) {
    const chunks = formats[ResultFormat.Messages].map((chunk, index) => [
      chunk,
      index === 0,
    ]);

    for await (const [chunk, shouldReply] of chunks) {
      await bot.sendMessage(chat, chunk, {
        parse_mode: "HTML",
        ...(shouldReply ? { reply_to_message_id: message } : {}),
      });
    }
  }*/

  if (ResultFormat.TextFile in formats) {
    await bot.sendDocument(
      chat,
      Buffer.from(formats[ResultFormat.TextFile]),
      {
        caption: "Сохраните текстовую версию на всякий случай",
        reply_to_message_id: message,
      },
      { filename: `${letters.join("")}.txt`, contentType: "text/plain" }
    );
  }
}

function getCalculationSuccessCallback({ chat, message: message_id }) {
  return function (result) {
    const { status, message } = result;

    if (status === CalculationStatus.Success) {
      sendCalculationResult(chat, message_id, result);
      sendCalculationImage(chat, message_id, result);
    } else if (status === CalculationStatus.Validation) {
      bot.sendMessage(chat, `Текст не прошел проверку\n\n${message}`, {
        reply_to_message_id: message_id,
      });
    } else if (status === CalculationStatus.Fail) {
      bot.sendMessage(chat, message, {
        reply_to_message_id: message_id,
      });
    } else {
      bot.sendMessage(chat, "Возникла неизвестная ошибка", {
        reply_to_message_id: message_id,
      });
    }
  };
}

function getCalculationTimeoutCallback({ chat, message }) {
  return function () {
    return {
      replyTo: { chat, message },
      result: {
        status: CalculationStatus.Fail,
        message:
          "Не удалось сделать расчет в отведенное время. Пожалуйста, попробуйте позже.",
      },
    };
  };
}

function getCalculationFailCallback({ chat, message }) {
  return function (error) {
    console.log(error);
    bot.sendMessage(
      chat,
      "Возникла ошибка при расчете. Пожалуйста, повторите позже.",
      {
        reply_to_message_id: message,
      }
    );
  };
}

function runCalculation(chat, message, text) {
  const replyData = { chat, message };

  const { signal } = new AbortController();

  timeout(calculator.run(text, { signal }), {
    signal,
    milliseconds: calculationTimeout,
    fallback: getCalculationTimeoutCallback(replyData),
  }).then(
    getCalculationSuccessCallback(replyData),
    getCalculationFailCallback(replyData)
  );
}

bot.onText(commandRegExps.mandala, async function (message) {
  const {
    message_id,
    chat: { id },
  } = message;

  if (calculator.queueSize === calculator.options.maxQueue) {
    await bot.sendMessage(
      id,
      "Извините, слишком много расчетов. Пожалуйста, попробуйте позже.",
      {
        reply_to_message_id: message_id,
      }
    );
  }

  mandalaRequests.add(id);

  await bot.sendMessage(id, "Пожалуйста, отправьте текст для расчета", {
    reply_to_message_id: message_id,
  });
});

bot.on("message", async function (message) {
  const {
    message_id,
    chat: { id },
    text,
  } = message;

  if (mandalaRequests.has(id)) {
    runCalculation(id, message_id, text);
    mandalaRequests.delete(id);
  } else if (!commandsRegExpsList.some((command) => command.test(text))) {
    await bot.sendMessage(id, "Пожалуйста, воспользуйтесь одной из команд.", {
      reply_to_message_id: message_id,
    });
  }
});

bot.on("error", (error) => {
  console.log("Bot error", error);
});

bot.on("webhook_error", (error) => {
  console.log("Webhook error", error);
});

async function main() {
  await bot.setMyCommands(botCommands);

  if (isProduction) {
    if (bot.hasOpenWebHook()) {
      await bot.closeWebHook();
    }

    console.log(
      "set webhook",
      await bot.setWebHook(
        `https://m.deluxspa.ru/bot${process.env.TELEGRAM_API_TOKEN}`
      )
    );

    console.log("open webhook", await bot.openWebHook());

    console.log("webhook info", await bot.getWebHookInfo());
  }
}

main();
