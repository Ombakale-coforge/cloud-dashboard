import React, { createContext, useContext, useState, useEffect } from "react";
import { readJsonFromR2, writeJsonToR2 } from "@/lib/r2Client";

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
const USERS_CACHE_KEY = "r2_users_db_cache";

export const ADMIN_CREDENTIALS = {
  email: "dashboard-admin@coforge.com",
  password: "8iie9gb",
};

function getCachedUsers(): any[] {
  try {
    const raw = localStorage.getItem(USERS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setCachedUsers(users: any[]) {
  try {
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
  } catch {
    // ignore
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
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

    setUser(adminUser);
    return { success: true, user: adminUser };
  };

  // 2. Basic Login for returning users (Directly from Cloudflare R2 user.json)
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

    let users = getCachedUsers();

    // Fetch live users array directly from Cloudflare R2 bucket
    try {
      const { data: remoteUsers } = await readJsonFromR2("user.json", "users.json", []);
      if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
        users = remoteUsers;
        setCachedUsers(remoteUsers);
      }
    } catch (err: any) {
      console.warn("R2 fetch warning, using cached users:", err);
    }

    const existingUser = users.find(
      (u: any) => u.email && u.email.toLowerCase() === normEmail
    );

    if (!existingUser) {
      return {
        success: false,
        error: "Account not found in Cloudflare R2 database. Please sign up.",
        isNewUser: true,
      };
    }

    if (existingUser.password !== password) {
      return {
        success: false,
        error: "Incorrect password for this account.",
      };
    }

    const basicUser: User = {
      id: existingUser.id || `usr-${Date.now().toString(36)}`,
      name: existingUser.name,
      email: existingUser.email,
      role: "basic",
      department: existingUser.department || "Digital Engineering",
      provider: existingUser.provider || "credentials",
      loginTime: new Date().toISOString(),
    };

    setUser(basicUser);
    return { success: true, user: basicUser };
  };

  // 3. Signup for 1st time basic users (Directly writes to Cloudflare R2 user.json)
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

    let users = getCachedUsers();
    let actualKey = "user.json";

    // Sync latest users from Cloudflare R2 bucket first
    try {
      const res = await readJsonFromR2("user.json", "users.json", []);
      if (Array.isArray(res.data) && res.data.length > 0) {
        users = res.data;
        actualKey = res.actualKey;
      }
    } catch (err: any) {
      console.warn("R2 sync warning during signup:", err);
    }

    const exists = users.find(
      (u: any) => u.email && u.email.toLowerCase() === normEmail
    );

    if (exists) {
      return {
        success: false,
        error: "An account with this email already exists in R2 database. Please log in.",
      };
    }

    const newUser = {
      id: `usr-${Date.now().toString(36)}`,
      name: finalName,
      email: normEmail,
      password: password,
      department: department.trim() || "Digital Engineering",
      role: "basic",
      provider: "credentials",
      createdAt: new Date().toISOString(),
    };

    const updatedUsers = [...users, newUser];
    setCachedUsers(updatedUsers);

    // Save directly to Cloudflare R2 bucket
    try {
      await writeJsonToR2(actualKey || "user.json", updatedUsers);
    } catch (err: any) {
      console.error("Failed to write new user to R2 bucket:", err);
    }

    const basicUser: User = {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: "basic",
      department: newUser.department,
      provider: "credentials",
      loginTime: new Date().toISOString(),
    };

    setUser(basicUser);
    return { success: true, user: basicUser };
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
