import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NewRequestPage } from './pages/NewRequestPage.tsx'
import { AuthProvider } from './lib/auth.tsx'
import { ProtectedRoute } from './components/ProtectedRoute.tsx'

// Global Uncaught Error Loggers for Easy Copy-Pasting
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    console.error("🔴 [GLOBAL UNCAUGHT ERROR]:", event.message, event.error || event);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("🔴 [GLOBAL UNHANDLED PROMISE REJECTION]:", event.reason || event);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Login Route with Dual Panels */}
          <Route path="/login" element={<LoginPage />} />

          {/* Admin Full Access Dashboard */}
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <App />
              </ProtectedRoute>
            }
          />

          {/* Account Request Portal (Available to both Admin & Basic users) */}
          <Route
            path="/newrequest"
            element={
              <ProtectedRoute allowedRoles={['admin', 'basic']}>
                <NewRequestPage />
              </ProtectedRoute>
            }
          />

          {/* Fallback Catch-all */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
