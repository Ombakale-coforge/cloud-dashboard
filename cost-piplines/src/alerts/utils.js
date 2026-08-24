const RESOURCE_ALERT_EXCLUSIONS = [
    "credit",
    "exemption",
    "adjustment",
    "refund",
];

function average(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    return (
        values.reduce(
            (sum, value) =>
                sum + Number(value || 0),
            0
        ) / values.length
    );
}

function calculatePercentChange(
    currentValue,
    baselineValue
) {
    if (baselineValue <= 0) {
        return null;
    }

    return (
        ((currentValue - baselineValue) /
            baselineValue) *
        100
    );
}

function getPreviousDates(
    dateString,
    numberOfDays
) {
    const dates = [];
    const currentDate = new Date(
        `${dateString}T00:00:00Z`
    );

    if (Number.isNaN(currentDate.getTime())) {
        throw new Error(
            `Invalid date supplied: ${dateString}`
        );
    }

    for (
        let daysBack = numberOfDays;
        daysBack >= 1;
        daysBack--
    ) {
        const historicalDate =
            new Date(currentDate);

        historicalDate.setUTCDate(
            historicalDate.getUTCDate() -
            daysBack
        );

        dates.push(
            historicalDate
                .toISOString()
                .substring(0, 10)
        );
    }

    return dates;
}

function getDateDaysBefore(
    dateString,
    numberOfDays
) {
    const date = new Date(
        `${dateString}T00:00:00Z`
    );

    if (Number.isNaN(date.getTime())) {
        throw new Error(
            `Invalid date supplied: ${dateString}`
        );
    }

    date.setUTCDate(
        date.getUTCDate() - numberOfDays
    );

    return date
        .toISOString()
        .substring(0, 10);
}

function groupRecords(
    records,
    keySelector
) {
    const groups = new Map();

    for (const record of records) {
        const key = keySelector(record);

        if (
            key === null ||
            key === undefined ||
            key === ""
        ) {
            continue;
        }

        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups.get(key).push(record);
    }

    return groups;
}

function sumFieldForDate(
    records,
    date,
    fieldName
) {
    return records
        .filter(
            (record) =>
                record.date === date
        )
        .reduce(
            (total, record) =>
                total +
                Number(
                    record[fieldName] || 0
                ),
            0
        );
}

function calculateRollingBaseline(
    records,
    baselineDates,
    fieldName
) {
    const dailyValues =
        baselineDates.map((date) =>
            sumFieldForDate(
                records,
                date,
                fieldName
            )
        );

    return average(dailyValues);
}

function normalizeResourceId(resourceId) {
    return String(resourceId || "").trim().toLowerCase();
}

function shouldExcludeFromResourceAlerts(
    record
) {
    const resourceName = String(
        record.resourceName || ""
    ).toLowerCase();

    return RESOURCE_ALERT_EXCLUSIONS.some(
        (excludedTerm) =>
            resourceName.includes(
                excludedTerm
            )
    );
}

function getSeverity(percentIncrease) {
    if (
        percentIncrease === null ||
        percentIncrease === undefined
    ) {
        return "INFO";
    }

    if (percentIncrease >= 100) {
        return "CRITICAL";
    }

    if (percentIncrease >= 50) {
        return "HIGH";
    }

    if (percentIncrease >= 25) {
        return "WARNING";
    }

    return "INFO";
}

function createCostSpikeAlert({
    alertType,
    evaluationDate,
    currentCost,
    baselineCost,
    billingCurrency = "INR",
    metadata = {},
}) {
    const absoluteIncrease =
        currentCost - baselineCost;

    const percentIncrease =
        calculatePercentChange(
            currentCost,
            baselineCost
        );

    return {
        alertType,
        severity: getSeverity(
            percentIncrease
        ),
        evaluationDate,
        billingCurrency,
        currentCost,
        baselineCost,
        absoluteIncrease,
        percentIncrease,
        ...metadata,
    };
}

module.exports = {
    average,
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
};
