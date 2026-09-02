import api from './client';

export const login    = (email, password) => api.post('/api/auth/login',    { email, password });
export const register = (email, password, full_name) => api.post('/api/auth/register', { email, password, full_name });
export const getMe    = () => api.get('/api/auth/me');
