import api from './client';

export const listBrands  = () => api.get('/api/brands');
export const createBrand = (data) => api.post('/api/brands', data);
export const getBrand    = (id) => api.get(`/api/brands/${id}`);
