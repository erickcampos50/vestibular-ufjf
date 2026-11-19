import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import ptBR from 'antd/locale/pt_BR';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={ptBR}
      theme={{
        token: {
          colorPrimary: '#00579d',
          colorLink: '#00579d',
          colorText: '#101828',
          colorTextSecondary: '#667085',
          colorBorder: '#e4e7ec',
          colorBgContainer: '#ffffff',
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          borderRadius: 10,
          controlHeightLG: 54,
          fontSize: 15,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>,
);
