import { createRxDatabase, addRxPlugin } from "rxdb";
import { RxDBUpdatePlugin } from "rxdb/plugins/update";
import { getRxStorageMemory } from "rxdb/plugins/memory";
import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import ipc from "node-ipc";
import * as rxjs from "rxjs";
import fasify from "fastify";
import { ipcId, ipcMessageName } from "./constants.js";

const CHECK_POINT_TIMEOUT = 1 * 60 * 1000; // 1 minute
const POINT_ALIVE_TIMEOUT = 2 * 60 * 1000; // 2 minutes

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
          console.log(request_id, error, username);
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
 * @readonly
 * @enum {string}
 */
const PointStatus = {
  created: "created",
  voted: "voted",
  unvotedWeak: "unvoted-weak",
  unvotedStrong: "unvoted-strong",
};

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
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} [description]
 * @property {Array.<PointVote>} votes
 * @property {number} [votedAt]
 * @property {number} [checkedAt]
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
        latitude: {
          type: "number",
        },
        longitude: {
          type: "number",
        },
        description: {
          type: "string",
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
        checkedAt: {
          type: "integer",
        },
      },
      required: [
        "id",
        "status",
        "createdBy",
        "createdAt",
        "latitude",
        "longitude",
        "votes",
      ],
    },
  },
});

const apiServer = fasify();

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
        console.log("fetched ok");
        reply.code(200).send({ status: "success", username });
      },
      error() {
        console.log("fetch failed");
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

    const {
      latitude,
      longitude,
      user: createdBy,
      description = "",
    } = request.body;

    await db.points.upsert({
      id,
      status,
      createdBy,
      createdAt,
      latitude,
      longitude,
      description,
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
        status: PointStatus.voted,
        votedAt: now,
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
          $or: [
            {
              checkedAt: { $exists: false },
              createdAt: { $gt: now - POINT_ALIVE_TIMEOUT },
            },
            {
              checkedAt: { $gt: now - POINT_ALIVE_TIMEOUT },
            },
          ],
        },
      })
      .exec();

    const updates = pointsToCheck.map((point) => {
      const status = point.get("status");

      if ([PointStatus.created, PointStatus.voted].includes(status)) {
        return point.update({
          $set: {
            status: PointStatus.unvotedWeak,
            checkedAt: now,
          },
        });
      } else if (status === PointStatus.unvotedWeak) {
        return point.update({
          $set: {
            status: PointStatus.unvotedStrong,
            checkedAt: now,
          },
        });
      } else {
        return point.remove();
      }
    });

    await Promise.all(updates);

    await delay(CHECK_POINT_TIMEOUT);
  }
}

async function main() {
  try {
    apiServer.listen({ port: process.env.BACKEND_PORT });
    startPointsChecker();
  } catch (error) {
    console.log("failed to listen", error, process.env.BACKEND_PORT);
  }
}

main();
