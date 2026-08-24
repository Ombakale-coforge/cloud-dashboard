function normalizeUsageData(records) {
    return records.map((record) => ({
        date: record.date?.substring(0, 10),

        subscriptionId: record.subscriptionId,
        subscriptionName: record.subscriptionName,

        resourceId: record.resourceId,
        resourceName: record.resourceName,

        resourceGroup: record.resourceGroup,

        service: record.consumedService,

        cost: Number(record.cost || 0),

        quantity: Number(record.quantity || 0),

        billingCurrency: record.billingCurrency,

        meterId: record.meterId,

        meterName: record.meterDetails?.meterName,

        meterCategory: record.meterDetails?.meterCategory,

        meterSubCategory: record.meterDetails?.meterSubCategory,

        unitOfMeasure: record.meterDetails?.unitOfMeasure,
    }));
}

module.exports = {
    normalizeUsageData,
};
