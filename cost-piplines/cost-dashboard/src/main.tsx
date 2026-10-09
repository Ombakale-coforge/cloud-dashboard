import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NewRequestPage } from './pages/NewRequestPage.tsx'
import { LinkedAccountsPage } from './pages/LinkedAccountsPage.tsx'
import { LinkedAccountDetailPage } from './pages/LinkedAccountDetailPage.tsx'
import { AzureSubscriptionsPage } from './pages/AzureSubscriptionsPage.tsx'
import { AzureSubscriptionDetailPage } from './pages/AzureSubscriptionDetailPage.tsx'
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

          {/* AWS Linked Accounts Directory */}
          <Route
            path="/linked-accounts"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <LinkedAccountsPage />
              </ProtectedRoute>
            }
          />

          {/* Dedicated AWS Linked Account Deep Dive */}
          <Route
            path="/linked-accounts/:linkedAccountId/*"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <LinkedAccountDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/linked-accounts/:linkedAccountId"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <LinkedAccountDetailPage />
              </ProtectedRoute>
            }
          />

          {/* Azure Subscriptions Directory */}
          <Route
            path="/azure/subscriptions"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AzureSubscriptionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/azure/linked-accounts"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AzureSubscriptionsPage />
              </ProtectedRoute>
            }
          />

          {/* Dedicated Azure Subscription Deep Dive */}
          <Route
            path="/azure/subscriptions/:subscriptionId/*"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AzureSubscriptionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/azure/subscriptions/:subscriptionId"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AzureSubscriptionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/azure/linked-accounts/:subscriptionId/*"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AzureSubscriptionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/azure/linked-accounts/:subscriptionId"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AzureSubscriptionDetailPage />
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

          {/* Fallback Catch-all: redirect to dashboard root, never forcefully to login */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
