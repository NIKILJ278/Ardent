import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import './themes/tokens.css';
import './themes/global.css';

import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { BrandProvider } from './context/BrandContext';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <BrandProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </BrandProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);
