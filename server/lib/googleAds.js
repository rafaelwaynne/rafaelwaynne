const MICRO = 1_000_000;
const fs = require('fs');
const path = require('path');

function getClient() {
  let GoogleAdsApi;
  try {
    ({ GoogleAdsApi } = require('google-ads-api'));
  } catch (e) {
    return null;
  }
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID || '';
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET || '';
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  if (!client_id || !client_secret || !developer_token) {
    throw new Error('Credenciais Google Ads ausentes (CLIENT_ID/CLIENT_SECRET/DEVELOPER_TOKEN)');
  }
  return new GoogleAdsApi({ client_id, client_secret, developer_token });
}

function getCustomer(client) {
  const customer_id = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
  const refresh_token = process.env.GOOGLE_ADS_REFRESH_TOKEN || '';
  const login_customer_id_raw = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined;
  const login_customer_id = login_customer_id_raw ? String(login_customer_id_raw).replace(/\D/g, '') : undefined;
  if (!customer_id || !refresh_token) {
    throw new Error('Configuração Google Ads ausente (CUSTOMER_ID/REFRESH_TOKEN)');
  }
  return client.Customer({
    customer_account_id: customer_id,
    refresh_token,
    login_customer_id
  });
}

async function fetchAccessToken() {
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID || '';
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET || '';
  let refresh_token = process.env.GOOGLE_ADS_REFRESH_TOKEN || '';
  if (!refresh_token) {
    try {
      const fp = path.join(__dirname, '..', 'data', 'google_ads_oauth.json');
      if (fs.existsSync(fp)) {
        const j = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        refresh_token = j.refresh_token || '';
      }
    } catch {}
  }
  if (!client_id || !client_secret || !refresh_token) throw new Error('OAuth ausente (CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN)');
  const body = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token,
    grant_type: 'refresh_token'
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!resp.ok) throw new Error('Falha ao obter token OAuth: ' + (await resp.text()));
  const json = await resp.json();
  return json.access_token;
}

async function fetchDailyCampaignsRest({ dateRange = 'YESTERDAY' } = {}) {
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  const customer_id = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
  const login_customer_id = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
  if (!developer_token || !customer_id) throw new Error('Configuração Google Ads ausente (DEVELOPER_TOKEN/CUSTOMER_ID)');
  const access = await fetchAccessToken();
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date DURING ${dateRange}
      AND campaign.status != 'REMOVED'
  `;
  const resp = await fetch(`https://googleads.googleapis.com/v17/customers/${customer_id}/googleAds:search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access}`,
      'developer-token': developer_token,
      ...(login_customer_id ? { 'login-customer-id': login_customer_id } : {}),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  if (!resp.ok) throw new Error('Falha ao consultar Google Ads: ' + (await resp.text()));
  const json = await resp.json();
  const results = Array.isArray(json.results) ? json.results : [];
  return results.map(r => {
    const c = r.campaign || {};
    const b = r.campaignBudget || r.campaign_budget || {};
    const m = r.metrics || {};
    return {
      campaignId: c.id,
      name: c.name,
      status: c.status,
      dailyBudget: (Number((b.amountMicros ?? b.amount_micros) || 0) / MICRO),
      cost: (Number((m.costMicros ?? m.cost_micros) || 0) / MICRO),
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      ctr: Number(m.ctr || 0),
      cpc: Number((m.averageCpc ?? m.average_cpc) || 0) / MICRO,
      conversions: Number(m.conversions || 0),
      costPerConversion: Number((m.costPerConversion ?? m.cost_per_conversion) || 0) / MICRO
    };
  });
}

async function fetchDailyCampaigns({ dateRange = 'YESTERDAY' } = {}) {
  const client = getClient();
  if (client) {
    const customer = getCustomer(client);
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date DURING ${dateRange}
        AND campaign.status != 'REMOVED'
    `;
    const rows = await customer.query(query);
    return rows.map(r => ({
      campaignId: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      dailyBudget: (Number(r.campaign_budget.amount_micros || 0) / MICRO),
      cost: (Number(r.metrics.cost_micros || 0) / MICRO),
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      ctr: Number(r.metrics.ctr || 0),
      cpc: Number(r.metrics.average_cpc || 0) / MICRO,
      conversions: Number(r.metrics.conversions || 0),
      costPerConversion: Number(r.metrics.cost_per_conversion || 0) / MICRO
    }));
  } else {
    return fetchDailyCampaignsRest({ dateRange });
  }
}

async function testConnection() {
  try {
    const client = getClient();
    if (client) {
      const customer = getCustomer(client);
      const rows = await customer.query(`
        SELECT customer.descriptive_name FROM customer LIMIT 1
      `);
      return { ok: true, method: 'sdk', details: rows && rows.length ? rows[0].customer.descriptive_name : '' };
    } else {
      const access = await fetchAccessToken();
      const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
      const customer_id = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
      const login_customer_id = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
      const resp = await fetch(`https://googleads.googleapis.com/v17/customers/${customer_id}/googleAds:search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access}`,
          'developer-token': developer_token,
          ...(login_customer_id ? { 'login-customer-id': login_customer_id } : {}),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: 'SELECT customer.descriptive_name FROM customer LIMIT 1' })
      });
      if (!resp.ok) return { ok: false, method: 'rest', error: await resp.text() };
      const json = await resp.json();
      return { ok: true, method: 'rest', details: Array.isArray(json.results) && json.results.length ? (json.results[0].customer?.descriptiveName || '') : '' };
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { fetchDailyCampaigns, testConnection };
