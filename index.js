import { writeFile } from "fs/promises";
import { config } from "dotenv";
import ipc from "node-ipc";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import Piscina from "piscina";
import AbortController from "abort-controller";
import timeout from "p-timeout";
import {
  ipcId,
  ipcMessageName,
  CalculationStatus,
  calculationTimeout,
  ResultFormat,
} from "./constants.js";

config();

const isProduction = process.env.NODE_ENV === "production";

const serviceCommandsList = ["start", "help", "settings"];

const commands = {
  mandala: { description: "Рассчитать мандалу" },
  map: { description: "Карта района" },
  start: { description: "Приветственное слово от Димастого" },
  help: {
    description:
      "Всякие ништяки от Димастого. Например, расчет мандалы /mandala",
  },
  settings: { description: "Пока я не придумал тут никаких настроек" },
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
  filename: path.resolve(process.cwd(), "drawer.js"),
});

const bot = new TelegramBot(
  process.env.TELEGRAM_API_TOKEN,
  isProduction ? { webHook: { port: 8444 } } : { polling: true }
);

async function sendCalculationImage(chat, message, result) {
  if (
    !(
      ResultFormat.Raw in result.formats &&
      ResultFormat.Mandala in result.formats
    )
  ) {
    return;
  }

  const { signal } = new AbortController();

  try {
    const buffer = await timeout(
      drawer.run(
        {
          originalText: result.data.trim.originalText,
          mandala: result.formats[ResultFormat.Mandala],
          lines: result.formats[ResultFormat.Raw],
        },
        { signal }
      ),
      {
        signal,
        milliseconds: calculationTimeout,
      }
    );

    await bot.sendDocument(
      chat,
      Buffer.from(buffer),
      {
        caption: "Расчет на картинке",
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

  if (ResultFormat.TextFile in formats) {
    await bot.sendDocument(
      chat,
      Buffer.from(formats[ResultFormat.TextFile]),
      {
        caption: "Расчет в текстовом виде",
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

bot.onText(commandRegExps.map, async function (message) {
  const {
    message_id,
    chat: { id },
  } = message;

  await bot.sendMessage(
    id,
    "Вы сможете посмотреть карту и добавить свою точку",
    {
      reply_to_message_id: message_id,
      reply_markup: {
        keyboard: [
          [
            {
              text: "Открыть карту",
              web_app: {
                url: `https://m.deluxspa.ru/web_app?chat_id=${id}`,
              },
            },
          ],
        ],
      },
    }
  );
});

bot.onText(commandRegExps.start, async function (message) {
  const {
    from: { first_name, last_name },
    chat: { id },
  } = message;

  await bot.sendMessage(
    id,
    `Добро пожаловать, ${[first_name, last_name]
      .filter(Boolean)
      .join(
        " "
      )}.\n\nПока этот бот ничего толком не умееет, кроме как рассчитывать мандалы. Если хочешь, можешь попробовать команду /mandala.`
  );
});

bot.onText(commandRegExps.help, async function (message) {
  const {
    message_id,
    chat: { id },
  } = message;

  const commandsNames = Object.keys(commands).filter(
    (command) => !serviceCommandsList.includes(command)
  );

  const answerLines = ["Список доступных команд:"].concat(
    commandsNames.map(
      (command) => `/${command}: ${commands[command].description}`
    )
  );

  await bot.sendMessage(id, answerLines.join("\n"), {
    reply_to_message_id: message_id,
  });
});

bot.on("message", async function (message) {
  const {
    message_id,
    chat: { id },
    text,
    web_app_data,
  } = message;

  if (mandalaRequests.has(id)) {
    runCalculation(id, message_id, text);
    mandalaRequests.delete(id);
  } else if (web_app_data) {
    console.log(web_app_data);
  } else if (!commandsRegExpsList.some((command) => command.test(text))) {
    await bot.sendMessage(id, "Пожалуйста, воспользуйтесь одной из команд.", {
      reply_to_message_id: message_id,
      reply_markup: {
        keyboard: [[{ text: "/mandala" }]],
        one_time_keyboard: true,
      },
    });
  }
});

bot.on("error", (error) => {
  console.log("Bot error", error);
});

bot.on("webhook_error", (error) => {
  console.log("Webhook error", error);
});

function startIpcServer() {
  ipc.config.id = ipcId;
  ipc.config.silent = true;
  ipc.config.retry = 1500;

  ipc.serve(() =>
    ipc.server.on(
      ipcMessageName,
      async function ({ request_id, chat_id }, socket) {
        try {
          const { username } = await bot.getChat(chat_id);

          ipc.server.emit(socket, ipcMessageName, { request_id, username });
        } catch (error) {
          ipc.server.emit(socket, ipcMessageName, {
            request_id,
            error: "Failed to fetch username",
          });
        }
      }
    )
  );

  ipc.server.start();
}

async function main() {
  startIpcServer();

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
