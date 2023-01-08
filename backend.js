import { createRxDatabase, addRxPlugin } from "rxdb";
import { RxDBUpdatePlugin } from "rxdb/plugins/update";
import { getRxStorageMemory } from "rxdb/plugins/memory";
import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import ipc from "node-ipc";
import * as rxjs from "rxjs";
import fasify from "fastify";
import fastifyIo from "fastify-socket.io";
import { ipcId, ipcMessageName } from "./constants.js";

const sec = (value = 1) => value * 1000;
const min = (value = 1) => value * sec(60);

/**
 * @readonly
 * @enum {string}
 */
const PointStatus = {
  created: "created",
  voted: "voted",
  unvotedWeak: "unvoted-weak",
  unvotedStrong: "unvoted-strong",
};

const POINT_TIMEOUTS = {
  [PointStatus.created]: min(),
  [PointStatus.voted]: min(2),
  [PointStatus.unvotedWeak]: min(5),
  [PointStatus.unvotedStrong]: min(10),
};

const CHECK_POINTS_INTERVAL = sec(10);

addRxPlugin(RxDBUpdatePlugin);
config();

function connectToIPC(ipc, to) {
  return new rxjs.Observable(function (subscriber) {
    let isSubscribed = true;

    ipc.connectTo(to, function () {
      if (isSubscribed) {
        subscriber.next(ipc);
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

function getUsernameByChatId(id, timeout = 2000) {
  return IPCClient$.pipe(
    rxjs.map((ipc) => {
      return new rxjs.Observable((subscriber) => {
        const requestId = uuid();
        const timeoutHandler = setTimeout(onTimeout, timeout);

        function onTimeout() {
          ipc.of[ipcId].off(ipcMessageName, onMessage);

          subscriber.error("request timed out");
        }

        function onMessage({ request_id, error, username }) {
          if (request_id === requestId) {
            clearTimeout(timeoutHandler);
            ipc.of[ipcId].off(ipcMessageName, onMessage);

            if (error) {
              subscriber.error(error);
            } else {
              subscriber.next(username);
              subscriber.complete();
            }
          }
        }

        ipc.of[ipcId].on(ipcMessageName, onMessage);

        ipc.of[ipcId].emit(ipcMessageName, {
          request_id: requestId,
          chat_id: id,
        });

        return () => {
          clearTimeout(timeoutHandler);
          ipc.of[ipcId].off(ipcMessageName, onMessage);
        };
      });
    }),
    rxjs.mergeAll()
  );
}

/**
 * @typedef {Object} PointVote
 * @property {number} createdAt
 * @property {string} createdby
 *
 * @typedef {Object} Point
 * @property {string} id
 * @property {PointStatus} status
 * @property {string} createdBy
 * @property {number} createdAt
 * @property {number} checkAt
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} [description]
 * @property {Array.<PointVote>} votes
 * @property {number} [votedAt]
 */

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
          type: "string",
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
                type: "string",
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
});

const apiServer = fasify();

apiServer.register(fastifyIo);

apiServer.get("/api/map/points", async function () {
  const points = await db.points.find().exec();

  return { status: "success", points: points.map((point) => point.toJSON()) };
});

const usernameRequestSchema = {
  type: "object",
  required: ["chat_id"],
  properties: {
    chat_id: { type: "number" },
  },
};

apiServer.get(
  "/api/me",
  { schema: { query: usernameRequestSchema } },
  function (request, reply) {
    getUsernameByChatId(request.query.chat_id).subscribe({
      next(username) {
        reply.code(200).send({ status: "success", username });
      },
      error() {
        reply
          .code(200)
          .send({ status: "error", message: "Failed to fetch username" });
      },
    });
  }
);

const pointCreateSchema = {
  type: "object",
  required: ["latitude", "longitude", "user"],
  properties: {
    user: { type: "string" },
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
    const checkAt = createdAt + POINT_TIMEOUTS[status];

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
    user: { type: "string" },
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

    if (point.get("createdBy") === user) {
      return reply.code(403).send({
        status: "error",
        message: "you are not allowed to vote for your point",
      });
    }

    const votes = point.get("votes").map((vote) => vote.toJSON());

    if (votes.find(({ createdBy }) => createdBy === user)) {
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
        checkAt: now + POINT_TIMEOUTS[PointStatus.voted],
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
            checkAt: now + POINT_TIMEOUTS[PointStatus.unvotedWeak],
          },
        });
      } else if (status === PointStatus.unvotedWeak) {
        return point.update({
          $set: {
            status: PointStatus.unvotedStrong,
            checkAt: now + POINT_TIMEOUTS[PointStatus.unvotedStrong],
          },
        });
      } else {
        return point.remove();
      }
    });

    await Promise.all(updates);

    await delay(CHECK_POINTS_INTERVAL);
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

async function main() {
  try {
    await apiServer.listen({ port: process.env.BACKEND_PORT });
    startPointsChecker();
    setupWebsocket();
  } catch (error) {
    console.log("failed to listen", error, process.env.BACKEND_PORT);
  }
}

main();
