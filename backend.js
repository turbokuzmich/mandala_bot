import { createRxDatabase, addRxPlugin } from "rxdb";
import { RxDBUpdatePlugin } from "rxdb/plugins/update";
import { getRxStorageMemory } from "rxdb/plugins/memory";
import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import { resolve } from "path";
import ipc from "node-ipc";
import * as rxjs from "rxjs";
import Piscina from "piscina";
import fasify from "fastify";
import fastifyIo from "fastify-socket.io";
import pick from "lodash/pick.js";
import omit from "lodash/omit.js";
import {
  checkPointsInterval,
  ipcId,
  ipcMessageName,
  ipcResponseTimeout,
  PointStatus,
  pointTimeouts,
} from "./constants.js";

const distanceCalculator = new Piscina({
  filename: resolve(process.cwd(), "distance.js"),
});

addRxPlugin(RxDBUpdatePlugin);
config();

function connectToIPC(ipc, to) {
  return new rxjs.Observable(function (subscriber) {
    let isSubscribed = true;

    ipc.connectTo(to, function () {
      if (isSubscribed) {
        subscriber.next(ipc.of[to]);
        subscriber.complete();
      }
    });

    return function () {
      isSubscribed = false;
    };
  });
}

const IPCClient$ = rxjs.of(ipc).pipe(
  rxjs.map((ipc) => {
    ipc.config.id = ipcId;
    ipc.config.silent = true;
    ipc.config.retry = 1500;

    return connectToIPC(ipc, ipcId);
  }),
  rxjs.mergeAll(),
  rxjs.shareReplay(1)
);

function getUserByChatId(id, timeout = ipcResponseTimeout) {
  return IPCClient$.pipe(
    rxjs.map((socket) => {
      return new rxjs.Observable((subscriber) => {
        const chatRequestId = uuid();
        const timeoutHandler = setTimeout(onTimeout, timeout);

        function onTimeout() {
          socket.off(ipcMessageName, onMessage);

          subscriber.error("request timed out");
        }

        function onMessage({ requestId, error, user }) {
          if (requestId === chatRequestId) {
            clearTimeout(timeoutHandler);
            socket.off(ipcMessageName, onMessage);

            if (error) {
              subscriber.error(error);
            } else {
              subscriber.next(user);
              subscriber.complete();
            }
          }
        }

        socket.on(ipcMessageName, onMessage);

        socket.emit(ipcMessageName, {
          chatId: id,
          method: "getUserByChatId",
          requestId: chatRequestId,
        });

        return () => {
          clearTimeout(timeoutHandler);
          socket.off(ipcMessageName, onMessage);
        };
      });
    }),
    rxjs.mergeAll()
  );
}

const db = await createRxDatabase({
  name: "dps",
  storage: getRxStorageMemory(),
});

await db.addCollections({
  points: {
    schema: {
      title: "Police patrol points",
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 36,
          maxLength: 36,
        },
        status: {
          type: "string",
          enum: Object.values(PointStatus),
        },
        createdBy: {
          type: "object",
          properties: {
            id: {
              type: "integer",
            },
            first_name: {
              type: "string",
            },
            last_name: {
              type: "string",
            },
          },
          required: ["id", "first_name"],
        },
        createdAt: {
          type: "integer",
        },
        checkAt: {
          type: "integer",
        },
        latitude: {
          type: "number",
        },
        longitude: {
          type: "number",
        },
        description: {
          type: "string",
        },
        medical: {
          type: "boolean",
        },
        votes: {
          type: "array",
          items: {
            type: "object",
            required: ["createdAt", "createdBy"],
            properties: {
              createdAt: {
                type: "integer",
              },
              createdBy: {
                type: "object",
                properties: {
                  id: {
                    type: "integer",
                  },
                  first_name: {
                    type: "string",
                  },
                  last_name: {
                    type: "string",
                  },
                },
                required: ["id", "first_name"],
              },
            },
          },
        },
        votedAt: {
          type: "integer",
        },
      },
      required: [
        "id",
        "status",
        "createdBy",
        "createdAt",
        "checkAt",
        "latitude",
        "longitude",
        "votes",
      ],
    },
  },
  settings: {
    schema: {
      title: "User settings",
      version: 0,
      primaryKey: "chatId",
      type: "object",
      properties: {
        chatId: {
          type: "integer",
        },
        alias: {
          type: "string",
        },
        distance: {
          type: "integer",
        },
      },
    },
  },
});

const apiServer = fasify();

apiServer.register(fastifyIo);

apiServer.get("/api/map/points", async function () {
  const points = await db.points.find().exec();

  return { status: "success", points: points.map((point) => point.toJSON()) };
});

const userRequestSchema = {
  type: "object",
  required: ["chat_id"],
  properties: {
    chat_id: { type: "number" },
  },
};

apiServer.get(
  "/api/me",
  { schema: { query: userRequestSchema } },
  function (request, reply) {
    getUserByChatId(request.query.chat_id).subscribe({
      next(user) {
        reply.code(200).send({ status: "success", user });
      },
      error() {
        reply
          .code(200)
          .send({ status: "error", message: "Failed to fetch user" });
      },
    });
  }
);

const pointCreateSchema = {
  type: "object",
  required: ["latitude", "longitude", "user"],
  properties: {
    user: {
      type: "object",
      properties: {
        id: {
          type: "integer",
        },
        first_name: {
          type: "string",
        },
        last_name: {
          type: "string",
        },
      },
      required: ["id", "first_name"],
    },
    latitude: { type: "number" },
    longitude: { type: "number" },
  },
};

apiServer.post(
  "/api/map/points",
  { schema: { body: pointCreateSchema } },
  async function (request) {
    const id = uuid();
    const status = PointStatus.created;
    const createdAt = Date.now();
    const checkAt = createdAt + pointTimeouts[status];

    const {
      latitude,
      longitude,
      user: createdBy,
      description = "",
      medical = false,
    } = request.body;

    await db.points.upsert({
      id,
      status,
      checkAt,
      createdBy,
      createdAt,
      latitude,
      longitude,
      description,
      medical,
      votes: [],
    });

    const points = await db.points.find().exec();

    return {
      id,
      status: "success",
      points: points.map((point) => point.toJSON()),
    };
  }
);

const pointVoteSchema = {
  type: "object",
  required: ["id", "user"],
  properties: {
    id: { type: "string" },
    user: {
      type: "object",
      properties: {
        id: {
          type: "integer",
        },
        first_name: {
          type: "string",
        },
        last_name: {
          type: "string",
        },
      },
      required: ["id", "first_name"],
    },
  },
};

apiServer.post(
  "/api/map/points/vote",
  { schema: { body: pointVoteSchema } },
  async function (request, reply) {
    const { id, user } = request.body;

    const point = await db.points.findOne(id).exec();

    if (point === null) {
      return reply
        .code(404)
        .send({ status: "error", message: "point not found" });
    }

    if (point.get("createdBy").id === user.id) {
      return reply.code(403).send({
        status: "error",
        message: "you are not allowed to vote for your point",
      });
    }

    const votes = point.get("votes").map((vote) => vote.toJSON());

    if (votes.find(({ createdBy }) => createdBy.id === user.id)) {
      return reply
        .code(403)
        .send({ status: "error", message: "you already voted for this point" });
    }

    const now = Date.now();

    votes.push({ createdAt: now, createdBy: user });

    await point.update({
      $set: {
        votes,
        votedAt: now,
        status: PointStatus.voted,
        checkAt: now + pointTimeouts[PointStatus.voted],
      },
    });

    const points = await db.points.find().exec();

    return { status: "success", points: points.map((point) => point.toJSON()) };
  }
);

function delay(ms = 1000) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function startPointsChecker() {
  while (true) {
    const now = Date.now();

    const pointsToCheck = await db.points
      .find({
        selector: {
          checkAt: {
            $lte: now,
          },
        },
      })
      .exec();

    const updates = pointsToCheck.map((point) => {
      const status = point.get("status");

      if ([PointStatus.created, PointStatus.voted].includes(status)) {
        return point.update({
          $set: {
            status: PointStatus.unvotedWeak,
            checkAt: now + pointTimeouts[PointStatus.unvotedWeak],
          },
        });
      } else if (status === PointStatus.unvotedWeak) {
        return point.update({
          $set: {
            status: PointStatus.unvotedStrong,
            checkAt: now + pointTimeouts[PointStatus.unvotedStrong],
          },
        });
      } else {
        return point.remove();
      }
    });

    await Promise.all(updates);

    await delay(checkPointsInterval);
  }
}

function setupWebsocket() {
  const io$ = rxjs.of(apiServer.io);

  const connection$ = io$.pipe(
    rxjs.switchMap((io) =>
      rxjs
        .fromEvent(io, "connection")
        .pipe(rxjs.map((client) => ({ io, client })))
    )
  );

  const disconnect$ = connection$.pipe(
    rxjs.mergeMap(({ client }) =>
      rxjs.fromEvent(client, "disconnect").pipe(rxjs.map(() => client))
    )
  );

  const sockets$ = rxjs
    .merge(
      connection$.pipe(rxjs.map((data) => ({ type: "connect", data }))),
      disconnect$.pipe(rxjs.map((client) => ({ type: "disconnect", client })))
    )
    .pipe(
      rxjs.scan((sockets, event) => {
        if (event.type === "connect") {
          sockets.set(event.data.client.id, event.data);
        }
        if (event.type === "disconnect") {
          sockets.delete(event.client.id);
        }

        return sockets;
      }, new Map()),
      rxjs.shareReplay(1)
    );

  sockets$.subscribe((sockets) => {
    console.log("sockets:", sockets.size);
  });

  db.points.$.pipe(
    rxjs.map((event) => sockets$.pipe(rxjs.map((sockets) => [event, sockets]))),
    rxjs.switchAll()
  ).subscribe(([event, sockets]) => {
    for (const [_, { client }] of sockets) {
      const document = Object.keys(event.documentData)
        .filter((key) => !key.startsWith("_"))
        .reduce(
          (document, key) => ({
            ...document,
            [key]: event.documentData[key],
          }),
          {}
        );

      client.emit("point", { action: event.operation.toLowerCase(), document });
    }
  });
}

function prepareToSendPoint(point) {
  return pick(point, "id", "latitude", "longitude", "status", "medical");
}

async function getNearbyPoints({ latitude, longitude, distance }) {
  return {
    data: await distanceCalculator.run({
      type: "points",
      latitude,
      longitude,
      distance,
      points: (
        await db.points.find().exec()
      ).map((point) => prepareToSendPoint(point.toJSON())),
    }),
  };
}

async function getPointById({ id }) {
  const point = await db.points.findOne(id).exec();

  return { data: point === null ? null : point.toJSON() };
}

function setupApiChannel() {
  // TODO handle disconnections and retries
  // const disconnect$ = IPCClient$.pipe(
  //   rxjs.map((ipc) => rxjs.fromEvent(ipc.of[ipcId], "disconnect")),
  //   rxjs.switchAll()
  // );

  const socketMessage$ = IPCClient$.pipe(
    rxjs.map((socket) =>
      rxjs
        .fromEvent(socket, ipcMessageName)
        .pipe(rxjs.map((message) => [socket, message]))
    ),
    rxjs.switchAll(),
    rxjs.share()
  );

  rxjs
    .merge(
      IPCClient$.pipe(rxjs.map((socket) => ({ type: "socket", socket }))),
      socketMessage$.pipe(
        rxjs.filter(
          ([_, message]) =>
            message.method === "getNearbyPoints" && message.params.id
        ),
        rxjs.map(
          ([
            socket,
            {
              params: { id, latitude, longitude, distance },
            },
          ]) => ({ type: "set", socket, id, latitude, longitude, distance })
        )
      ),
      socketMessage$.pipe(
        rxjs.filter(
          ([_, message]) => message.method === "stopNearbyPointsNotifications"
        ),
        rxjs.map(
          ([
            _,
            {
              params: { id },
            },
          ]) => ({ type: "remove", id })
        )
      ),
      db.points.insert$.pipe(
        rxjs.map(({ documentData }) => ({
          type: "document",
          document: documentData,
        }))
      )
    )
    .pipe(
      rxjs.scan(
        (state, action) => {
          if (action.type === "socket") {
            return {
              ...state,
              socket: action.socket,
              type: action.type,
            };
          }
          if (action.type === "remove") {
            return {
              ...state,
              type: action.type,
              listeners: Object.keys(state.listeners)
                .filter((id) => id !== action.id)
                .reduce(
                  (listeners, id) => ({ ...listeners, [id]: listeners[id] }),
                  state.listeners
                ),
            };
          }
          if (action.type === "set") {
            return {
              ...state,
              type: action.type,
              listeners: {
                ...state.listeners,
                [action.id]: omit(action, "type"),
              },
            };
          }
          if (action.type === "document") {
            return {
              ...state,
              document: action.document,
              type: action.type,
            };
          }

          return listeners;
        },
        { listeners: {}, type: null, document: null, socket: null }
      ),
      rxjs.filter(({ type }) => type === "document"),
      rxjs.map(({ socket, listeners, document }) =>
        rxjs
          .from(
            distanceCalculator.run({
              type: "listeners",
              latitude: document.latitude,
              longitude: document.longitude,
              listeners: Object.keys(listeners).reduce(
                (spec, id) => ({
                  ...spec,
                  [id]: {
                    latitude: listeners[id].latitude,
                    longitude: listeners[id].longitude,
                    distance: listeners[id].distance,
                  },
                }),
                {}
              ),
            })
          )
          .pipe(rxjs.map((ids) => [socket, ids, document]))
      ),
      rxjs.mergeAll()
    )
    .subscribe(([socket, ids, document]) => {
      socket.emit(ipcMessageName, {
        ids,
        method: "notifyNearby",
        point: prepareToSendPoint(document),
      });
    });

  socketMessage$
    .pipe(
      rxjs.map(([socket, message]) => {
        switch (message.method) {
          case "getNearbyPoints":
            return rxjs.from(getNearbyPoints(message.params)).pipe(
              rxjs.timeout({ first: ipcResponseTimeout }),
              rxjs.map((response) => [socket, message, response]),
              rxjs.catchError(() =>
                rxjs.of([
                  socket,
                  message,
                  { error: "Failed to get nearby points" },
                ])
              )
            );
          case "getPointById":
            return rxjs.from(getPointById(message.params)).pipe(
              rxjs.timeout({ first: ipcResponseTimeout }),
              rxjs.map((response) => [socket, message, response]),
              rxjs.catchError(() =>
                rxjs.of([socket, message, { error: "Failed to get point" }])
              )
            );
          default:
            return rxjs.EMPTY;
        }
      }),
      rxjs.mergeAll()
    )
    .subscribe(([socket, { requestId }, { error, data }]) => {
      if (error) {
        socket.emit(ipcMessageName, { requestId, error });
      } else {
        socket.emit(ipcMessageName, { requestId, data });
      }
    });
}

async function main() {
  try {
    const address = await apiServer.listen({ port: process.env.BACKEND_PORT });
    console.log("listening to", address);

    startPointsChecker();
    setupWebsocket();
    setupApiChannel();
  } catch (error) {
    console.log("failed to listen", error, process.env.BACKEND_PORT);
  }
}

main();
