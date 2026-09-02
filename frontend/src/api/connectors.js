import api from './client';

const base = (brandId) => `/api/brands/${brandId}/connectors`;

export const listConnectors    = (brandId) => api.get(base(brandId));
export const getAuthorizeUrl   = (brandId, platform) => api.post(`${base(brandId)}/${platform}/authorize-url`);
export const oauthCallback     = (brandId, platform, data) => api.post(`${base(brandId)}/${platform}/callback`, data);
export const triggerSync       = (brandId, connectionId) => api.post(`${base(brandId)}/${connectionId}/sync`);
export const syncAll           = (brandId) => api.post(`${base(brandId)}/sync-all`);
export const disconnectConn    = (brandId, connectionId) => api.delete(`${base(brandId)}/${connectionId}`);
