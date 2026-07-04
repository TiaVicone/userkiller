const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

let mainWindow
let backendProcess

const isDev = process.env.NODE_ENV === 'development'
const BACKEND_PORT = 5001
const BACKEND_HEALTH_URL = `http://localhost:${BACKEND_PORT}/api/health`
const HEALTH_CHECK_INTERVAL = 500 // ms
const HEALTH_CHECK_TIMEOUT = 30000 // 30s

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    show: false
  })

  // 开发模式：加载Vite开发服务器
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
  } else {
    // 生产模式：加载打包后的文件
    mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * 健康检查：轮询后端 /api/health 直到返回 200
 */
function waitForBackendReady() {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    
    const check = () => {
      http.get(BACKEND_HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          console.log('✓ 后端服务就绪')
          resolve()
        } else {
          retry()
        }
      }).on('error', () => {
        retry()
      })
    }
    
    const retry = () => {
      if (Date.now() - startTime > HEALTH_CHECK_TIMEOUT) {
        reject(new Error('后端健康检查超时'))
        return
      }
      setTimeout(check, HEALTH_CHECK_INTERVAL)
    }
    
    check()
  })
}

function startBackend() {
  const backendPath = path.join(__dirname, '../backend')
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  
  // 开发模式：tsx watch；生产模式：node dist/index.js
  const scriptArgs = isDev ? ['run', 'dev'] : ['run', 'start']
  
  console.log(`启动后端服务 (${isDev ? '开发' : '生产'}模式)...`)
  
  backendProcess = spawn(npmCommand, scriptArgs, {
    cwd: backendPath,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' }
  })

  backendProcess.on('error', (error) => {
    console.error('后端启动失败:', error)
  })

  backendProcess.on('exit', (code) => {
    console.log(`后端进程退出，代码: ${code}`)
  })
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
}

app.whenReady().then(async () => {
  // 启动后端服务
  startBackend()
  
  try {
    // 等待后端健康检查通过
    await waitForBackendReady()
    // 创建窗口
    createWindow()
  } catch (error) {
    console.error('后端启动失败:', error)
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackend()
})

// IPC通信处理
ipcMain.handle('get-app-path', () => {
  return app.getPath('userData')
})

// 打开文件
ipcMain.handle('open-file', async (event, filePath) => {
  try {
    await shell.openPath(filePath)
    return { success: true }
  } catch (error) {
    console.error('打开文件失败:', error)
    return { success: false, error: error.message }
  }
})

// 窗口控制
ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize()
  }
})

ipcMain.handle('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.handle('close-window', () => {
  if (mainWindow) {
    mainWindow.close()
  }
})

