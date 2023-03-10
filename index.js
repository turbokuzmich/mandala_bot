import { v4 as uuid } from "uuid";
import TimeAgo from "javascript-time-ago";
import TimeAgoRuLocale from "javascript-time-ago/locale/ru";
import { config } from "dotenv";
import ipc from "node-ipc";
import set from "lodash/set.js";
import get from "lodash/get.js";
import pick from "lodash/pick.js";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import Piscina from "piscina";
import AbortController from "abort-controller";
import timeout from "p-timeout";
import plural from "plural-ru";
import {
  ipcId,
  ipcMessageName,
  PointStatusDescription,
  CalculationStatus,
  calculationTimeout,
  ResultFormat,
  ipcResponseTimeout,
  liveLocationTimeout,
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

  async sendUser(chatId, requestId) {
    try {
      const {
        user: { id, first_name, last_name },
      } = await bot.getChatMember(chatId, chatId);

      this._respond({ requestId, user: { id, first_name, last_name } });
    } catch (error) {
      this._respond({ requestId, error: "Failed to fetch user by chat id" });
    }
  }

  async notifyListenersOfNewNearbyPoint(ids, point) {
    await Promise.all(
      ids
        .map(([id, distance]) => [liveWatches[id], distance])
        .filter(([spec]) => Boolean(spec))
        .map(([{ chat, message, latitude, longitude }, distance]) =>
          notifyListener(message, chat, latitude, longitude, [
            { point, distance },
          ])
        )
    );
  }

  getNearbyPoints(latitude, longitude, chat, messageId) {
    return this._request("getNearbyPoints", {
      id: messageId,
      latitude,
      longitude,
      chat,
    });
  }

  getPointById(id) {
    return this._request("getPointById", { id });
  }

  stopNearbyPointsNotifications(id) {
    return this._respond({
      method: "stopNearbyPointsNotifications",
      params: { id },
    });
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
          case "getUserByChatId": {
            await this.sendUser(message.chatId, message.requestId);
            break;
          }
          case "notifyNearby": {
            await this.notifyListenersOfNewNearbyPoint(
              message.ids,
              message.point
            );
            break;
          }
          case "greetUser": {
            await bot.sendMessage(
              message.id,
              `Приветствую, ${message.first_name}. Сегодня такой чудесный день!`,
              {
                reply_markup: {
                  remove_keyboard: true,
                },
              }
            );
            break;
          }
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
        reject("ApiChannel timed out", method, params);
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
  map: { description: "Карта постов ДПС" },
  start: { description: "Приветственное слово от Димастого" },
  help: {
    description:
      "Всякие ништяки от Димастого. Например, расчет мандалы /mandala",
  },
  settings: { description: "Пока я не придумал тут никаких настроек" },
  auth: { description: "Тест авторизации" },
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
        reply_markup: {
          remove_keyboard: true,
        },
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

const liveWatches = {};

function getNearbyPointsText(nearbyPoints, asNewPoints = false) {
  const appeared = plural(
    nearbyPoints.length,
    "появился",
    "появилось",
    "появилось"
  );
  const found = plural(
    nearbyPoints.length,
    "обнаружен",
    "обнаружено",
    "обнаружено"
  );
  const newbie = plural(nearbyPoints.length, "новый", "новых", "новых");
  const post = plural(nearbyPoints.length, "пост", "поста", "постов");

  return asNewPoints
    ? `Поблизости ${appeared} ${nearbyPoints.length} ${newbie} ${post} ДПС`
    : `Рядом с вами ${found} ${nearbyPoints.length} ${post} ДПС`;
}

function getNearbyPointsButtons(id, nearbyPoints, onlyPointsButtons = false) {
  const pointsButtons = [
    ...nearbyPoints.map(({ point, distance }) => [
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
  ];

  return onlyPointsButtons
    ? pointsButtons
    : [
        ...pointsButtons,
        [
          {
            text: "Показать все посты поблизости",
            callback_data: JSON.stringify({ points: "all" }),
          },
        ],
        [
          {
            text: "Открыть карту",
            web_app: {
              url: `https://m.deluxspa.ru/web_app?chat_id=${id}`,
            },
          },
        ],
      ];
}

function clearLiveLocation(id) {
  console.log("deleted live watch", id);
  delete liveWatches[id];
  apiChannel.stopNearbyPointsNotifications(id);
}

function getLiveLocationTimeoutCleaner(id) {
  return setTimeout(function () {
    clearLiveLocation(id);
  }, liveLocationTimeout);
}

async function listAllNearbyPoints(chatId) {
  const messageId = Object.keys(liveWatches).find(
    (id) => liveWatches[id].chat === chatId
  );

  if (messageId) {
    const data = liveWatches[messageId];

    await sendNearbyPoints({
      chat: { id: chatId },
      location: pick(data, "latitude", "longitude"),
    });
  }
}

async function showPointDetails(pointId, chatId, messageId) {
  const point = await apiChannel.getPointById(pointId);

  if (point === null) {
    return bot.sendMessage(
      chatId,
      "Информация о посте не найдена. Возможно, она была удалена.",
      {
        reply_markup: {
          remove_keyboard: true,
        },
      }
    );
  }

  await bot.sendLocation(chatId, point.latitude, point.longitude, {
    reply_markup: {
      remove_keyboard: true,
    },
  });

  const author = [point.createdBy.first_name, point.createdBy.last_name]
    .filter(Boolean)
    .join(" ");

  await bot.sendMessage(
    chatId,
    [
      `${author} отметил ${relativeTime.format(point.createdAt)}.`,
      point.votedAt
        ? `Подтвердили ${point.votes.length} ${plural(
            point.votes.length,
            "человек",
            "человека",
            "человек"
          )}.`
        : "Подтверждений не было.",
      point.votedAt
        ? `Последнее подтверждение ${relativeTime.format(point.votedAt)}.`
        : null,
      point.medical ? "Работает медслужба." : null,
      point.description ? "\n" : null,
      point.description ? `*От ${author}:*` : null,
      point.description ? point.description : null,
      "\n",
      "`" +
        point.latitude.toPrecision(6) +
        "," +
        point.longitude.toPrecision(6) +
        "`",
    ]
      .filter(Boolean)
      .join("\n"),
    {
      parse_mode: "Markdown",
      reply_markup: {
        remove_keyboard: true,
      },
    }
  );
}

async function notifyListener(
  messageId,
  chatId,
  latitude,
  longitude,
  allNearbyPoints = [],
  error = false
) {
  if (!liveWatches[messageId]) {
    liveWatches[messageId] = {
      chat: chatId,
      message: messageId,
      latitude,
      longitude,
    };
  }

  const lastMessageType = get(liveWatches, [messageId, "lastMessageType"]);
  const timer = get(liveWatches, [messageId, "timer"]);
  const shownPoints = get(liveWatches, [messageId, "points"], new Set());

  if (timer) {
    clearTimeout(timer);
  }

  const nearbyPoints = allNearbyPoints.filter(
    ({ point: { id } }) => !shownPoints.has(id)
  );

  if (error && lastMessageType !== "error") {
    await bot.sendMessage(
      chatId,
      "Не удалось получить информацию о ближайших постах",
      {
        reply_markup: {
          remove_keyboard: true,
        },
      }
    );

    set(liveWatches, [messageId, "lastMessageType"], "error");
  } else if (nearbyPoints.length > 0) {
    await bot.sendMessage(chatId, getNearbyPointsText(nearbyPoints, true), {
      reply_markup: {
        remove_keyboard: true,
        inline_keyboard: getNearbyPointsButtons(chatId, nearbyPoints),
      },
    });

    set(liveWatches, [messageId, "lastMessageType"], "points");
    set(
      liveWatches,
      [messageId, "points"],
      new Set([
        ...shownPoints.values(),
        ...nearbyPoints.map(({ point: { id } }) => id),
      ])
    );
  } else if (allNearbyPoints.length === 0 && lastMessageType !== "empty") {
    await bot.sendMessage(chatId, "Рядом с вами нет постов", {
      reply_markup: {
        remove_keyboard: true,
      },
    });

    set(liveWatches, [messageId, "lastMessageType"], "empty");
  }

  set(
    liveWatches,
    [messageId, "timer"],
    getLiveLocationTimeoutCleaner(messageId)
  );
}

async function updateListenerLocation({
  message_id,
  chat: { id },
  location: { latitude, longitude },
}) {
  try {
    await notifyListener(
      message_id,
      id,
      latitude,
      longitude,
      await apiChannel.getNearbyPoints(latitude, longitude, id, message_id),
      false
    );
  } catch (error) {
    await notifyListener(message_id, id, latitude, longitude, [], true);
  }
}

async function sendNearbyPoints(message) {
  const {
    chat: { id },
    location: { latitude, longitude },
  } = message;

  try {
    const nearbyPoints = await apiChannel.getNearbyPoints(
      latitude,
      longitude,
      id
    );

    if (nearbyPoints.length > 0) {
      await bot.sendMessage(id, getNearbyPointsText(nearbyPoints), {
        reply_markup: {
          remove_keyboard: true,
          inline_keyboard: getNearbyPointsButtons(id, nearbyPoints, true),
        },
      });
    } else {
      await bot.sendMessage(id, "Рядом с вами нет постов", {
        reply_markup: {
          remove_keyboard: true,
        },
      });
    }
  } catch (error) {
    await bot.sendMessage(
      id,
      "Не удалось получить информацию о ближайших постах",
      {
        reply_markup: {
          remove_keyboard: true,
        },
      }
    );
  }
}

async function handleNearbyPointsRequest(message) {
  if (message.location.live_period) {
    await updateListenerLocation(message);
  } else if (liveWatches[message.message_id]) {
    clearLiveLocation(message.message_id);
  } else {
    await sendNearbyPoints(message);
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
        reply_markup: {
          remove_keyboard: true,
        },
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
        reply_markup: {
          remove_keyboard: true,
        },
        reply_to_message_id: message_id,
      });
    } else if (status === CalculationStatus.Fail) {
      bot.sendMessage(chat, message, {
        reply_markup: {
          remove_keyboard: true,
        },
        reply_to_message_id: message_id,
      });
    } else {
      bot.sendMessage(chat, "Возникла неизвестная ошибка", {
        reply_markup: {
          remove_keyboard: true,
        },
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
        reply_markup: {
          remove_keyboard: true,
        },
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
        reply_markup: {
          remove_keyboard: true,
        },
        reply_to_message_id: message_id,
      }
    );
  }

  mandalaRequests.add(id);

  await bot.sendMessage(id, "Пожалуйста, отправьте текст для расчета", {
    reply_markup: {
      remove_keyboard: true,
    },
    reply_to_message_id: message_id,
  });
});

bot.onText(commandRegExps.map, async function (message) {
  const {
    message_id,
    from: {
      // id, first_name, last_name, username
    },
    chat: { id },
  } = message;

  await bot.sendMessage(
    id,
    "На карте можно посмотреть посты ДПС, добавить новые или подтвердить текущие. Включив оповещения вы будете уведомлены о приближении к постам.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Карта",
              web_app: {
                url: "https://m.deluxspa.ru/api/web_app",
              },
            },
          ],
        ],
        // keyboard: [
        //   [
        //     {
        //       text: "Карта",
        //       web_app: { url: `https://m.deluxspa.ru/web_app?chat_id=${id}` },
        //     },
        //     {
        //       text: "Оповещения",
        //       request_location: true,
        //     },
        //   ],
        // ],
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
      )}.\n\nПока этот бот ничего толком не умееет, кроме как рассчитывать мандалы. Если хочешь, можешь попробовать команду /mandala.`,
    {
      reply_markup: {
        remove_keyboard: true,
      },
    }
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
    reply_markup: {
      remove_keyboard: true,
    },
    reply_to_message_id: message_id,
  });
});

bot.onText(commandRegExps.auth, async function (message) {
  const {
    message_id,
    chat: { id },
  } = message;

  await bot.sendMessage(id, "Попытка авторизации", {
    reply_to_message_id: message_id,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Авторизация на сайте",
            login_url: {
              url: "https://m.deluxspa.ru/api/login",
              forward_text: "Some forward text",
              request_write_access: true,
            },
          },
        ],
      ],
    },
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
  // 177074269
  // console.log(message);

  if (mandalaRequests.has(id)) {
    runCalculation(id, message_id, text);
    mandalaRequests.delete(id);
  } else if (web_app_data) {
    console.log("web app data", web_app_data);
  } else if (location) {
    await handleNearbyPointsRequest(message);
  } else if (!commandsRegExpsList.some((command) => command.test(text))) {
    await bot.sendMessage(id, "Пожалуйста, воспользуйтесь одной из команд.", {
      reply_markup: {
        remove_keyboard: true,
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
    await handleNearbyPointsRequest(message);
  }
});

bot.on("callback_query", async (callback) => {
  const {
    message: {
      chat: { id },
      message_id,
    },
    data,
  } = callback;

  const query = JSON.parse(data);

  if (query.point) {
    await showPointDetails(query.point, id, message_id);
  } else if (query.points === "all") {
    await listAllNearbyPoints(id);
  }
});

bot.on("my_chat_member", async (member) => {});

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
