import React, { useRef } from 'react'
import { Upload, Download, Trash2, FileText, FolderOpen, ExternalLink, FileSpreadsheet, FileImage, File } from 'lucide-react'
import { api } from '../utils/api'
import './WorkspacePanel.css'

function WorkspacePanel({ 
  workspaceFiles, 
  outputFiles, 
  isOpen, 
  onToggle, 
  onUploadFile, 
  onDeleteFile,
  currentSession 
}) {
  const fileInputRef = useRef(null)
  const [isDragging, setIsDragging] = React.useState(false)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    const files = e.target.files
    if (files && files.length > 0) {
      // 支持多文件上传
      Array.from(files).forEach(file => {
        onUploadFile(file)
      })
    }
    // 重置input，允许上传同一个文件
    e.target.value = ''
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const getFileIcon = (filename) => {
    const ext = filename?.split('.').pop()?.toLowerCase()
    const iconProps = { size: 16, strokeWidth: 2 }
    
    switch (ext) {
      case 'xlsx':
      case 'xls':
      case 'csv':
        return <FileSpreadsheet {...iconProps} className="file-icon-excel" />
      case 'docx':
      case 'doc':
      case 'pdf':
      case 'txt':
        return <FileText {...iconProps} className="file-icon-doc" />
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
        return <FileImage {...iconProps} className="file-icon-image" />
      default:
        return <File {...iconProps} className="file-icon-default" />
    }
  }

  const handleOpenFile = async (filename, isOutput = false) => {
    try {
      const fileType = isOutput ? 'output' : 'workspace'
      const result = await api.openFile(currentSession.id, `${fileType}/${filename}`)
      
      if (result.success && result.file_path) {
        // 如果是 Electron 环境，使用 Electron API 打开文件
        if (window.electronAPI && window.electronAPI.openFile) {
          await window.electronAPI.openFile(result.file_path)
        } else {
          // 浏览器环境，提示用户文件路径
          alert(`文件路径：\n${result.file_path}\n\n请手动打开此文件`)
        }
      }
    } catch (error) {
      console.error('打开文件失败:', error)
      alert('打开文件失败: ' + error.message)
    }
  }

  const handleDownloadFile = (filename, isOutput = false) => {
    const fileType = isOutput ? 'output' : 'workspace'
    window.open(`/api/sessions/${currentSession.id}/files/${fileType}/${filename}`, '_blank')
  }

  // 拖拽相关处理
  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    // 只有当离开整个拖拽区域时才设置为false
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const allowedExtensions = ['.xlsx', '.xls', '.csv', '.docx', '.doc', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.txt']
      const validFiles = []
      const invalidFiles = []
      
      // 检查所有文件
      Array.from(files).forEach(file => {
        const fileExt = '.' + file.name.split('.').pop().toLowerCase()
        if (allowedExtensions.includes(fileExt)) {
          validFiles.push(file)
        } else {
          invalidFiles.push(file.name)
        }
      })
      
      // 上传有效文件
      if (validFiles.length > 0) {
        validFiles.forEach(file => {
          onUploadFile(file)
        })
      }
      
      // 提示无效文件
      if (invalidFiles.length > 0) {
        alert(`以下文件类型不支持，已跳过：\n${invalidFiles.join('\n')}\n\n支持的文件类型: ${allowedExtensions.join(', ')}`)
      }
      
      // 如果没有有效文件，提示用户
      if (validFiles.length === 0 && invalidFiles.length > 0) {
        alert(`所有文件都不支持！\n\n支持的文件类型: ${allowedExtensions.join(', ')}`)
      }
    }
  }

  if (!currentSession) {
    return (
      <div className={`workspace-panel ${isOpen ? 'open' : 'closed'}`}>
        <div className="panel-header">
          <FolderOpen size={18} />
          <span className="panel-title">工作区</span>
        </div>
        <div className="panel-content">
          <div className="no-session">
            <FolderOpen size={48} style={{ opacity: 0.3 }} />
            <p>请先创建或选择一个会话</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`workspace-panel ${isOpen ? 'open' : 'closed'}`}>
      <div className="panel-header">
        <FolderOpen size={18} />
        <span className="panel-title">工作区</span>
      </div>

      <div className="panel-content">
        {/* 输入文件区域 */}
        <div className="workspace-area">
          <div className="area-header">
            <Upload size={14} />
            <span>输入文件</span>
            <button 
              className="upload-btn" 
              onClick={handleUploadClick}
              title="上传文件"
            >
              <Upload size={14} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          <div 
            className={`file-list ${isDragging ? 'dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {workspaceFiles.length === 0 ? (
              <div className="empty-files">
                {isDragging ? (
                  <>
                    <Upload size={32} style={{ opacity: 0.5 }} />
                    <p>松开鼠标上传文件</p>
                    <p className="hint">支持多个文件同时上传</p>
                  </>
                ) : (
                  <>
                    <p>暂无输入文件</p>
                    <p className="hint">点击上方按钮或拖拽文件到此处（支持多选）</p>
                  </>
                )}
              </div>
            ) : (
              <>
                {isDragging && (
                  <div className="drag-overlay">
                    <Upload size={48} />
                    <p>松开鼠标上传文件</p>
                    <p className="hint">支持多个文件同时上传</p>
                  </div>
                )}
                {workspaceFiles.map((file, index) => (
                <div 
                  key={index} 
                  className="file-item"
                  onDoubleClick={() => handleOpenFile(file.filename, false)}
                  title="双击打开文件"
                >
                  <div className="file-icon-wrapper">{getFileIcon(file.filename)}</div>
                  <div className="file-info">
                    <div className="file-name" title={file.filename}>
                      {file.filename}
                    </div>
                    <div className="file-meta">
                      {formatFileSize(file.size)}
                    </div>
                  </div>
                  <div className="file-actions">
                    <button
                      className="action-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDownloadFile(file.filename, false)
                      }}
                      title="下载文件"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      className="action-btn delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('确定要删除这个文件吗？')) {
                          onDeleteFile(file.filepath, false)
                        }
                      }}
                      title="删除文件"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              </>
            )}
          </div>
        </div>

        {/* 输出文件区域 */}
        <div className="output-area">
          <div className="area-header">
            <Download size={14} />
            <span>输出文件</span>
            <span className="file-count">{outputFiles.length}</span>
          </div>

          <div className="file-list">
            {outputFiles.length === 0 ? (
              <div className="empty-files">
                <p>暂无输出文件</p>
                <p className="hint">执行任务后会生成输出文件</p>
              </div>
            ) : (
              outputFiles.map((file, index) => (
                <div 
                  key={index} 
                  className="file-item"
                  onDoubleClick={() => handleOpenFile(file.filename, true)}
                  title="双击打开文件"
                >
                  <div className="file-icon-wrapper">{getFileIcon(file.filename)}</div>
                  <div className="file-info">
                    <div className="file-name" title={file.filename}>
                      {file.filename}
                    </div>
                    <div className="file-meta">
                      {formatFileSize(file.size)}
                    </div>
                  </div>
                  <div className="file-actions">
                    <button
                      className="action-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDownloadFile(file.filename, true)
                      }}
                      title="下载文件"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      className="action-btn delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('确定要删除这个文件吗？')) {
                          onDeleteFile(file.filepath, true)
                        }
                      }}
                      title="删除文件"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default WorkspacePanel

