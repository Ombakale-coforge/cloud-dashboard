import React, { createContext, useContext, useState, useEffect } from "react";

export type UserRole = "admin" | "basic";

export interface User {
  id: string;
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

export const ADMIN_CREDENTIALS = {
  email: "dashboard-admin@coforge.com",
  password: "8iie9gb",
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      // sessionStorage is cleared on page refresh / tab close,
      // so the user must always log in fresh.
      const stored = sessionStorage.getItem(AUTH_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (user) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [user]);

  // 1. Admin Login (Strict credentials)
  const loginAdmin = async (password: string, email: string = ADMIN_CREDENTIALS.email): Promise<AuthResult> => {
    const normEmail = email.trim().toLowerCase();

    if (normEmail !== ADMIN_CREDENTIALS.email.toLowerCase()) {
      return {
        success: false,
        error: `Only "${ADMIN_CREDENTIALS.email}" is authorized for Admin access.`,
      };
    }

    if (password !== ADMIN_CREDENTIALS.password) {
      return {
        success: false,
        error: "Incorrect Admin password. Please check your credentials.",
      };
    }

    const adminUser: User = {
      id: "admin-01",
      name: "Dashboard Administrator",
      email: ADMIN_CREDENTIALS.email,
      role: "admin",
      department: "Cloud Governance & FinOps",
      provider: "credentials",
      loginTime: new Date().toISOString(),
    };

    try {
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normEmail, password }),
      });
    } catch {
      // Admin session allowed
    }

    setUser(adminUser);
    return { success: true, user: adminUser };
  };

  // 2. Basic Login for returning users (Strictly via Cloudflare R2)
  const loginBasic = async (email: string, password: string): Promise<AuthResult> => {
    const normEmail = email.trim().toLowerCase();

    if (!normEmail || !password) {
      return { success: false, error: "Please enter your email and password." };
    }

    if (normEmail === ADMIN_CREDENTIALS.email.toLowerCase()) {
      if (password === ADMIN_CREDENTIALS.password) {
        return loginAdmin(password, email);
      } else {
        return { success: false, error: "Incorrect Admin password." };
      }
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normEmail, password }),
      });

      const data = await res.json();

      if (res.status === 404) {
        return {
          success: false,
          error: "Account not found in Cloudflare R2 database. Please sign up.",
          isNewUser: true,
        };
      }

      if (!res.ok) {
        return {
          success: false,
          error: data.message || "Invalid credentials",
        };
      }

      if (data.user) {
        setUser(data.user);
        return { success: true, user: data.user };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Failed to reach Cloudflare R2 backend server. Ensure 'npm run dev' is running.",
      };
    }

    return { success: false, error: "Authentication failed in R2 database." };
  };

  // 3. Signup for 1st time basic users (Strictly writes to Cloudflare R2)
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

    if (normEmail === ADMIN_CREDENTIALS.email.toLowerCase()) {
      return { success: false, error: "This email is reserved for Admin." };
    }

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, email: normEmail, password, department }),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          error: data.message || "Failed to save user to Cloudflare R2.",
        };
      }

      if (data.user) {
        setUser(data.user);
        return { success: true, user: data.user };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Failed to reach Cloudflare R2 backend server. Ensure 'npm run dev' is running.",
      };
    }

    return { success: false, error: "Signup failed in Cloudflare R2." };
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
