import React, { createContext, useContext, useState } from "react";

export type UserRole = "admin" | "basic";

export interface User {
  id: string | number;
  name: string;
  email: string;
  role: UserRole;
  department?: string;
  avatar?: string;
  provider: "credentials";
  loginTime: string;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
  isNewUser?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isBasic: boolean;
  loginAdmin: (password: string, email?: string) => Promise<AuthResult>;
  loginBasic: (email: string, password: string) => Promise<AuthResult>;
  signupBasic: (name: string, email: string, password: string, department?: string) => Promise<AuthResult>;
  logout: () => void;
}

const AUTH_STORAGE_KEY = "cloud_dashboard_session_user";

// Clean any previous browser storage tokens on module load to guarantee landing on /login
try {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
} catch {
  // Ignore storage access errors in restricted browser contexts
}

export const ADMIN_CREDENTIALS = {
  email: "dashboard-admin@coforge.com",
  password: "8iie9gb",
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Always start unauthenticated on app launch so the user is forced to log in first
  const [user, setUser] = useState<User | null>(null);

  // 1. Admin Login
  const loginAdmin = async (password: string, email: string = ADMIN_CREDENTIALS.email): Promise<AuthResult> => {
    return loginBasic(email, password);
  };

  // 2. Basic Login (Queries SQL Server via /api/auth/login)
  const loginBasic = async (email: string, password: string): Promise<AuthResult> => {
    const normEmail = email.trim().toLowerCase();

    if (!normEmail || !password) {
      return { success: false, error: "Please enter your email and password." };
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normEmail, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.message || data.error || "Login failed. Please check credentials.",
          isNewUser: data.error === "USER_NOT_FOUND",
        };
      }

      const loggedInUser: User = data.user;
      setUser(loggedInUser);
      return { success: true, user: loggedInUser };
    } catch (err: any) {
      console.error("SQL Server Login error:", err);
      return {
        success: false,
        error: "Unable to connect to authentication server. Please check SQL Server.",
      };
    }
  };

  // 3. Signup (Persists directly into SQL Server dbo.users via /api/auth/signup)
  const signupBasic = async (
    name: string,
    email: string,
    password: string,
    department: string = "Digital Engineering"
  ): Promise<AuthResult> => {
    const normEmail = email.trim().toLowerCase();
    const finalName = name.trim() || normEmail.split("@")[0].replace(/[._-]/g, " ");

    if (!normEmail || !password) {
      return { success: false, error: "Email and password are required to sign up." };
    }

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: finalName,
          email: normEmail,
          password,
          department,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.message || data.error || "Signup failed.",
        };
      }

      const newUser: User = data.user;
      setUser(newUser);
      return { success: true, user: newUser };
    } catch (err: any) {
      console.error("SQL Server Signup error:", err);
      return {
        success: false,
        error: "Unable to connect to authentication server. Please check SQL Server.",
      };
    }
  };

  const logout = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isAdmin: user?.role === "admin",
        isBasic: user?.role === "basic",
        loginAdmin,
        loginBasic,
        signupBasic,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
