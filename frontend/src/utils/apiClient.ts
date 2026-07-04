import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientConfig {
  baseURL?: string
  timeout?: number
  retryAttempts?: number
  retryDelay?: number
}

export class ApiClient {
  private client: AxiosInstance
  private retryAttempts: number
  private retryDelay: number

  constructor(config: ApiClientConfig = {}) {
    const {
      baseURL = '/api',
      timeout = 30000,
      retryAttempts = 2,
      retryDelay = 1000,
    } = config

    this.retryAttempts = retryAttempts
    this.retryDelay = retryDelay

    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(this.handleError(error))
      }
    )

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config

        // 如果是超时错误且还有重试次数
        if (
          error.code === 'ECONNABORTED' &&
          originalRequest &&
          !originalRequest._retryCount
        ) {
          originalRequest._retryCount = 0
        }

        if (
          originalRequest &&
          originalRequest._retryCount < this.retryAttempts &&
          this.shouldRetry(error)
        ) {
          originalRequest._retryCount++
          await this.delay(this.retryDelay * originalRequest._retryCount)
          return this.client(originalRequest)
        }

        return Promise.reject(this.handleError(error))
      }
    )
  }

  private shouldRetry(error: AxiosError): boolean {
    // 重试条件：网络错误、超时、5xx 服务器错误
    if (!error.response) return true // 网络错误
    if (error.code === 'ECONNABORTED') return true // 超时
    if (error.response.status >= 500) return true // 服务器错误
    return false
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private handleError(error: any): ApiError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<any>

      // 网络错误
      if (!axiosError.response) {
        if (axiosError.code === 'ECONNABORTED') {
          return new ApiError('请求超时，请稍后重试', undefined, error)
        }
        return new ApiError('网络连接失败，请检查网络设置', undefined, error)
      }

      // HTTP 错误
      const status = axiosError.response.status
      const data = axiosError.response.data

      let message = data?.error || data?.message || axiosError.message

      switch (status) {
        case 400:
          message = `请求参数错误：${message}`
          break
        case 401:
          message = '未授权，请重新登录'
          break
        case 403:
          message = '没有权限访问该资源'
          break
        case 404:
          message = `资源不存在：${message}`
          break
        case 500:
          message = `服务器错误：${message}`
          break
        case 502:
        case 503:
        case 504:
          message = '服务暂时不可用，请稍后重试'
          break
        default:
          message = `请求失败：${message}`
      }

      return new ApiError(message, status, error)
    }

    // 非 Axios 错误
    return new ApiError(
      error?.message || '未知错误',
      undefined,
      error
    )
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config)
    return response.data
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.post<T>(url, data, config)
    return response.data
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.put<T>(url, data, config)
    return response.data
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config)
    return response.data
  }

  async upload<T = any>(
    url: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<T> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await this.client.post<T>(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          )
          onProgress(progress)
        }
      },
    })

    return response.data
  }

  async download(url: string, filename?: string): Promise<void> {
    const response = await this.client.get(url, {
      responseType: 'blob',
    })

    const blob = new Blob([response.data])
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = filename || url.split('/').pop() || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(downloadUrl)
  }
}

// 创建默认实例
export const apiClient = new ApiClient({
  timeout: 30000,
  retryAttempts: 2,
  retryDelay: 1000,
})
