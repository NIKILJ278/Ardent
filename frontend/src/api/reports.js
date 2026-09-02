import api from './client';

const base = (brandId) => `/api/brands/${brandId}`;

// Reports
export const listReports   = (brandId) => api.get(`${base(brandId)}/reports`);
export const saveReport    = (brandId, data) => api.post(`${base(brandId)}/reports`, data);
export const runReport     = (brandId, id) => api.get(`${base(brandId)}/reports/${id}/run`);
export const deleteReport  = (brandId, id) => api.delete(`${base(brandId)}/reports/${id}`);
export const exportReportUrl = (brandId, id) => `${base(brandId)}/reports/${id}/export.csv`;

// Alerts
export const listAlerts    = (brandId, unreadOnly = false) => api.get(`${base(brandId)}/alerts`, { params: unreadOnly ? { unread: 'true' } : {} });
export const generateAlerts = (brandId) => api.post(`${base(brandId)}/alerts/generate`);
export const markAlertRead = (brandId, id) => api.post(`${base(brandId)}/alerts/${id}/read`);
