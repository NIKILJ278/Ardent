import api from './client';

export const askAnalyst = (brandId, question) =>
  api.post(`/api/brands/${brandId}/ai/query`, { question });
