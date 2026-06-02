import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : config.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
    censor: "[Redacted]"
  },
  transport:
    config.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true }
        }
      : undefined
});
