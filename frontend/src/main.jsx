import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/tokens.css';
import './styles/app.css';

import App from './App.jsx';
import { AppStateProvider } from './state/AppState.jsx';
import { DrilldownProvider } from './state/Drilldown.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppStateProvider>
      <DrilldownProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DrilldownProvider>
    </AppStateProvider>
  </StrictMode>
);
