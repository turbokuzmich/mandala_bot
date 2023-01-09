import { writeFile } from "fs/promises";
import { v4 as uuid } from "uuid";
import TimeAgo from "javascript-time-ago";
import TimeAgoRuLocale from "javascript-time-ago/locale/ru";
import { config } from "dotenv";
import ipc from "node-ipc";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import Piscina from "piscina";
import AbortController from "abort-controller";
import timeout from "p-timeout";
import plural from "plural-ru";
import {
  ipcId,
  watchDistance,
  ipcMessageName,
  PointStatusDescription,
  CalculationStatus,
  calculationTimeout,
  ResultFormat,
  ipcResponseTimeout,
} from "./constants.js";

config();

TimeAgo.addDefaultLocale(TimeAgoRuLocale);

const relativeTime = new TimeAgo();

class ApiChannel {
  _socket = null;

  ipc = null;
  ipcId = null;
  messageId = null;

  constructor(ipc, ipcId, messageId) {
    this.ipc = ipc;
    this.ipcId = ipcId;
    this.messageId = messageId;
  }

  async sendChat(chatId, requestId) {
    try {
      this._respond({ requestId, chat: await bot.getChat(chatId) });
    } catch (error) {
      this._respond({ requestId, error: "Failed to fetch chat" });
    }
  }

  getNearbyPoints(latitude, longitude, distance) {
    return this._request("getNearbyPoints", { latitude, longitude, distance });
  }

  getPointById(id) {
    return this._request("getPointById", { id });
  }

  listen() {
    this.ipc.config.id = this.ipcId;
    this.ipc.config.silent = true;
    this.ipc.config.retry = 1500;

    this.ipc.serve(() => {
      this.ipc.server.on("connect", (socket) => {
        console.log("api socket connected");
        this._socket = socket;
      });
      this.ipc.server.on("socket.disconnected", () => {
        console.log("api socket disconnected");
        this._socket = null;
      });
      this.ipc.server.on(this.messageId, async (message) => {
        switch (message.method) {
          case "getChatById":
            await this.sendChat(message.chatId, message.requestId);
        }
      });
    });

    this.ipc.server.start();
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const { ipc, messageId } = this;
      const timer = setTimeout(onTimeout, ipcResponseTimeout);
      const requestId = uuid();

      function cleanUp() {
        clearTimeout(timer);
        ipc.server.off(messageId, onMessage);
      }

      function onTimeout() {
        cleanUp();
        reject("ApiChannel timed out");
      }

      function onMessage(message) {
        if (message.requestId === requestId) {
          cleanUp();

          if (message.error) {
            reject(message.error);
          } else {
            resolve(message.data);
          }
        }
      }

      this.ipc.server.on(this.messageId, onMessage);

      if (!this._respond({ method, params, requestId })) {
        Promise.resolve().then(() => {
          cleanUp();
          reject("No ApiChannel connection");
        });
      }
    });
  }

  _respond(data) {
    if (this._socket) {
      this.ipc.server.emit(this._socket, ipcMessageName, data);

      return true;
    }

    return false;
  }
}

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

const apiChannel = new ApiChannel(ipc, ipcId, ipcMessageName);

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

async function sendClosestPointIfNeeded(message) {
  const {
    message_id,
    chat: { id },
    location: { latitude, longitude },
  } = message;

  try {
    const info = await apiChannel.getNearbyPoints(
      latitude,
      longitude,
      // FIXME это убрать в настройки
      watchDistance
    );

    if (info.length > 0) {
      await bot.sendMessage(
        id,
        `Рядок с вами найдено ${info.length} ${plural(
          info.length,
          "точка",
          "точки",
          "точек"
        )}`,
        {
          reply_to_message_id: message_id,
          reply_markup: {
            inline_keyboard: [
              ...info.map(({ point, distance }) => [
                {
                  text: `${Math.floor(distance)} ${plural(
                    Math.floor(distance),
                    "метр",
                    "метра",
                    "метров"
                  )}. ${PointStatusDescription[point.status]}. ${
                    point.medical ? "Медслужба" : ""
                  }`,
                  callback_data: JSON.stringify({ point: point.id }),
                },
              ]),
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
    } else {
      await bot.sendMessage(id, "Рядом с вами нет постов", {
        reply_to_message_id: message_id,
      });
    }
  } catch (error) {
    console.log(error);
    await bot.sendMessage(
      id,
      "Не удалось получить информацию о ближайших постах",
      {
        reply_to_message_id: message_id,
      }
    );
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
        one_time_keyboard: true,
        keyboard: [
          [
            {
              text: "Открыть карту",
              web_app: { url: `https://m.deluxspa.ru/web_app?chat_id=${id}` },
            },
            {
              text: "Включить оповещение",
              request_location: true,
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
    location,
  } = message;
  // console.log(message);

  if (mandalaRequests.has(id)) {
    runCalculation(id, message_id, text);
    mandalaRequests.delete(id);
  } else if (web_app_data) {
    console.log(web_app_data);
  } else if (location) {
    await sendClosestPointIfNeeded(message);
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

bot.on("edited_message", async (message) => {
  if (message.location) {
    await sendClosestPointIfNeeded(message);
  }
});

bot.on(
  "callback_query",
  async ({
    message: {
      chat: { id },
      message_id,
    },
    data,
  }) => {
    try {
      const point = await apiChannel.getPointById(JSON.parse(data).point);

      if (point === null) {
        return bot.sendMessage(
          id,
          "Точка не найдена. Возможно, она была удалена.",
          {
            reply_to_message_id: message_id,
          }
        );
      }

      await bot.sendLocation(id, point.latitude, point.longitude, {
        reply_to_message_id: message_id,
      });

      await bot.sendMessage(
        id,
        [
          ["Координаты", `${point.latitude}, ${point.longitude}`],
          ["Статус", PointStatusDescription[point.status]],
          [
            "Медицинская служба",
            point.medical ? "Присутствует" : "Отсутствует",
          ],
          ["Количество подтверждений", `${point.votes.length}`],
          [
            "Последнее подтверждение",
            point.votedAt ? relativeTime.format(point.votedAt) : null,
          ],
          ["Описание", point.description],
          ["Создана", relativeTime.format(point.createdAt)],
          ["Автор", point.createdBy],
        ]
          .filter(([_, text]) => Boolean(text))
          .map(([header, text]) => `*${header}*\n${text}`)
          .join("\n\n"),
        {
          parse_mode: "Markdown",
          reply_to_message_id: message_id,
        }
      );
    } catch (error) {}
  }
);

async function main() {
  apiChannel.listen();

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
