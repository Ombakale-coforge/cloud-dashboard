require("dotenv").config();
const {
    S3Client,
    GetObjectCommand,
} = require("@aws-sdk/client-s3");

const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_AZURE_DATA_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_AZURE_DATA_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_AZURE_DATA_SECRET_ACCESS_KEY,
    },
});

async function streamToString(stream) {
    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString("utf-8");
}

async function fetchUsageData() {
    const bucket = "azure-data";
    const key = "usage-data/usage-details.json";

    const response = await r2.send(
        new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        })
    );

    const jsonString = await streamToString(response.Body);

    return JSON.parse(jsonString);
}

module.exports = {
    fetchUsageData,
};
