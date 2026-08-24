require("dotenv").config();

const {
    fetchUsageData,
} = require("./fetchUsageData");

const {
    normalizeUsageData,
} = require("./normalizeUsageData");

const {
    generateAlerts,
} = require("./generateAlerts");

const {
    sendAlertEmail,
} = require("./sendAlertEmail");

async function main() {
    const startedAt = Date.now();

    console.log("Starting Azure cost alert pipeline...");

    try {
        // 1. Fetch the usage-details.json file from R2.
        console.log("\nFetching Azure usage data from R2...");

        const rawUsageData =
            await fetchUsageData();

        if (!Array.isArray(rawUsageData)) {
            throw new TypeError(
                "Fetched Azure usage data is not an array."
            );
        }

        if (rawUsageData.length === 0) {
            console.log(
                "The Azure usage data file is empty. " +
                "No alerts or emails were generated."
            );

            return;
        }

        console.log(
            `Fetched ${rawUsageData.length} usage records.`
        );

        // 2. Normalize the raw Azure usage records.
        console.log("\nNormalizing usage records...");

        const normalizedRecords =
            normalizeUsageData(rawUsageData);

        if (!Array.isArray(normalizedRecords)) {
            throw new TypeError(
                "normalizeUsageData did not return an array."
            );
        }

        if (normalizedRecords.length === 0) {
            console.log(
                "No valid normalized records were found. " +
                "No alerts or emails were generated."
            );

            return;
        }

        console.log(
            `Normalized ${normalizedRecords.length} usage records.`
        );

        // 3. Generate alerts using the rolling 7-day baseline.
        console.log("\nGenerating Azure cost alerts...");

        const alertReport =
            generateAlerts(normalizedRecords);

        if (
            !alertReport ||
            !Array.isArray(alertReport.alerts)
        ) {
            throw new TypeError(
                "generateAlerts did not return a valid alert report."
            );
        }

        console.log("\nAlert generation completed.");
        console.log(
            `Evaluation date: ${alertReport.evaluationDate}`
        );
        console.log(
            `Total alerts: ${alertReport.alerts.length}`
        );

        console.log("\nAlert summary:");
        console.log(
            JSON.stringify(
                alertReport.summary,
                null,
                2
            )
        );

        // 4. Send the email or create a preview, depending
        // on the EMAIL_MODE environment variable.
        console.log("\nProcessing alert notification...");

        const emailResult =
            await sendAlertEmail(alertReport);

        if (emailResult.previewed) {
            console.log(
                "Email preview generated successfully."
            );
            console.log(
                `Preview file: ${emailResult.previewPath}`
            );
        } else if (emailResult.sent) {
            console.log(
                "Alert email sent successfully."
            );
            console.log(
                `Message ID: ${emailResult.messageId}`
            );

            if (
                Array.isArray(emailResult.accepted) &&
                emailResult.accepted.length > 0
            ) {
                console.log(
                    `Accepted recipients: ` +
                    emailResult.accepted.join(", ")
                );
            }

            if (
                Array.isArray(emailResult.rejected) &&
                emailResult.rejected.length > 0
            ) {
                console.warn(
                    `Rejected recipients: ` +
                    emailResult.rejected.join(", ")
                );
            }
        } else if (
            emailResult.reason === "NO_ALERTS"
        ) {
            console.log(
                "No alerts were generated, so no email was sent."
            );
        } else {
            console.log(
                "Email notification was not sent."
            );
        }

        const durationSeconds =
            (Date.now() - startedAt) / 1000;

        console.log(
            `\nAzure cost alert pipeline completed in ` +
            `${durationSeconds.toFixed(2)} seconds.`
        );
    } catch (error) {
        const durationSeconds =
            (Date.now() - startedAt) / 1000;

        console.error(
            `\nAzure cost alert pipeline failed after ` +
            `${durationSeconds.toFixed(2)} seconds.`
        );

        console.error({
            name: error.name,
            code: error.code,
            message: error.message,
            command: error.command,
            responseCode: error.responseCode,
            response: error.response,
        });

        process.exitCode = 1;
    }
}

main();
