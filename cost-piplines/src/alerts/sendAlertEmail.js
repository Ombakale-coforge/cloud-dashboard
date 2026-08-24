const nodemailer = require("nodemailer");

function validateEmailConfiguration() {
    const requiredVariables = [
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "ALERT_EMAIL_FROM",
        "ALERT_EMAIL_TO",
    ];

    const missingVariables =
        requiredVariables.filter(
            (variableName) =>
                !process.env[variableName]
        );

    if (missingVariables.length > 0) {
        throw new Error(
            `Missing email environment variables: ` +
            missingVariables.join(", ")
        );
    }
}

function createTransporter() {
    validateEmailConfiguration();

    const port = Number(
        process.env.SMTP_PORT
    );

    if (!Number.isInteger(port)) {
        throw new Error(
            "SMTP_PORT must be a valid integer."
        );
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure:
            String(
                process.env.SMTP_SECURE
            ).toLowerCase() === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
    });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatCurrency(
    value,
    currency = "INR"
) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return "N/A";
    }

    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
    }).format(numericValue);
}

function formatNumber(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return "N/A";
    }

    return new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 2,
    }).format(numericValue);
}

function formatPercent(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return "N/A";
    }

    return `${numericValue.toFixed(2)}%`;
}

function formatAlertType(alertType) {
    return String(alertType || "UNKNOWN_ALERT")
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/\b\w/g, (character) =>
            character.toUpperCase()
        );
}

function getAlertTitle(alert) {
    switch (alert.alertType) {
        case "SUBSCRIPTION_COST_SPIKE":
            return (
                alert.subscriptionName ||
                alert.subscriptionId ||
                "Subscription"
            );

        case "SERVICE_COST_SPIKE":
            return (
                alert.service ||
                "Azure service"
            );

        case "RESOURCE_COST_SPIKE":
        case "NEW_EXPENSIVE_RESOURCE":
            return (
                alert.resourceName ||
                alert.resourceId ||
                "Azure resource"
            );

        case "QUANTITY_SPIKE":
            return [
                alert.resourceName,
                alert.meterName,
            ]
                .filter(Boolean)
                .join(" | ");

        default:
            return "Azure cost alert";
    }
}

function getSeverityColor(severity) {
    switch (severity) {
        case "CRITICAL":
            return "#b91c1c";

        case "HIGH":
            return "#dc2626";

        case "WARNING":
            return "#d97706";

        case "INFO":
        default:
            return "#2563eb";
    }
}

function createCostAlertDetails(alert) {
    const currency =
        alert.billingCurrency || "INR";

    return `
        <tr>
            <td style="padding: 6px 12px 6px 0; color: #64748b;">
                Current cost
            </td>
            <td style="padding: 6px 0; font-weight: 600;">
                ${escapeHtml(
        formatCurrency(
            alert.currentCost,
            currency
        )
    )}
            </td>
        </tr>

        ${Number.isFinite(
        Number(alert.baselineCost)
    )
            ? `
                    <tr>
                        <td style="padding: 6px 12px 6px 0; color: #64748b;">
                            7-day baseline
                        </td>
                        <td style="padding: 6px 0;">
                            ${escapeHtml(
                formatCurrency(
                    alert.baselineCost,
                    currency
                )
            )}
                        </td>
                    </tr>
                `
            : ""
        }

        ${Number.isFinite(
            Number(alert.absoluteIncrease)
        )
            ? `
                    <tr>
                        <td style="padding: 6px 12px 6px 0; color: #64748b;">
                            Absolute increase
                        </td>
                        <td style="padding: 6px 0;">
                            ${escapeHtml(
                formatCurrency(
                    alert.absoluteIncrease,
                    currency
                )
            )}
                        </td>
                    </tr>
                `
            : ""
        }

        ${Number.isFinite(
            Number(alert.percentIncrease)
        )
            ? `
                    <tr>
                        <td style="padding: 6px 12px 6px 0; color: #64748b;">
                            Percentage increase
                        </td>
                        <td style="padding: 6px 0;">
                            ${escapeHtml(
                formatPercent(
                    alert.percentIncrease
                )
            )}
                        </td>
                    </tr>
                `
            : ""
        }
    `;
}

function createQuantityAlertDetails(alert) {
    return `
        <tr>
            <td style="padding: 6px 12px 6px 0; color: #64748b;">
                Meter
            </td>
            <td style="padding: 6px 0;">
                ${escapeHtml(
        alert.meterName ||
        alert.meterId ||
        "Unknown meter"
    )}
            </td>
        </tr>

        <tr>
            <td style="padding: 6px 12px 6px 0; color: #64748b;">
                Current quantity
            </td>
            <td style="padding: 6px 0; font-weight: 600;">
                ${escapeHtml(
        formatNumber(
            alert.currentQuantity
        )
    )}
                ${escapeHtml(
        alert.unitOfMeasure || ""
    )}
            </td>
        </tr>

        <tr>
            <td style="padding: 6px 12px 6px 0; color: #64748b;">
                7-day baseline
            </td>
            <td style="padding: 6px 0;">
                ${escapeHtml(
        formatNumber(
            alert.baselineQuantity
        )
    )}
                ${escapeHtml(
        alert.unitOfMeasure || ""
    )}
            </td>
        </tr>

        <tr>
            <td style="padding: 6px 12px 6px 0; color: #64748b;">
                Percentage increase
            </td>
            <td style="padding: 6px 0;">
                ${escapeHtml(
        formatPercent(
            alert.percentIncrease
        )
    )}

            </td>
        </tr>
    `;
}

function createCommonAlertDetails(alert) {
    return `
        ${alert.subscriptionName
            ? `
                    <tr>
                        <td style="padding: 6px 12px 6px 0; color: #64748b;">
                            Subscription
                        </td>
                        <td style="padding: 6px 0;">
                            ${escapeHtml(
                alert.subscriptionName
            )}
                        </td>
                    </tr>
                `
            : ""
        }

        ${alert.resourceGroup
            ? `
                    <tr>
                        <td style="padding: 6px 12px 6px 0; color: #64748b;">
                            Resource group
                        </td>
                        <td style="padding: 6px 0;">
                            ${escapeHtml(
                alert.resourceGroup
            )}
                        </td>
                    </tr>
                `
            : ""
        }

        ${alert.service
            ? `
                    <tr>
                        <td style="padding: 6px 12px 6px 0; color: #64748b;">
                            Service
                        </td>
                        <td style="padding: 6px 0;">
                            ${escapeHtml(
                alert.service
            )}
                        </td>
                    </tr>
                `
            : ""
        }
    `;
}

function createAlertCard(alert) {
    const severityColor =
        getSeverityColor(alert.severity);

    let measurementDetails;

    if (
        alert.alertType ===
        "QUANTITY_SPIKE"
    ) {
        measurementDetails =
            createQuantityAlertDetails(alert);
    } else {
        measurementDetails =
            createCostAlertDetails(alert);
    }

    return `
        <div
            style="
                border: 1px solid #e2e8f0;
                border-left: 5px solid ${severityColor};
                border-radius: 8px;
                margin-bottom: 16px;
                padding: 18px;
                background-color: #ffffff;
            "
        >
            <div style="margin-bottom: 12px;">
                <span
                    style="
                        display: inline-block;
                        padding: 4px 8px;
                        border-radius: 999px;
                        background-color: ${severityColor};
                        color: #ffffff;
                        font-size: 12px;
                        font-weight: 700;
                    "
                >
                    ${escapeHtml(
        alert.severity || "INFO"
    )}
                </span>

                <span
                    style="
                        margin-left: 8px;
                        color: #64748b;
                        font-size: 13px;
                    "
                >
                    ${escapeHtml(
        formatAlertType(
            alert.alertType
        )
    )}
                </span>
            </div>

            <h3
                style="
                    margin: 0 0 12px;
                    color: #0f172a;
                    font-size: 17px;
                "
            >
                ${escapeHtml(
        getAlertTitle(alert)
    )}
            </h3>

            <table
                role="presentation"
                cellpadding="0"
                cellspacing="0"
                style="
                    width: 100%;
                    border-collapse: collapse;
                    color: #334155;
                    font-size: 14px;
                "
            >
                ${createCommonAlertDetails(alert)}
                ${measurementDetails}
            </table>
        </div>
    `;
}

function createSummaryCards(summary) {
    const items = [
        {
            label: "Subscription",
            value:
                summary.subscriptionCostSpikes ||
                0,
        },
        {
            label: "Service",
            value:
                summary.serviceCostSpikes || 0,
        },
        {
            label: "Resource",
            value:
                summary.resourceCostSpikes ||
                0,
        },
        {
            label: "New resources",
            value:
                summary.newExpensiveResources ||
                0,
        },
        {
            label: "Usage quantity",
            value:
                summary.quantitySpikes || 0,
        },
    ];

    return `
        <table
            role="presentation"
            cellpadding="0"
            cellspacing="0"
            style="
                width: 100%;
                border-collapse: separate;
                border-spacing: 6px;
                margin: 0 -6px 20px;
            "
        >
            <tr>
                ${items
            .map(
                (item) => `
                            <td
                                style="
                                    padding: 12px 8px;
                                    border-radius: 8px;
                                    background-color: #f1f5f9;
                                    text-align: center;
                                "
                            >
                                <div
                                    style="
                                        color: #0f172a;
                                        font-size: 20px;
                                        font-weight: 700;
                                    "
                                >
                                    ${escapeHtml(
                    item.value
                )}
                                </div>

                                <div
                                    style="
                                        margin-top: 3px;
                                        color: #64748b;
                                        font-size: 11px;
                                    "
                                >
                                    ${escapeHtml(
                    item.label
                )}
                                </div>
                            </td>
                        `
            )
            .join("")}
            </tr>
        </table>
    `;
}

function createEmailHtml(alertReport) {
    const {
        evaluationDate,
        baselineDates = [],
        summary = {},
        alerts = [],
    } = alertReport;

    return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0"
                />
                <title>Azure Cost Alerts</title>
            </head>

            <body
                style="
                    margin: 0;
                    padding: 0;
                    background-color: #f8fafc;
                    font-family: Arial, Helvetica, sans-serif;
                "
            >
                <div
                    style="
                        max-width: 760px;
                        margin: 0 auto;
                        padding: 24px 12px;
                    "
                >
                    <div
                        style="
                            border-radius: 10px;
                            padding: 24px;
                            background-color: #0f172a;
                            color: #ffffff;
                        "
                    >
                        <h1
                            style="
                                margin: 0 0 8px;
                                font-size: 24px;
                            "
                        >
                            Azure Cost Alert Report
                        </h1>

                        <p
                            style="
                                margin: 0;
                                color: #cbd5e1;
                                font-size: 14px;
                            "
                        >
                            Evaluation date:
                            ${escapeHtml(
        evaluationDate
    )}
                        </p>
                    </div>

                    <div
                        style="
                            padding: 22px;
                            border: 1px solid #e2e8f0;
                            background-color: #ffffff;
                        "
                    >
                        <p
                            style="
                                margin-top: 0;
                                color: #334155;
                                line-height: 1.5;
                            "
                        >
                            The alert engine detected
                            <strong>
                                ${escapeHtml(
        summary.total ??
        alerts.length
    )}
                            </strong>
                            Azure usage anomalies using a
                            rolling seven-day baseline.
                        </p>

                        ${createSummaryCards(summary)}

                        <p
                            style="
                                margin: 0 0 20px;
                                color: #64748b;
                                font-size: 12px;
                                line-height: 1.5;
                            "
                        >
                            Baseline dates:
                            ${escapeHtml(
        baselineDates.join(
            ", "
        )
    )}
                        </p>

                        ${alerts
            .map(createAlertCard)
            .join("")}
                    </div>

                    <div
                        style="
                            padding: 16px;
                            color: #64748b;
                            font-size: 12px;
                            line-height: 1.5;
                            text-align: center;
                        "
                    >
                        This notification was generated
                        automatically from Azure usage data.
                        Please validate unusual costs before
                        taking corrective action.
                    </div>
                </div>
            </body>
        </html>
    `;
}

function createEmailText(alertReport) {
    const {
        evaluationDate,
        baselineDates = [],
        alerts = [],
    } = alertReport;

    const alertLines = alerts.map(
        (alert, index) => {
            const lines = [
                `${index + 1}. ${formatAlertType(
                    alert.alertType
                )}`,
                `Severity: ${alert.severity}`,
                `Item: ${getAlertTitle(alert)}`,
            ];

            if (alert.subscriptionName) {
                lines.push(
                    `Subscription: ${alert.subscriptionName}`
                );
            }

            if (alert.service) {
                lines.push(
                    `Service: ${alert.service}`
                );
            }

            if (
                Number.isFinite(
                    Number(alert.currentCost)
                )
            ) {
                lines.push(
                    `Current cost: ${formatCurrency(
                        alert.currentCost,
                        alert.billingCurrency ||
                        "INR"
                    )}`
                );
            }

            if (
                Number.isFinite(
                    Number(alert.baselineCost)
                )
            ) {
                lines.push(
                    `7-day baseline: ${formatCurrency(
                        alert.baselineCost,
                        alert.billingCurrency ||
                        "INR"
                    )}`
                );
            }

            if (
                Number.isFinite(
                    Number(
                        alert.currentQuantity
                    )
                )
            ) {
                lines.push(
                    `Current quantity: ${formatNumber(
                        alert.currentQuantity
                    )} ${alert.unitOfMeasure || ""
                    }`
                );
            }

            if (
                Number.isFinite(
                    Number(
                        alert.baselineQuantity
                    )
                )
            ) {
                lines.push(
                    `7-day quantity baseline: ${formatNumber(
                        alert.baselineQuantity
                    )} ${alert.unitOfMeasure || ""
                    }`
                );
            }

            if (
                Number.isFinite(
                    Number(
                        alert.percentIncrease
                    )
                )
            ) {
                lines.push(
                    `Increase: ${formatPercent(
                        alert.percentIncrease
                    )}`
                );
            }

            return lines.join("\n");
        }
    );

    return [
        "Azure Cost Alert Report",
        `Evaluation date: ${evaluationDate}`,
        `Baseline dates: ${baselineDates.join(
            ", "
        )}`,
        `Total alerts: ${alerts.length}`,
        "",
        ...alertLines,
    ].join("\n\n");
}

function getHighestSeverity(alerts) {
    const severityScore = {
        CRITICAL: 4,
        HIGH: 3,
        WARNING: 2,
        INFO: 1,
    };

    return alerts.reduce(
        (highestSeverity, alert) => {
            const currentScore =
                severityScore[
                alert.severity
                ] || 0;

            const highestScore =
                severityScore[
                highestSeverity
                ] || 0;

            return currentScore >
                highestScore
                ? alert.severity
                : highestSeverity;
        },
        "INFO"
    );
}

async function sendAlertEmail(alertReport) {
    if (
        !alertReport ||
        !Array.isArray(alertReport.alerts)
    ) {
        throw new TypeError(
            "sendAlertEmail expected an alert report containing an alerts array."
        );
    }

    if (alertReport.alerts.length === 0) {
        console.log(
            "No alerts generated. Email was not sent."
        );

        return {
            sent: false,
            reason: "NO_ALERTS",
        };
    }

    const transporter =
        createTransporter();

    /*
     * Verify the SMTP connection before attempting
     * to send the message.
     */
    await transporter.verify();

    const recipients =
        process.env.ALERT_EMAIL_TO
            .split(",")
            .map((email) => email.trim())
            .filter(Boolean);

    if (recipients.length === 0) {
        throw new Error(
            "No valid alert email recipients were configured."
        );
    }

    const highestSeverity =
        getHighestSeverity(
            alertReport.alerts
        );

    const subject =
        `[${highestSeverity}] Azure Cost Alerts: ` +
        `${alertReport.alerts.length} detected on ` +
        `${alertReport.evaluationDate}`;

    const result =
        await transporter.sendMail({
            from: process.env.ALERT_EMAIL_FROM,
            to: recipients,
            subject,
            text: createEmailText(alertReport),
            html: createEmailHtml(alertReport),
        });

    console.log(
        `Alert email sent successfully. Message ID: ${result.messageId}`
    );

    return {
        sent: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
    };
}

module.exports = {
    sendAlertEmail,
    createEmailHtml,
    createEmailText,
};
