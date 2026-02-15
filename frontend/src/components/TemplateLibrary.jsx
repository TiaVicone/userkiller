import React, { useState, useEffect } from 'react'
import { X, Search, Star, Clock, FileText, Pin, PinOff, Eye, Edit2, Trash2, Plus } from 'lucide-react'
import './TemplateLibrary.css'

function TemplateLibrary({ 
  mode = 'modal', // 'modal' | 'sidebar'
  onClose, 
  onUseTemplate, 
  onToggleMode,
  currentSession 
}) {
  const [templates, setTemplates] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadTemplates()
  }, [])

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/templates')
      const data = await response.json()
      
      // 处理模板数据，添加标签
      const processedTemplates = (data.templates || []).map(template => {
        // 根据文件类型自动添加标签
        const tags = []
        
        if (template.file_info) {
          const hasExcel = template.file_info.some(f => 
            f.filename?.toLowerCase().endsWith('.xlsx') || 
            f.filename?.toLowerCase().endsWith('.xls')
          )
          const hasWord = template.file_info.some(f => 
            f.filename?.toLowerCase().endsWith('.docx') || 
            f.filename?.toLowerCase().endsWith('.doc')
          )
          const hasPdf = template.file_info.some(f => 
            f.filename?.toLowerCase().endsWith('.pdf')
          )
          
          if (hasExcel) tags.push('data')
          if (hasWord) tags.push('document')
          if (hasPdf) tags.push('document')
        }
        
        // 根据任务描述添加标签
        const desc = template.task_description?.toLowerCase() || ''
        if (desc.includes('填写') || desc.includes('表格')) tags.push('form')
        if (desc.includes('汇总') || desc.includes('统计')) tags.push('data')
        if (desc.includes('生成') || desc.includes('创建')) tags.push('document')
        
        return {
          ...template,
          name: template.task_description || '未命名模板',
          description: template.task_description || '暂无描述',
          tags: [...new Set(tags)] // 去重
        }
      })
      
      setTemplates(processedTemplates)
    } catch (error) {
      console.error('加载模板失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUseTemplate = async (templateId) => {
    if (!currentSession) {
      alert('请先创建或选择一个会话')
      return
    }

    if (onUseTemplate) {
      onUseTemplate(templateId)
    }
    
    if (mode === 'modal' && onClose) {
      onClose()
    }
  }

  const handleDeleteTemplate = async (templateId) => {
    if (!confirm('确定要删除这个模板吗？')) return

    try {
      const response = await fetch(`/api/templates/${templateId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setTemplates(templates.filter(t => t.id !== templateId))
      }
    } catch (error) {
      console.error('删除模板失败:', error)
    }
  }

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchQuery.toLowerCase())
    
    if (activeCategory === 'all') return matchesSearch
    
    // 简单的分类逻辑（可以后续优化）
    const tags = template.tags || []
    return matchesSearch && tags.includes(activeCategory)
  })

  const categories = [
    { id: 'all', name: '全部', icon: '📚', count: templates.length },
    { id: 'data', name: '数据处理', icon: '📊', count: templates.filter(t => t.tags?.includes('data')).length },
    { id: 'document', name: '文档生成', icon: '📄', count: templates.filter(t => t.tags?.includes('document')).length },
    { id: 'form', name: '表格填写', icon: '📋', count: templates.filter(t => t.tags?.includes('form')).length },
  ]

  const formatTime = (timestamp) => {
    if (!timestamp) return '从未使用'
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now - date
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    if (days < 30) return `${Math.floor(days / 7)}周前`
    return `${Math.floor(days / 30)}个月前`
  }

  const content = (
    <div className={`template-library ${mode}`}>
      {/* 头部 */}
      <div className="library-header">
        <div className="header-left">
          <h3>📚 模板库</h3>
          <span className="template-count">{templates.length} 个模板</span>
        </div>
        <div className="header-actions">
          {mode === 'modal' && onToggleMode && (
            <button 
              className="icon-btn pin-btn" 
              onClick={onToggleMode}
              title="固定到侧边栏"
            >
              <Pin size={18} />
            </button>
          )}
          {mode === 'sidebar' && onToggleMode && (
            <button 
              className="icon-btn unpin-btn" 
              onClick={onToggleMode}
              title="取消固定"
            >
              <PinOff size={18} />
            </button>
          )}
          {mode === 'modal' && onClose && (
            <button className="icon-btn close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="search-section">
        <div className="search-bar">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="搜索模板..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 分类标签 */}
      <div className="category-tabs">
        {categories.map(category => (
          <button
            key={category.id}
            className={`category-tab ${activeCategory === category.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(category.id)}
          >
            <span className="category-icon">{category.icon}</span>
            <span className="category-name">{category.name}</span>
            <span className="category-count">({category.count})</span>
          </button>
        ))}
      </div>

      {/* 模板列表 */}
      <div className="templates-list">
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>加载中...</p>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>暂无模板</p>
            <span>完成任务后保存为模板，方便下次快速复用</span>
          </div>
        ) : (
          filteredTemplates.map(template => (
            <div key={template.id} className="template-card">
              <div className="template-header">
                <Star size={18} className="template-icon" />
                <h4 className="template-name">{template.name}</h4>
              </div>

              <p className="template-desc">{template.description}</p>

              <div className="template-meta">
                <span className="meta-item">
                  <FileText size={14} />
                  使用 {template.usage_count || 0}次
                </span>
                <span className="meta-item">
                  <Clock size={14} />
                  {formatTime(template.last_used)}
                </span>
              </div>

              {template.tags && template.tags.length > 0 && (
                <div className="template-tags">
                  {template.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}

              <div className="template-actions">
                <button
                  className="btn-primary btn-use"
                  onClick={() => handleUseTemplate(template.id)}
                >
                  🚀 使用
                </button>
                <button className="btn-secondary btn-preview">
                  <Eye size={14} />
                  预览
                </button>
                <button className="btn-icon btn-more">
                  <Edit2 size={14} />
                </button>
                <button 
                  className="btn-icon btn-delete"
                  onClick={() => handleDeleteTemplate(template.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 新建模板按钮 */}
      <div className="library-footer">
        <button className="create-template-btn">
          <Plus size={18} />
          新建模板
        </button>
      </div>
    </div>
  )

  // 弹窗模式
  if (mode === 'modal') {
    return (
      <div className="template-modal-overlay" onClick={onClose}>
        <div className="template-modal-content" onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    )
  }

  // 侧边栏模式
  return content
}

export default TemplateLibrary

