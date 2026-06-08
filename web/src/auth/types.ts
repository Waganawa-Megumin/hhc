export type Role = "admin" | "user";
export type MfaMethod = "none" | "totp" | "email";

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  mfaMethod: MfaMethod;
  mfaEnrolled: boolean;
  mustChangePassword: boolean;
  mustEnrollMfa: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
