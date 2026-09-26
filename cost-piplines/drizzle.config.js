/**
 * drizzle.config.js
 * -------------------------------------------------------
 * Used only by the drizzle-kit CLI (generate / migrate / studio),
 * not by the running application. Adjust `schema` below to wherever
 * you actually place schema.js in your repo (e.g. "./src/db/schema.js").
 */

require("dotenv").config();
const { defineConfig } = require("drizzle-kit");

if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env");
    process.exit(1);
}

module.exports = defineConfig({
    out: "./drizzle",
    schema: "./src/db/schema.js",
    dialect: "mssql",
    dbCredentials: {
        url: process.env.DATABASE_URL,
    },
});
