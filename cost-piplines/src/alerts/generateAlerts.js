const {
    calculatePercentChange,
    getPreviousDates,
    getDateDaysBefore,
    groupRecords,
    sumFieldForDate,
    calculateRollingBaseline,
    normalizeResourceId,
    shouldExcludeFromResourceAlerts,
    getSeverity,
    createCostSpikeAlert,
} = require("./utils");

const ALERT_CONFIG = {
    baselineDays: 7,

    /*
     * Azure usage data for the newest date may be incomplete.
     * A value of 1 evaluates the previous available date.
     */
    dataLagDays: 1,

    subscription: {
        minimumPercentIncrease: 5,
        minimumAbsoluteIncrease: 5,
    },

    service: {
        minimumPercentIncrease: 5,
        minimumAbsoluteIncrease: 5,
    },

    resource: {
        minimumPercentIncrease: 5,
        minimumAbsoluteIncrease: 5,
    },

    quantity: {
        minimumPercentIncrease: 5,
        minimumAbsoluteIncrease: 1,
        minimumBaselineQuantity: 1,
    },

    newResource: {
        minimumDailyCost: 10,
        lookbackDays: 30,
    },
};

function passesIncreaseThreshold({
    currentValue,
    baselineValue,
    minimumPercentIncrease,
    minimumAbsoluteIncrease,
}) {
    if (baselineValue <= 0) {
        return false;
    }

    const absoluteIncrease =
        currentValue - baselineValue;

    const percentIncrease =
        calculatePercentChange(
            currentValue,
            baselineValue
        );

    if (percentIncrease === null) {
        return false;
    }

    return (
        percentIncrease >= minimumPercentIncrease &&
        absoluteIncrease >= minimumAbsoluteIncrease
    );
}

function generateSubscriptionCostAlerts({
    records,
    evaluationDate,
    baselineDates,
}) {
    const alerts = [];

    const subscriptionGroups = groupRecords(
        records,
        (record) => record.subscriptionId
    );

    for (const [, subscriptionRecords] of subscriptionGroups) {
        const currentCost = sumFieldForDate(
            subscriptionRecords,
            evaluationDate,
            "cost"
        );

        const baselineCost = calculateRollingBaseline(
            subscriptionRecords,
            baselineDates,
            "cost"
        );

        const shouldGenerateAlert =
            passesIncreaseThreshold({
                currentValue: currentCost,
                baselineValue: baselineCost,
                minimumPercentIncrease:
                    ALERT_CONFIG.subscription
                        .minimumPercentIncrease,
                minimumAbsoluteIncrease:
                    ALERT_CONFIG.subscription
                        .minimumAbsoluteIncrease,
            });

        if (!shouldGenerateAlert) {
            continue;
        }

        alerts.push(
            createCostSpikeAlert({
                alertType:
                    "SUBSCRIPTION_COST_SPIKE",
                evaluationDate,
                currentCost,
                baselineCost,
                billingCurrency:
                    subscriptionRecords[0]
                        .billingCurrency || "INR",
                metadata: {
                    subscriptionId:
                        subscriptionRecords[0]
                            .subscriptionId,
                    subscriptionName:
                        subscriptionRecords[0]
                            .subscriptionName,
                },
            })
        );
    }

    return alerts;
}

function generateServiceCostAlerts({
    records,
    evaluationDate,
    baselineDates,
}) {
    const alerts = [];

    /*
     * Service names are grouped case-insensitively.
     * For example, Microsoft.Compute and
     * microsoft.compute are treated as the same service.
     */
    const serviceGroups = groupRecords(
        records,
        (record) =>
            String(
                record.service ||
                "unknown_service"
            )
                .trim()
                .toLowerCase()
    );

    for (const [, serviceRecords] of serviceGroups) {
        const currentCost = sumFieldForDate(
            serviceRecords,
            evaluationDate,
            "cost"
        );

        const baselineCost = calculateRollingBaseline(
            serviceRecords,
            baselineDates,
            "cost"
        );

        const shouldGenerateAlert =
            passesIncreaseThreshold({
                currentValue: currentCost,
                baselineValue: baselineCost,
                minimumPercentIncrease:
                    ALERT_CONFIG.service
                        .minimumPercentIncrease,
                minimumAbsoluteIncrease:
                    ALERT_CONFIG.service
                        .minimumAbsoluteIncrease,
            });

        if (!shouldGenerateAlert) {
            continue;
        }

        alerts.push(
            createCostSpikeAlert({
                alertType: "SERVICE_COST_SPIKE",
                evaluationDate,
                currentCost,
                baselineCost,
                billingCurrency:
                    serviceRecords[0]
                        .billingCurrency || "INR",
                metadata: {
                    subscriptionId:
                        serviceRecords[0]
                            .subscriptionId,
                    subscriptionName:
                        serviceRecords[0]
                            .subscriptionName,
                    service:
                        serviceRecords[0].service,
                },
            })
        );
    }

    return alerts;
}

function generateResourceCostAlerts({
    records,
    evaluationDate,
    baselineDates,
}) {
    const alerts = [];

    /*
     * Billing credits, refunds, exemptions and adjustments
     * are excluded from resource-level alerts.
     *
     * They remain included in subscription-level and
     * service-level totals.
     */
    const eligibleRecords = records.filter(
        (record) =>
            record.resourceId &&
            !shouldExcludeFromResourceAlerts(
                record
            )
    );

    const resourceGroups = groupRecords(
        eligibleRecords,
        (record) =>
            [
                record.subscriptionId,
                normalizeResourceId(record.resourceId),
            ].join("|")
    );

    for (const [, resourceRecords] of resourceGroups) {
        const currentCost = sumFieldForDate(
            resourceRecords,
            evaluationDate,
            "cost"
        );

        const baselineCost = calculateRollingBaseline(
            resourceRecords,
            baselineDates,
            "cost"
        );

        const shouldGenerateAlert =
            passesIncreaseThreshold({
                currentValue: currentCost,
                baselineValue: baselineCost,
                minimumPercentIncrease:
                    ALERT_CONFIG.resource
                        .minimumPercentIncrease,
                minimumAbsoluteIncrease:
                    ALERT_CONFIG.resource
                        .minimumAbsoluteIncrease,
            });

        if (!shouldGenerateAlert) {
            continue;
        }

        alerts.push(
            createCostSpikeAlert({
                alertType: "RESOURCE_COST_SPIKE",
                evaluationDate,
                currentCost,
                baselineCost,
                billingCurrency:
                    resourceRecords[0]
                        .billingCurrency || "INR",
                metadata: {
                    subscriptionId:
                        resourceRecords[0]
                            .subscriptionId,
                    subscriptionName:
                        resourceRecords[0]
                            .subscriptionName,
                    resourceId:
                        resourceRecords[0]
                            .resourceId,
                    resourceName:
                        resourceRecords[0]
                            .resourceName,
                    resourceGroup:
                        resourceRecords[0]
                            .resourceGroup,
                    service:
                        resourceRecords[0].service,
                },
            })
        );
    }

    return alerts;
}

function generateNewResourceAlerts({
    records,
    evaluationDate,
}) {
    const alerts = [];

    const lookbackStartDate = getDateDaysBefore(
        evaluationDate,
        ALERT_CONFIG.newResource.lookbackDays
    );

    /*
     * Include only records inside the configured lookback
     * period and up to the evaluation date.
     *
     * Records from dates after the evaluation date are ignored.
     */
    const eligibleRecords = records.filter(
        (record) =>
            record.resourceId &&
            !shouldExcludeFromResourceAlerts(
                record
            ) &&
            record.date >= lookbackStartDate &&
            record.date <= evaluationDate
    );

    const resourceGroups = groupRecords(
        eligibleRecords,
        (record) =>
            [
                record.subscriptionId,
                normalizeResourceId(record.resourceId),
            ].join("|")
    );

    for (const [, resourceRecords] of resourceGroups) {
        const datesSeen = [
            ...new Set(
                resourceRecords.map(
                    (record) => record.date
                )
            ),
        ].sort();

        const firstSeenDate = datesSeen[0];

        /*
         * A resource is considered new only when its first
         * appearance within the lookback period is on the
         * evaluation date.
         */
        if (firstSeenDate !== evaluationDate) {
            continue;
        }

        const currentCost = sumFieldForDate(
            resourceRecords,
            evaluationDate,
            "cost"
        );

        if (
            currentCost <
            ALERT_CONFIG.newResource
                .minimumDailyCost
        ) {
            continue;
        }

        let severity = "WARNING";

        if (currentCost >= 5000) {
            severity = "CRITICAL";
        } else if (currentCost >= 2000) {
            severity = "HIGH";
        }

        alerts.push({
            alertType:
                "NEW_EXPENSIVE_RESOURCE",
            severity,
            evaluationDate,
            firstSeenDate,
            billingCurrency:
                resourceRecords[0]
                    .billingCurrency || "INR",
            currentCost,
            subscriptionId:
                resourceRecords[0]
                    .subscriptionId,
            subscriptionName:
                resourceRecords[0]
                    .subscriptionName,
            resourceId:
                resourceRecords[0].resourceId,
            resourceName:
                resourceRecords[0]
                    .resourceName,
            resourceGroup:
                resourceRecords[0]
                    .resourceGroup,
            service:
                resourceRecords[0].service,
        });
    }

    return alerts;
}

function generateQuantityAlerts({
    records,
    evaluationDate,
    baselineDates,
}) {
    const alerts = [];

    const eligibleRecords = records.filter(
        (record) =>
            record.resourceId &&
            record.meterId &&
            Number.isFinite(record.quantity) &&
            !shouldExcludeFromResourceAlerts(
                record
            )
    );

    /*
     * Quantity records are grouped by subscription,
     * resource, meter and unit of measure.
     *
     * This prevents incompatible quantities such as
     * GB, hours and transactions from being combined.
     */
    const meterGroups = groupRecords(
        eligibleRecords,
        (record) =>
            [
                record.subscriptionId,
                normalizeResourceId(record.resourceId),
                record.meterId,
                record.unitOfMeasure ||
                "unknown_unit",
            ].join("|")
    );

    for (const [, meterRecords] of meterGroups) {
        const currentQuantity = sumFieldForDate(
            meterRecords,
            evaluationDate,
            "quantity"
        );

        const baselineQuantity =
            calculateRollingBaseline(
                meterRecords,
                baselineDates,
                "quantity"
            );

        if (
            baselineQuantity <
            ALERT_CONFIG.quantity
                .minimumBaselineQuantity
        ) {
            continue;
        }

        const absoluteIncrease =
            currentQuantity -
            baselineQuantity;

        const percentIncrease =
            calculatePercentChange(
                currentQuantity,
                baselineQuantity
            );

        if (percentIncrease === null) {
            continue;
        }

        const passesPercentThreshold =
            percentIncrease >=
            ALERT_CONFIG.quantity
                .minimumPercentIncrease;

        const passesAbsoluteThreshold =
            absoluteIncrease >=
            ALERT_CONFIG.quantity
                .minimumAbsoluteIncrease;

        if (
            !passesPercentThreshold ||
            !passesAbsoluteThreshold
        ) {
            continue;
        }

        alerts.push({
            alertType: "QUANTITY_SPIKE",
            severity:
                getSeverity(percentIncrease),
            evaluationDate,
            subscriptionId:
                meterRecords[0]
                    .subscriptionId,
            subscriptionName:
                meterRecords[0]
                    .subscriptionName,
            resourceId:
                meterRecords[0].resourceId,
            resourceName:
                meterRecords[0].resourceName,
            resourceGroup:
                meterRecords[0]
                    .resourceGroup,
            service:
                meterRecords[0].service,
            meterId:
                meterRecords[0].meterId,
            meterName:
                meterRecords[0].meterName,
            meterCategory:
                meterRecords[0]
                    .meterCategory,
            meterSubCategory:
                meterRecords[0]
                    .meterSubCategory,
            unitOfMeasure:
                meterRecords[0]
                    .unitOfMeasure,
            currentQuantity,
            baselineQuantity,
            absoluteIncrease,
            percentIncrease,
        });
    }

    return alerts;
}

function validateRecords(records) {
    if (!Array.isArray(records)) {
        throw new TypeError(
            "generateAlerts expected an array of normalized usage records."
        );
    }

    return records.filter(
        (record) =>
            record &&
            typeof record.date === "string" &&
            record.date.length === 10 &&
            Number.isFinite(record.cost) &&
            Number.isFinite(record.quantity)
    );
}

function getAvailableDates(records) {
    return [
        ...new Set(
            records.map(
                (record) => record.date
            )
        ),
    ].sort();
}

function sortAlerts(alerts) {
    const severityScore = {
        CRITICAL: 4,
        HIGH: 3,
        WARNING: 2,
        INFO: 1,
    };

    return alerts.sort(
        (firstAlert, secondAlert) => {
            const firstSeverity =
                severityScore[
                firstAlert.severity
                ] || 0;

            const secondSeverity =
                severityScore[
                secondAlert.severity
                ] || 0;

            const severityDifference =
                secondSeverity -
                firstSeverity;

            if (severityDifference !== 0) {
                return severityDifference;
            }

            const firstPercentIncrease =
                Number(
                    firstAlert.percentIncrease ||
                    0
                );

            const secondPercentIncrease =
                Number(
                    secondAlert.percentIncrease ||
                    0
                );

            if (
                secondPercentIncrease !==
                firstPercentIncrease
            ) {
                return (
                    secondPercentIncrease -
                    firstPercentIncrease
                );
            }

            const firstAbsoluteIncrease =
                Number(
                    firstAlert.absoluteIncrease ||
                    firstAlert.currentCost ||
                    0
                );

            const secondAbsoluteIncrease =
                Number(
                    secondAlert.absoluteIncrease ||
                    secondAlert.currentCost ||
                    0
                );

            return (
                secondAbsoluteIncrease -
                firstAbsoluteIncrease
            );
        }
    );
}

function generateAlerts(records) {
    const validRecords =
        validateRecords(records);

    const availableDates =
        getAvailableDates(validRecords);

    const minimumRequiredDates =
        ALERT_CONFIG.baselineDays +
        ALERT_CONFIG.dataLagDays +
        1;

    if (
        availableDates.length <
        minimumRequiredDates
    ) {
        throw new Error(
            `Not enough usage dates. ` +
            `Required at least ${minimumRequiredDates}, ` +
            `but found ${availableDates.length}.`
        );
    }

    const evaluationDateIndex =
        availableDates.length -
        1 -
        ALERT_CONFIG.dataLagDays;

    if (evaluationDateIndex < 0) {
        throw new Error(
            "Unable to determine the alert evaluation date."
        );
    }

    const evaluationDate =
        availableDates[
        evaluationDateIndex
        ];

    /*
     * The baseline uses the previous seven calendar days,
     * not merely the previous seven dates that contain data.
     */
    const baselineDates = getPreviousDates(
        evaluationDate,
        ALERT_CONFIG.baselineDays
    );

    console.log(
        `Alert evaluation date: ${evaluationDate}`
    );

    console.log(
        `Baseline dates: ${baselineDates.join(
            ", "
        )}`
    );

    const availableDateSet =
        new Set(availableDates);

    const missingBaselineDates =
        baselineDates.filter(
            (date) =>
                !availableDateSet.has(date)
        );

    if (missingBaselineDates.length > 0) {
        console.warn(
            "Missing usage data for baseline dates:",
            missingBaselineDates.join(", ")
        );
    }

    const subscriptionAlerts =
        generateSubscriptionCostAlerts({
            records: validRecords,
            evaluationDate,
            baselineDates,
        });

    const serviceAlerts =
        generateServiceCostAlerts({
            records: validRecords,
            evaluationDate,
            baselineDates,
        });

    const resourceAlerts =
        generateResourceCostAlerts({
            records: validRecords,
            evaluationDate,
            baselineDates,
        });

    const newResourceAlerts =
        generateNewResourceAlerts({
            records: validRecords,
            evaluationDate,
        });

    const quantityAlerts =
        generateQuantityAlerts({
            records: validRecords,
            evaluationDate,
            baselineDates,
        });

    const alerts = sortAlerts([
        ...subscriptionAlerts,
        ...serviceAlerts,
        ...resourceAlerts,
        ...newResourceAlerts,
        ...quantityAlerts,
    ]);

    const alertReport = {
        generatedAt:
            new Date().toISOString(),
        evaluationDate,
        baselineDates,
        configuration: ALERT_CONFIG,
        summary: {
            total: alerts.length,
            subscriptionCostSpikes:
                subscriptionAlerts.length,
            serviceCostSpikes:
                serviceAlerts.length,
            resourceCostSpikes:
                resourceAlerts.length,
            newExpensiveResources:
                newResourceAlerts.length,
            quantitySpikes:
                quantityAlerts.length,
        },
        alerts,
    };

    console.log(
        `Generated ${alerts.length} alerts.`
    );

    return alertReport;
}

module.exports = {
    generateAlerts,
    ALERT_CONFIG,
};
