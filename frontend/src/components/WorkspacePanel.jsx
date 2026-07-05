import React, { useRef } from 'react'
import { Upload, Download, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../utils/api'
import { extOf, extClass, formatFileSize } from '../utils/ui'
import './WorkspacePanel.css'

/** 中栏：工作区文件面板（可收起为 44px 竖条），上传/聚焦/打开/下载逻辑保持不变 */
function WorkspacePanel({
  workspaceFiles,
  outputFiles,
  isOpen,
  onToggle,
  onUploadFile,
  onDeleteFile,
  currentSession,
  focusedFile,
  onFocusFile,
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

  const handleOpenFile = async (filename, isOutput = false) => {
    try {
      const fileType = isOutput ? 'output' : 'workspace'
      const result = await api.session.openFile(currentSession.id, `${fileType}/${filename}`)

      if (result.success && result.file_path) {
        // 如果是 Electron 环境，使用 Electron API 打开文件
        if (window.electronAPI && window.electronAPI.openFile) {
          await window.electronAPI.openFile(result.file_path)
        }
        // 浏览器环境下静默失败，不显示提示
      }
    } catch (error) {
      console.error('打开文件失败:', error)
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

      Array.from(files).forEach(file => {
        const fileExt = '.' + file.name.split('.').pop().toLowerCase()
        if (allowedExtensions.includes(fileExt)) {
          validFiles.push(file)
        } else {
          invalidFiles.push(file.name)
        }
      })

      if (validFiles.length > 0) {
        validFiles.forEach(file => {
          onUploadFile(file)
        })
      }

      if (invalidFiles.length > 0) {
        alert(`以下文件类型不支持，已跳过：\n${invalidFiles.join('\n')}\n\n支持的文件类型: ${allowedExtensions.join(', ')}`)
      }

      if (validFiles.length === 0 && invalidFiles.length > 0) {
        alert(`所有文件都不支持！\n\n支持的文件类型: ${allowedExtensions.join(', ')}`)
      }
    }
  }

  const visibleOutputFiles = (outputFiles || []).filter(
    file => !['task-plan.md', 'document-structure-summary.json'].includes(file.name)
  )
  const fileTotal = (workspaceFiles || []).length + visibleOutputFiles.length

  /* ─ 收起态：44px 竖条 ─ */
  if (!isOpen) {
    return (
      <aside className="wp-collapsed" title="展开工作区文件" onClick={onToggle}>
        <span className="wp-collapsed-btn">
          <ChevronRight size={11} />
        </span>
        <span className="wp-collapsed-label">工作区文件</span>
        <span className="wp-collapsed-count uk-mono">{fileTotal}</span>
      </aside>
    )
  }

  return (
    <aside className="wp-panel">
      <div className="wp-header">
        <span className="wp-title">工作区文件</span>
        <span className="wp-total uk-mono">{fileTotal}</span>
        <button className="wp-collapse-btn" title="收起" onClick={onToggle}>
          <ChevronLeft size={11} />
        </button>
      </div>

      <div className="wp-body">
        {!currentSession ? (
          <div className="wp-empty">
            <p>请先创建或选择一个会话</p>
          </div>
        ) : (
          <>
            {/* 上传 dropzone */}
            <div
              className={`wp-dropzone ${isDragging ? 'dragging' : ''}`}
              onClick={handleUploadClick}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <span className="wp-dropzone-icon">
                <Upload size={14} />
              </span>
              <div>
                <div className="wp-dropzone-title">{isDragging ? '松开上传（支持多选）' : '拖拽或点击上传'}</div>
                <div className="wp-dropzone-hint uk-mono">xlsx · docx · csv · pdf …</div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            {/* 输入文件 */}
            <div className="wp-section-head">
              <span className="wp-section-title">输入文件</span>
              <span className="wp-section-count uk-mono">{workspaceFiles.length}</span>
            </div>
            <div
              className="wp-input-list"
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {workspaceFiles.length === 0 ? (
                <div className="wp-empty-files">
                  <p>暂无输入文件</p>
                  <p className="wp-empty-hint">拖拽文件到此处，或点击上方上传（支持多选）</p>
                </div>
              ) : (
                workspaceFiles.map((file, index) => {
                  const focused = focusedFile === file.name
                  return (
                    <div
                      key={index}
                      className={`wp-file ${focused ? 'focused' : ''}`}
                      title="单击聚焦 · 双击打开"
                      onClick={() => onFocusFile && onFocusFile(focused ? '' : file.name)}
                      onDoubleClick={() => handleOpenFile(file.name, false)}
                    >
                      <span className={`uk-file-tag wp-file-tag ${extClass(file.name)}`}>{extOf(file.name)}</span>
                      <div className="wp-file-info">
                        <div className="wp-file-name">{file.name}</div>
                        <div className="wp-file-meta uk-mono">{formatFileSize(file.size)}</div>
                      </div>
                      {focused && <span className="wp-focus-chip">聚焦</span>}
                      <div className="wp-file-actions">
                        <button
                          className="wp-icon-btn"
                          title="下载文件"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownloadFile(file.name, false)
                          }}
                        >
                          <Download size={12} />
                        </button>
                        <button
                          className="wp-icon-btn danger"
                          title="删除文件"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm('确定要删除这个文件吗？')) {
                              onDeleteFile(`workspace/${file.name}`, false)
                            }
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* 输出文件 */}
            <div className="wp-section-head">
              <span className="wp-section-title">输出文件</span>
              <span className="wp-section-count uk-mono">{visibleOutputFiles.length}</span>
              {visibleOutputFiles.length > 0 && (
                <span className="wp-deliverable">
                  <span className="wp-deliverable-dot" />
                  可交付
                </span>
              )}
            </div>
            {visibleOutputFiles.length === 0 ? (
              <div className="wp-empty-files">
                <p>暂无输出文件</p>
                <p className="wp-empty-hint">执行任务后会生成输出文件</p>
              </div>
            ) : (
              visibleOutputFiles.map((file, index) => (
                <div key={index} className="wp-output" onDoubleClick={() => handleOpenFile(file.name, true)}>
                  <div className="wp-output-row">
                    <span className={`uk-file-tag wp-file-tag ${extClass(file.name)}`}>{extOf(file.name)}</span>
                    <div className="wp-file-info">
                      <div className="wp-file-name">{file.name}</div>
                      <div className="wp-file-meta uk-mono">{formatFileSize(file.size)}</div>
                    </div>
                    <button
                      className="wp-icon-btn danger"
                      title="删除文件"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('确定要删除这个文件吗？')) {
                          onDeleteFile(`output/${file.name}`, true)
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="wp-output-actions">
                    <button className="wp-open-btn" onClick={() => handleOpenFile(file.name, true)}>打开</button>
                    <button className="wp-download-btn" onClick={() => handleDownloadFile(file.name, true)}>下载</button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  )
}

export default WorkspacePanel
