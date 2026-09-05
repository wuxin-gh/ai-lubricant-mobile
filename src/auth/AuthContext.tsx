import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { obtainCaptchaToken } from '@/api/captcha';
import {
  DEFAULT_BASE_URL,
  getUserStatus,
  login as apiLogin,
  logout as apiLogout,
  setBaseUrl,
  setBasicAuth,
  setUnauthorizedHandler,
} from '@/api/client';
import { loadBasicAuth, loadPassword, migrateLegacy, saveBasicAuth, savePassword } from '@/auth/secrets';
import type { UserStatus } from '@/api/types';

// 非敏感配置留在 AsyncStorage；敏感凭据（密码、Basic Auth）走 SecureStore（见 secrets.ts）。
const STORAGE_BASE_URL = 'mc.baseUrl';
const STORAGE_EMAIL = 'mc.email';
const STORAGE_LOGGED_IN = 'mc.loggedIn';
const STORAGE_MODE = 'mc.mode'; // 'user' | 'admin'：仅前端视图切换，权限最终由后端按 role 判定

export type PortalMode = 'user' | 'admin';

interface AuthState {
  ready: boolean; // 启动恢复完成
  authenticated: boolean;
  user: UserStatus | null;
  isAdmin: boolean; // user.role === 'admin'
  mode: PortalMode; // 当前所在门户（管理端仅 isAdmin 时可进）
  needsPortalChoice: boolean; // 管理员刚完成账号密码登录时暂停根导航，等待选择门户
  baseUrl: string;
  basicAuth: string; // 测试环境的 HTTP Basic Auth（"user:pass"），可选
  savedEmail: string;
  savedPassword: string; // 上次登录成功的密码，用于自动填充
  refreshUser: () => Promise<UserStatus>;
  login: (email: string, password: string, targetBaseUrl?: string, rememberPassword?: boolean) => Promise<UserStatus>;
  logout: () => Promise<void>;
  setMode: (m: PortalMode) => void;
  updateBaseUrl: (url: string) => Promise<void>;
  updateBasicAuth: (v: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function hasUserIdentity(u: UserStatus | null | undefined): u is UserStatus {
  return !!u && !!(u.id || u.email || u.username);
}

function isAdminUser(u: UserStatus | null): boolean {
  return (u?.role || '').toLowerCase() === 'admin';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<UserStatus | null>(null);
  const [baseUrl, setBaseUrlState] = useState(DEFAULT_BASE_URL);
  const [basicAuth, setBasicAuthState] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [savedPassword, setSavedPassword] = useState('');
  const [mode, setModeState] = useState<PortalMode>('user');
  const [needsPortalChoice, setNeedsPortalChoice] = useState(false);

  const doLogout = useCallback(async () => {
    // 先清掉本地登录态与用户信息，再让后端失效会话；
    // 否则残留的会话 Cookie 会被下一次登录沿用，导致用户信息串号。
    setAuthenticated(false);
    setUser(null);
    setModeState('user');
    setNeedsPortalChoice(false);
    await AsyncStorage.multiSet([[STORAGE_LOGGED_IN, '0'], [STORAGE_MODE, 'user']]);
    await apiLogout();
  }, []);

  const setMode = useCallback((m: PortalMode) => {
    setModeState(m);
    setNeedsPortalChoice(false);
    AsyncStorage.setItem(STORAGE_MODE, m).catch(() => undefined);
  }, []);

  // 401 时自动退出登录态
  useEffect(() => {
    setUnauthorizedHandler(() => {
      AsyncStorage.setItem(STORAGE_LOGGED_IN, '0').catch(() => undefined);
      setAuthenticated(false);
      setUser(null);
      setModeState('user');
      setNeedsPortalChoice(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // 启动恢复：先把旧版本留在 AsyncStorage 的明文凭据迁到 SecureStore（幂等），
  // 再读取非敏感配置 + 敏感凭据，并尝试用现有 Cookie 验证会话。
  useEffect(() => {
    (async () => {
      try {
        await migrateLegacy();
        const [storedBase, storedEmail, loggedIn, storedMode, storedBasic, storedPassword] = await Promise.all([
          AsyncStorage.getItem(STORAGE_BASE_URL),
          AsyncStorage.getItem(STORAGE_EMAIL),
          AsyncStorage.getItem(STORAGE_LOGGED_IN),
          AsyncStorage.getItem(STORAGE_MODE),
          loadBasicAuth(),
          loadPassword(),
        ]);
        const url = storedBase || DEFAULT_BASE_URL;
        setBaseUrl(url);
        setBaseUrlState(url);
        // 先装好 Basic Auth，后面的 getUserStatus 才能穿过测试环境的代理
        setBasicAuth(storedBasic || '');
        setBasicAuthState(storedBasic || '');
        if (storedEmail) setSavedEmail(storedEmail);
        if (storedPassword) setSavedPassword(storedPassword);
        setModeState(storedMode === 'admin' ? 'admin' : 'user');

        if (loggedIn === '1') {
          try {
            const u = await getUserStatus();
            if (hasUserIdentity(u)) {
              setUser(u);
              setAuthenticated(true);
            }
          } catch {
            // 会话失效，保持未登录
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await getUserStatus();
    if (hasUserIdentity(u)) {
      setUser(u);
      setAuthenticated(true);
    }
    return u;
  }, []);

  const login = useCallback(
    async (email: string, password: string, targetBaseUrl?: string, rememberPassword = false) => {
      const cleanEmail = email.trim();
      const captchaToken = await obtainCaptchaToken(targetBaseUrl || baseUrl);
      await apiLogin(cleanEmail, password, captchaToken);
      // 登录成功后拉取用户信息
      let u: UserStatus = {};
      try {
        u = await getUserStatus();
      } catch {
        /* 忽略，仍视为已登录 */
      }
      // 非敏感配置走 AsyncStorage；密码走 SecureStore（不可用时不持久化，但不影响会话 Cookie）。
      await AsyncStorage.multiSet([
        [STORAGE_LOGGED_IN, '1'],
        [STORAGE_EMAIL, cleanEmail],
      ]);
      await savePassword(rememberPassword ? password : '');
      setSavedEmail(cleanEmail);
      setSavedPassword(rememberPassword ? password : '');
      setUser(u);
      setNeedsPortalChoice(isAdminUser(u));
      setAuthenticated(true);
      return u;
    },
    [baseUrl],
  );

  const updateBaseUrl = useCallback(async (url: string) => {
    const clean = url.replace(/\/+$/, '');
    setBaseUrl(clean);
    setBaseUrlState(clean);
    await AsyncStorage.setItem(STORAGE_BASE_URL, clean);
  }, []);

  const updateBasicAuth = useCallback(async (v: string) => {
    const clean = (v || '').trim();
    setBasicAuth(clean);
    setBasicAuthState(clean);
    await saveBasicAuth(clean);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      authenticated,
      user,
      isAdmin: isAdminUser(user),
      mode,
      needsPortalChoice,
      baseUrl,
      basicAuth,
      savedEmail,
      savedPassword,
      refreshUser,
      login,
      logout: doLogout,
      setMode,
      updateBaseUrl,
      updateBasicAuth,
    }),
    [ready, authenticated, user, mode, needsPortalChoice, baseUrl, basicAuth, savedEmail, savedPassword, refreshUser, login, doLogout, setMode, updateBaseUrl, updateBasicAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
