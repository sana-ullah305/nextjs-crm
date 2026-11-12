import "dotenv/config";
import path from "node:path";
import type { PrismaConfig } from "prisma";

const config: PrismaConfig = {
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
};

export default config;
