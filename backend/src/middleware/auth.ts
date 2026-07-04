import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, ensureDir } from '../fsUtils.js'

const USERS_FILE = path.join(DATA_DIR, 'users.json')
const JWT_EXPIRY = '24h'
const REFRESH_EXPIRY = '7d'

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    console.warn('[auth] JWT_SECRET not set, using auto-generated secret (will invalidate on restart)')
    // Fallback: generate a stable secret per-process (not suitable for multi-instance)
    if (!(globalThis as any).__jwtFallbackSecret) {
      (globalThis as any).__jwtFallbackSecret = crypto.randomBytes(64).toString('hex')
    }
    return (globalThis as any).__jwtFallbackSecret
  }
  return secret
}

export interface UserRecord {
  id: string
  username: string
  passwordHash: string
  role: 'admin' | 'user'
  createdAt: string
  lastLogin?: string
}

export interface AuthPayload {
  userId: string
  username: string
  role: 'admin' | 'user'
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

async function loadUsers(): Promise<UserRecord[]> {
  try {
    const content = await fs.readFile(USERS_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

async function saveUsers(users: UserRecord[]): Promise<void> {
  await ensureDir(DATA_DIR)
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8')
}

export async function createUser(username: string, password: string, role: 'admin' | 'user' = 'user'): Promise<UserRecord> {
  const users = await loadUsers()
  if (users.some(u => u.username === username)) {
    throw new Error('用户名已存在')
  }
  const passwordHash = await bcrypt.hash(password, 12)
  const user: UserRecord = {
    id: crypto.randomUUID(),
    username,
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  await saveUsers(users)
  return user
}

export async function verifyCredentials(username: string, password: string): Promise<UserRecord | null> {
  const users = await loadUsers()
  const user = users.find(u => u.username === username)
  if (!user) return null
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) return null

  user.lastLogin = new Date().toISOString()
  await saveUsers(users)
  return user
}

export function generateTokens(user: UserRecord): { accessToken: string; refreshToken: string } {
  const payload: AuthPayload = { userId: user.id, username: user.username, role: user.role }
  const secret = getJwtSecret()
  const accessToken = jwt.sign(payload, secret, { expiresIn: JWT_EXPIRY })
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, secret, { expiresIn: REFRESH_EXPIRY })
  return { accessToken, refreshToken }
}

export function verifyToken(token: string): AuthPayload {
  const secret = getJwtSecret()
  return jwt.verify(token, secret) as AuthPayload
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for login/register/health endpoints (paths already rewritten from /api/v1/*)
  const openPaths = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/health']
  if (openPaths.includes(req.path)) {
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: '未提供认证令牌', code: 'AUTH_REQUIRED' })
    return
  }

  const token = authHeader.slice(7)
  try {
    const payload = verifyToken(token)
    req.user = payload
    next()
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: '令牌已过期，请重新登录', code: 'TOKEN_EXPIRED' })
    } else {
      res.status(401).json({ error: '令牌无效', code: 'TOKEN_INVALID' })
    }
  }
}

export async function ensureDefaultAdmin(): Promise<void> {
  const users = await loadUsers()
  if (users.length > 0) return

  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'changeme123'
  await createUser('admin', defaultPassword, 'admin')
  console.log('[auth] Created default admin user (username: admin). Change the password immediately.')
}
