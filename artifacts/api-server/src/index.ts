import app from "./app";
import { logger } from "./lib/logger";
import { startExpiryCleanup } from "./lib/expiry";
import { assertDatabaseReady } from "./lib/database-readiness";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // Do not advertise a healthy server that cannot persist rooms/submissions.
  await assertDatabaseReady();
  logger.info("Database schema ready");
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startExpiryCleanup();
  });
}

void start().catch(err => {
  logger.fatal({ err }, "API startup failed; database readiness must be restored before retrying");
  process.exit(1);
});
