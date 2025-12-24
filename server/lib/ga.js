const { BetaAnalyticsDataClient } = require('@google-analytics/data');

async function getRealtime({ propertyId }) {
  const client = new BetaAnalyticsDataClient();
  const [response] = await client.runRealtimeReport({
    property: `properties/${propertyId}`,
    dimensions: [
      { name: 'country' },
      { name: 'city' },
      { name: 'unifiedPagePathScreen' },
      { name: 'platform' }
    ],
    metrics: [
      { name: 'activeUsers' },
      { name: 'eventCount' }
    ],
    limit: 50
  });
  return response;
}

module.exports = { getRealtime };
