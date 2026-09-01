import "dotenv/config";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
} from "@aws-sdk/client-s3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------
// Local AWS report paths
// ---------------------------------------------------------------------

const baseAwsReports = path.resolve(
    __dirname,
    "../../AWSReports"
);

const srcDir = path.resolve(
    baseAwsReports,
    "latest"
);

const accountsDir = path.resolve(
    baseAwsReports,
    "accounts"
);

const destDir = path.resolve(
    __dirname,
    "../public/data"
);

// ---------------------------------------------------------------------
// Azure destination path
// ---------------------------------------------------------------------

const azureDestDir = path.resolve(
    __dirname,
    "../public/data/azure"
);

// ---------------------------------------------------------------------
// R2 configuration
// ---------------------------------------------------------------------

const {
    R2_AZURE_DATA_ACCOUNT_ID,
    R2_AZURE_DATA_ACCESS_KEY_ID,
    R2_AZURE_DATA_BUCKET_NAME,
    R2_AZURE_DATA_SECRET_ACCESS_KEY,
} = process.env;

const requiredR2EnvironmentVariables = {
    R2_AZURE_DATA_ACCOUNT_ID,
    R2_AZURE_DATA_ACCESS_KEY_ID,
    R2_AZURE_DATA_BUCKET_NAME,
    R2_AZURE_DATA_SECRET_ACCESS_KEY,
};

const missingR2EnvironmentVariables = Object.entries(
    requiredR2EnvironmentVariables
)
    .filter(([, value]) => !value)
    .map(([name]) => name);

if (missingR2EnvironmentVariables.length > 0) {
    console.error(
        "Missing required R2 environment variables: " +
        missingR2EnvironmentVariables.join(", ")
    );

    process.exit(1);
}

function normalizePrefix(value, fallback) {
    const prefix = String(value || fallback)
        .trim()
        .replace(/^\/+/, "");

    return prefix.endsWith("/")
        ? prefix
        : `${prefix}/`;
}

const AZURE_REPORT_PREFIX = normalizePrefix(
    process.env.R2_AZURE_REPORT_PREFIX,
    "usage-data-reports/latest/"
);

const r2Client = new S3Client({
    region: "auto",

    endpoint:
        `https://${R2_AZURE_DATA_ACCOUNT_ID}` +
        ".r2.cloudflarestorage.com",

    credentials: {
        accessKeyId:
            R2_AZURE_DATA_ACCESS_KEY_ID,

        secretAccessKey:
            R2_AZURE_DATA_SECRET_ACCESS_KEY,
    },
});

// ---------------------------------------------------------------------
// Local filesystem helpers
// ---------------------------------------------------------------------

function recreateDirectory(directory) {
    if (fs.existsSync(directory)) {
        fs.rmSync(directory, {
            recursive: true,
            force: true,
        });
    }

    fs.mkdirSync(directory, {
        recursive: true,
    });
}

function ensureDirectory(directory) {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, {
            recursive: true,
        });
    }
}

// ---------------------------------------------------------------------
// AWS local report sync
// ---------------------------------------------------------------------

function syncAwsLatestReports() {
    let count = 0;

    if (!fs.existsSync(srcDir)) {
        console.warn(
            `AWS latest report folder not found: ${srcDir}`
        );

        return count;
    }

    const files = fs.readdirSync(srcDir);

    for (const file of files) {
        const sourcePath = path.join(
            srcDir,
            file
        );

        if (!fs.statSync(sourcePath).isFile()) {
            continue;
        }

        if (
            !file.toLowerCase().endsWith(".csv") &&
            !file.toLowerCase().endsWith(".json")
        ) {
            continue;
        }

        const destinationPath = path.join(
            destDir,
            file
        );

        fs.copyFileSync(
            sourcePath,
            destinationPath
        );

        count += 1;

        console.log(
            `Copied AWS report: ${file}`
        );
    }

    return count;
}

function syncAwsAccountReports() {
    let count = 0;

    if (!fs.existsSync(accountsDir)) {
        console.warn(
            `AWS accounts folder not found: ${accountsDir}`
        );

        return count;
    }

    const accountsDestDir = path.join(
        destDir,
        "accounts"
    );

    recreateDirectory(accountsDestDir);

    const accountsJsonPath = path.join(
        accountsDir,
        "accounts.json"
    );

    if (fs.existsSync(accountsJsonPath)) {
        fs.copyFileSync(
            accountsJsonPath,
            path.join(
                destDir,
                "accounts.json"
            )
        );

        count += 1;

        console.log(
            "Copied AWS accounts.json"
        );
    }

    const accountFolders = fs.readdirSync(
        accountsDir,
        {
            withFileTypes: true,
        }
    );

    for (const accountEntry of accountFolders) {
        if (!accountEntry.isDirectory()) {
            continue;
        }

        const accountLatestDir = path.join(
            accountsDir,
            accountEntry.name,
            "latest"
        );

        if (!fs.existsSync(accountLatestDir)) {
            continue;
        }

        if (
            !fs.statSync(

                accountLatestDir
            ).isDirectory()
        ) {
            continue;
        }

        const targetDir = path.join(
            accountsDestDir,
            accountEntry.name
        );

        fs.mkdirSync(targetDir, {
            recursive: true,
        });

        const accountFiles = fs.readdirSync(
            accountLatestDir
        );

        for (const file of accountFiles) {
            const sourcePath = path.join(
                accountLatestDir,
                file
            );

            if (
                !fs.statSync(sourcePath).isFile()
            ) {
                continue;
            }

            if (
                !file.toLowerCase().endsWith(".csv") &&
                !file.toLowerCase().endsWith(".json")
            ) {
                continue;
            }

            fs.copyFileSync(
                sourcePath,
                path.join(
                    targetDir,
                    file
                )
            );

            count += 1;

            console.log(
                `Copied AWS account report: ` +
                `${accountEntry.name}/${file}`
            );
        }
    }

    return count;
}

// ---------------------------------------------------------------------
// R2 Azure report helpers
// ---------------------------------------------------------------------

function shouldDownloadAzureReport(key) {
    if (!key) {
        return false;
    }

    const relativeKey = key.slice(
        AZURE_REPORT_PREFIX.length
    );

    if (!relativeKey) {
        return false;
    }

    /*
     * Only download files directly inside the latest prefix.
     * This prevents unexpected nested folders from being written locally.
     */
    if (relativeKey.includes("/")) {
        return false;
    }

    return (
        relativeKey.toLowerCase().endsWith(".csv") ||
        relativeKey === "report_manifest.json" ||
        relativeKey === "run_log.txt"
    );
}

async function listAzureReportObjects() {
    const objects = [];

    let continuationToken;

    do {
        const response = await r2Client.send(
            new ListObjectsV2Command({
                Bucket:
                    R2_AZURE_DATA_BUCKET_NAME,

                Prefix:
                    AZURE_REPORT_PREFIX,

                ContinuationToken:
                    continuationToken,
            })
        );

        for (
            const object of response.Contents || []
        ) {
            if (
                shouldDownloadAzureReport(
                    object.Key
                )
            ) {
                objects.push({
                    key: object.Key,
                    size: object.Size || 0,
                    lastModified:
                        object.LastModified || null,
                });
            }
        }

        continuationToken =
            response.IsTruncated
                ? response.NextContinuationToken
                : undefined;
    } while (continuationToken);

    objects.sort((first, second) =>
        first.key.localeCompare(second.key)
    );

    return objects;
}

async function downloadR2ObjectToFile(
    objectKey,
    destinationPath
) {
    const response = await r2Client.send(
        new GetObjectCommand({
            Bucket:
                R2_AZURE_DATA_BUCKET_NAME,

            Key:
                objectKey,
        })
    );

    if (!response.Body) {
        throw new Error(
            `R2 returned an empty body for ${objectKey}`
        );
    }

    /*
     * transformToByteArray avoids converting CSV content to and from
     * strings and preserves the exact bytes stored in R2.
     */
    const byteArray =
        await response.Body.transformToByteArray();

    fs.writeFileSync(
        destinationPath,
        Buffer.from(byteArray)
    );
}

async function syncAzureReportsFromR2() {
    console.log(
        `Listing Azure reports from R2 prefix: ` +
        `${AZURE_REPORT_PREFIX}`
    );

    const reportObjects =
        await listAzureReportObjects();

    if (reportObjects.length === 0) {
        throw new Error(
            `No Azure report files found in R2 under ` +
            `${AZURE_REPORT_PREFIX}`
        );
    }

    /*
     * Only clear the existing Azure folder after confirming that R2
     * actually contains report files. This avoids deleting working local
     * reports when the bucket or prefix is accidentally misconfigured.
     */
    recreateDirectory(azureDestDir);

    let count = 0;

    for (const object of reportObjects) {
        const filename = object.key.slice(
            AZURE_REPORT_PREFIX.length
        );

        const destinationPath = path.join(
            azureDestDir,
            filename
        );

        await downloadR2ObjectToFile(
            object.key,
            destinationPath
        );

        count += 1;

        console.log(
            `Downloaded Azure report: ` +
            `${object.key} -> ${destinationPath}`
        );
    }

    return count;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
    console.log(
        `Syncing local AWS reports from ${srcDir} ` +
        `to ${destDir}...`
    );

    console.log(
        `Syncing Azure reports from R2://${R2_AZURE_DATA_BUCKET_NAME}/` +
        `${AZURE_REPORT_PREFIX} to ${azureDestDir}...`
    );

    ensureDirectory(destDir);

    let awsLatestCount = 0;
    let awsAccountCount = 0;
    let azureCount = 0;

    awsLatestCount =
        syncAwsLatestReports();

    awsAccountCount =
        syncAwsAccountReports();

    azureCount =
        await syncAzureReportsFromR2();

    const totalCount =
        awsLatestCount +
        awsAccountCount +
        azureCount;

    console.log("");
    console.log("Data sync completed successfully.");
    console.log(
        `AWS latest files: ${awsLatestCount}`
    );
    console.log(
        `AWS account files: ${awsAccountCount}`
    );
    console.log(
        `Azure R2 files: ${azureCount}`
    );
    console.log(
        `Total synced files: ${totalCount}`
    );
}

main().catch((error) => {
    console.error(
        "Failed to sync data:",
        error
    );

    process.exit(1);
});
