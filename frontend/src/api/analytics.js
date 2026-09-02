import api from './client';

const base = (brandId) => `/api/brands/${brandId}`;

export const getDashboard          = (brandId, days = 30) => api.get(`${base(brandId)}/dashboard`, { params: { days } });
export const getChannelProfit      = (brandId, days = 30) => api.get(`${base(brandId)}/analytics/channel-profitability`, { params: { days } });
export const getWaterfall          = (brandId, days = 30) => api.get(`${base(brandId)}/analytics/gross-to-net-waterfall`, { params: { days } });
export const getSkuPareto          = (brandId, days = 30, top_n = 50) => api.get(`${base(brandId)}/analytics/sku-profit-pareto`, { params: { days, top_n } });
export const getStateMatrix        = (brandId, days = 90) => api.get(`${base(brandId)}/analytics/state-action-matrix`, { params: { days } });
export const getCampaignPerf       = (brandId, days = 14) => api.get(`${base(brandId)}/analytics/campaign-performance`, { params: { days } });
export const getCustomerSegments   = (brandId) => api.get(`${base(brandId)}/analytics/customer-segments`);
export const getInventoryHealth    = (brandId) => api.get(`${base(brandId)}/analytics/inventory-health`);
