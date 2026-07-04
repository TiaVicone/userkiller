import { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'

export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试', code: 'RATE_LIMIT_EXCEEDED' },
  keyGenerator: (req: Request) => {
    return req.user?.userId || req.ip || 'anonymous'
  },
})

export const executeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '执行请求过于频繁，请稍后再试', code: 'EXECUTE_RATE_LIMIT' },
  keyGenerator: (req: Request) => {
    return req.user?.userId || req.ip || 'anonymous'
  },
})

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '上传请求过于频繁，请稍后再试', code: 'UPLOAD_RATE_LIMIT' },
  keyGenerator: (req: Request) => {
    return req.user?.userId || req.ip || 'anonymous'
  },
})

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过多，请 15 分钟后再试', code: 'AUTH_RATE_LIMIT' },
  keyGenerator: (req: Request) => {
    return req.ip || 'anonymous'
  },
})
