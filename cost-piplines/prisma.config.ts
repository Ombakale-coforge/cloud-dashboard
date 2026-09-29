import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { defineConfig } from "prisma/config";

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: process.env.DATABASE_URL || "",
        shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
    },
});


