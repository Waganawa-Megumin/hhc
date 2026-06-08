import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequireAdmin } from "./auth/guards";
import MainPage from "./pages/MainPage";
import LoginPage from "./pages/LoginPage";
import MfaChallengePage from "./pages/MfaChallengePage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import MfaEnrollPage from "./pages/MfaEnrollPage";
import AdminLayout from "./pages/admin/AdminLayout";
import UsersPage from "./pages/admin/UsersPage";
import AuditPage from "./pages/admin/AuditPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mfa" element={<MfaChallengePage />} />
      <Route path="/onboarding/password" element={<ChangePasswordPage />} />
      <Route path="/onboarding/mfa" element={<MfaEnrollPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <MainPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
