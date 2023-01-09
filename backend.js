import { createRxDatabase, addRxPlugin } from "rxdb";
import { RxDBUpdatePlugin } from "rxdb/plugins/update";
import { getRxStorageMemory } from "rxdb/plugins/memory";
import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import ipc from "node-ipc";
import * as rxjs from "rxjs";
import fasify from "fastify";
import fastifyIo from "fastify-socket.io";
import {
  ipcId,
  ipcMessageName,
  ipcResponseTimeout,
  PointStatus,
} from "./constants.js";

const sec = (value = 1) => value * 1000;
const min = (value = 1) => value * sec(60);

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

function getUsernameByChatId(id, timeout = ipcResponseTimeout) {
  return IPCClient$.pipe(
    rxjs.map((socket) => {
      return new rxjs.Observable((subscriber) => {
        const chatRequestId = uuid();
        const timeoutHandler = setTimeout(onTimeout, timeout);

        function onTimeout() {
          socket.off(ipcMessageName, onMessage);

          subscriber.error("request timed out");
        }

        function onMessage({ requestId, error, chat: { username } }) {
          if (requestId === chatRequestId) {
            clearTimeout(timeoutHandler);
            socket.off(ipcMessageName, onMessage);

            if (error) {
              subscriber.error(error);
            } else {
              subscriber.next(username);
              subscriber.complete();
            }
          }
        }

        socket.on(ipcMessageName, onMessage);

        socket.emit(ipcMessageName, {
          chatId: id,
          method: "getChatById",
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

function getDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == lat2 && lon1 == lon2) {
    return 0;
  } else {
    const radlat1 = (Math.PI * lat1) / 180;
    const radlat2 = (Math.PI * lat2) / 180;
    const theta = lon1 - lon2;
    const radtheta = (Math.PI * theta) / 180;

    let dist =
      Math.sin(radlat1) * Math.sin(radlat2) +
      Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);

    if (dist > 1) {
      dist = 1;
    }

    dist = Math.acos(dist);
    dist = (dist * 180) / Math.PI;
    dist = dist * 60 * 1.1515;

    return dist * 1.609344 * 1000;
  }
}

async function getNearbyPoints({ latitude, longitude, distance }) {
  // FIXME worker thread
  const points = await db.points.find().exec();

  return {
    data: points
      .reduce((points, point) => {
        const distanceToPoint = getDistance(
          latitude,
          longitude,
          point.get("latitude"),
          point.get("longitude")
        );

        return distanceToPoint > distance
          ? points
          : [...points, { point: point.toJSON(), distance: distanceToPoint }];
      }, [])
      .sort((pointA, pointB) => pointA.distance - pointB.distance),
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

  IPCClient$.pipe(
    rxjs.map((socket) =>
      rxjs
        .fromEvent(socket, ipcMessageName)
        .pipe(rxjs.map((message) => [socket, message]))
    ),
    rxjs.switchAll(),
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
  ).subscribe(([socket, { requestId }, { error, data }]) => {
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
