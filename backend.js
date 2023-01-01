import { config } from "dotenv";
import { v4 as uuid } from "uuid";
import get from "lodash/get.js";
import property from "lodash/property.js";
import fasify from "fastify";

const CHECK_POINT_TIMEOUT = 1 * 60 * 1000; // 1 minute
const POINT_ALIVE_TIMEOUT = 2 * 60 * 1000; // 2 minutes

config();

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

const points = new Map();

const apiServer = fasify();

apiServer.get("/api/map/points", async function () {
  return { status: "success", points: [...points.values()] };
});

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

    points.set(id, {
      id,
      status,
      createdBy,
      createdAt,
      latitude,
      longitude,
      description,
      votes: [],
    });

    return { id, status: "success", points: [...points.values()] };
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

    if (!points.has(id)) {
      return reply
        .code(404)
        .send({ status: "error", message: "point not found" });
    }

    const point = points.get(id);

    if (point.createdBy === user) {
      return reply.code(403).send({
        status: "error",
        message: "you are not allowed to vote for your point",
      });
    }

    const votes = get(point, "votes", []);

    if (votes.find(({ createdBy }) => createdBy === user)) {
      return reply
        .code(403)
        .send({ status: "error", message: "you already voted for this point" });
    }

    const now = Date.now();

    votes.push({ createdAt: now, createdBy: user });

    point.votes = votes;
    point.votedAt = now;

    return { status: "success", points: [...points.values()] };
  }
);

function delay(ms = 1000) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function pointHealtchChecker() {
  while (true) {
    const now = Date.now();

    const ids = [...points.values()]
      .filter(
        (point) =>
          now - get(point, "checkedAt", point.createdAt) > POINT_ALIVE_TIMEOUT
      )
      .map(property("id"));

    ids.forEach((id) => {
      const point = points.get(id);

      if (["created", "voted"].includes(point.status)) {
        point.status = "unvoted-weak";
        point.checkedAt = now;
      } else if (point.status === "unvoted-weak") {
        point.status = "unvoted-strong";
        point.checkedAt = now;
      } else {
        points.delete(id);
      }
    });

    await delay(CHECK_POINT_TIMEOUT);
  }
}

async function main() {
  try {
    apiServer.listen({ port: process.env.BACKEND_PORT });
    pointHealtchChecker();
  } catch (error) {
    console.log("failed to listen", error, process.env.BACKEND_PORT);
  }
}

main();