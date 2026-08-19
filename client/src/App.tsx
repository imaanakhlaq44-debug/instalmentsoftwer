import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { RequireAuth, RequireRole } from './components/auth/RouteGuards.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

import { LoginPage } from './pages/LoginPage.js';
import { ChangePasswordPage } from './pages/ChangePasswordPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { DevicesPage } from './pages/DevicesPage.js';
import { DeviceDetailPage } from './pages/DeviceDetailPage.js';
import { SimulatorPage } from './pages/SimulatorPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { CustomerDetailPage } from './pages/CustomerDetailPage.js';
import { InstallmentsPage } from './pages/InstallmentsPage.js';
import { PaymentsPage } from './pages/PaymentsPage.js';
import { TransactionsPage } from './pages/TransactionsPage.js';
import { EnrollmentPage } from './pages/EnrollmentPage.js';
import { ContractPage } from './pages/ContractPage.js';
import { LicensesPage } from './pages/LicensesPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { AuditLogsPage } from './pages/AuditLogsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

/** Everyone signed in. */
const ALL = ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER'] as const;
/** Shop-side users; excludes customers. */
const STAFF = ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF'] as const;
/** Owners and above — enforcement, money movement, audit, licensing. */
const ADMIN = ['SUPER_ADMIN', 'DEALER_ADMIN'] as const;

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />

            {/* Signed in, but outside the dashboard shell */}
            <Route
              path="/change-password"
              element={
                <RequireAuth>
                  <ChangePasswordPage />
                </RequireAuth>
              }
            />

            {/* Dashboard */}
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardPage />} />

              <Route path="/devices" element={<RequireRole roles={[...ALL]}><DevicesPage /></RequireRole>} />
              <Route path="/devices/:id" element={<RequireRole roles={[...ALL]}><DeviceDetailPage /></RequireRole>} />

              <Route path="/customers" element={<RequireRole roles={[...STAFF]}><CustomersPage /></RequireRole>} />
              <Route path="/customers/:id" element={<RequireRole roles={[...STAFF]}><CustomerDetailPage /></RequireRole>} />

              <Route path="/installments" element={<RequireRole roles={[...ALL]}><InstallmentsPage /></RequireRole>} />
              <Route path="/payments" element={<RequireRole roles={[...ALL]}><PaymentsPage /></RequireRole>} />
              <Route path="/transactions" element={<RequireRole roles={[...STAFF]}><TransactionsPage /></RequireRole>} />
              <Route path="/notifications" element={<RequireRole roles={[...ALL]}><NotificationsPage /></RequireRole>} />

              <Route path="/simulator" element={<RequireRole roles={[...STAFF]}><SimulatorPage /></RequireRole>} />
              <Route path="/enrollment" element={<RequireRole roles={[...STAFF]}><EnrollmentPage /></RequireRole>} />

              {/* A customer may read the agreement they signed; only staff may take a signature. */}
              <Route path="/contracts/:id" element={<RequireRole roles={[...ALL]}><ContractPage /></RequireRole>} />

              <Route path="/licenses" element={<RequireRole roles={[...ADMIN]}><LicensesPage /></RequireRole>} />
              <Route path="/audit-logs" element={<RequireRole roles={[...ADMIN]}><AuditLogsPage /></RequireRole>} />
              <Route path="/settings" element={<RequireRole roles={[...ADMIN]}><SettingsPage /></RequireRole>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
