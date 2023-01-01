import { config } from "dotenv";
import fasify from "fastify";

config();

const points = [];

const apiServer = fasify();

apiServer.get("/api/map/list", async function () {
  return { points };
});

async function main() {
  try {
    apiServer.listen({ port: process.env.BACKEND_PORT });
  } catch (error) {
    console.log("failed to listen", error, process.env.BACKEND_PORT);
  }
}

main();
