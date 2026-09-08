import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { BrandFooter } from './components/BrandFooter.js';
import './styles/index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
    <BrandFooter />
  </StrictMode>,
);
