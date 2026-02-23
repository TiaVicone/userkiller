import React, { useState, useEffect } from 'react'
import { 
  X, Search, Star, Clock, FileText, Pin, PinOff, Eye, Edit2, Trash2, Plus,
  Download, Copy, Tag, TrendingUp, Filter, SortAsc, Calendar,
  CheckCircle, AlertCircle, Sparkles, Zap, BookOpen
} from 'lucide-react'
import './TemplateLibrary.css'

function TemplateLibrary({ 
  mode = 'modal',
  onClose, 
  onUseTemplate, 
  onToggleMode,
  currentSession 
}) {
  const [templates, setTemplates] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState('recent')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    loadTemplates()
  }, [])

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/templates')
      const data = await response.json()
      
      const processedTemplates = (data.templates || []).map(template => {
        const tags = []
        const fileTypes = new Set()
        
        if (template.file_info) {
          template.file_info.forEach(f => {
            const filename = f.filename || f.name || ''
            const ext = filename.toLowerCase().split('.').pop()
            
            if (['xlsx', 'xls'].includes(ext)) {
              tags.push('Excel')
              fileTypes.add('excel')
            } else if (['docx', 'doc'].includes(ext)) {
              tags.push('Word')
              fileTypes.add('word')
            } else if (ext === 'pdf') {
              tags.push('PDF')
              fileTypes.add('pdf')
            } else if (ext === 'csv') {
              tags.push('CSV')
              fileTypes.add('csv')
            }
          })
        }
        
        const desc = (template.description || template.task_description || '').toLowerCase()
        if (desc.includes('填写') || desc.includes('表格')) tags.push('表格填写')
        if (desc.includes('汇总') || desc.includes('统计') || desc.includes('分析')) tags.push('数据分析')
        if (desc.includes('生成') || desc.includes('创建')) tags.push('文档生成')
        if (desc.includes('合并') || desc.includes('整合')) tags.push('数据合并')
        if (desc.includes('转换') || desc.includes('导出')) tags.push('格式转换')
        if (desc.includes('批量')) tags.push('批量处理')
        
        const qualityScore = calculateQualityScore(template)
        
        return {
          ...template,
          name: template.name || template.task_description || '未命名模板',
          description: template.description || template.task_description || '暂无描述',
          tags: [...new Set(tags)],
          fileTypes: Array.from(fileTypes),
          qualityScore,
          isNew: isNewTemplate(template.created_at),
          isPopular: (template.usage_count || 0) >= 5
        }
      })
      
      setTemplates(processedTemplates)
    } catch (error) {
      console.error('加载模板失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateQualityScore = (template) => {
    let score = 50
    score += Math.min((template.usage_count || 0) * 5, 30)
    if (template.description && template.description.length > 10) score += 10
    if (template.file_info && template.file_info.length > 0) score += 10
    return Math.min(score, 100)
  }

  const isNewTemplate = (createdAt) => {
    if (!createdAt) return false
    const created = new Date(createdAt)
    const now = new Date()
    const daysDiff = (now - created) / (1000 * 60 * 60 * 24)
    return daysDiff <= 7
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

  const handleDeleteTemplate = async (templateId, e) => {
    e.stopPropagation()
    
    if (!confirm('确定要删除这个模板吗？此操作不可恢复。')) return

    try {
      const response = await fetch(`/api/templates/${templateId}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setTemplates(templates.filter(t => t.id !== templateId))
        if (selectedTemplate?.id === templateId) {
          setSelectedTemplate(null)
          setShowPreview(false)
        }
      }
    } catch (error) {
      console.error('删除模板失败:', error)
      alert('删除失败，请重试')
    }
  }

  const handlePreviewTemplate = (template, e) => {
    e.stopPropagation()
    setSelectedTemplate(template)
    setShowPreview(true)
  }

  const sortedTemplates = [...templates].sort((a, b) => {
    switch (sortBy) {
      case 'usage':
        return (b.usage_count || 0) - (a.usage_count || 0)
      case 'name':
        return a.name.localeCompare(b.name)
      case 'quality':
        return b.qualityScore - a.qualityScore
      case 'recent':
      default:
        return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    }
  })

  const filteredTemplates = sortedTemplates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    
    if (activeCategory === 'all') return matchesSearch
    if (activeCategory === 'new') return matchesSearch && template.isNew
    if (activeCategory === 'popular') return matchesSearch && template.isPopular
    
    if (['excel', 'word', 'pdf', 'csv'].includes(activeCategory)) {
      return matchesSearch && template.fileTypes.includes(activeCategory)
    }
    
    return matchesSearch && template.tags.some(tag => 
      tag.toLowerCase().includes(activeCategory.toLowerCase())
    )
  })

  const categories = [
    { id: 'all', name: '全部', icon: '📚', count: templates.length },
    { id: 'new', name: '最新', icon: '✨', count: templates.filter(t => t.isNew).length },
    { id: 'popular', name: '热门', icon: '🔥', count: templates.filter(t => t.isPopular).length },
    { id: 'excel', name: 'Excel', icon: '📊', count: templates.filter(t => t.fileTypes.includes('excel')).length },
    { id: 'word', name: 'Word', icon: '📄', count: templates.filter(t => t.fileTypes.includes('word')).length },
    { id: 'pdf', name: 'PDF', icon: '📕', count: templates.filter(t => t.fileTypes.includes('pdf')).length },
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

  const formatDate = (timestamp) => {
    if (!timestamp) return '未知'
    const date = new Date(timestamp)
    return date.toLocaleDateString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    })
  }

  const getQualityBadge = (score) => {
    if (score >= 80) return { text: '优质', color: '#00d4aa', icon: '⭐' }
    if (score >= 60) return { text: '良好', color: '#ffb44d', icon: '👍' }
    return { text: '一般', color: '#888', icon: '📝' }
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
          <button 
            className={`icon-btn ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
            title="筛选和排序"
          >
            <Filter size={18} />
          </button>
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

      {/* 主体区域 - 侧边栏布局 */}
      <div className="library-body">
        {/* 左侧分类栏 */}
        <div className="category-sidebar">
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
        </div>

        {/* 右侧内容区 */}
        <div className="content-area">
          {/* 搜索和排序 */}
          <div className="search-section">
            <div className="search-bar">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="搜索模板名称、描述或标签..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {showFilters && (
              <div className="filter-options">
                <div className="filter-group">
                  <label>排序方式</label>
                  <div className="sort-buttons">
                    <button 
                      className={`sort-btn ${sortBy === 'recent' ? 'active' : ''}`}
                      onClick={() => setSortBy('recent')}
                    >
                      <Clock size={14} />
                      最新
                    </button>
                    <button 
                      className={`sort-btn ${sortBy === 'usage' ? 'active' : ''}`}
                      onClick={() => setSortBy('usage')}
                    >
                      <TrendingUp size={14} />
                      最常用
                    </button>
                    <button 
                      className={`sort-btn ${sortBy === 'quality' ? 'active' : ''}`}
                      onClick={() => setSortBy('quality')}
                    >
                      <Star size={14} />
                      质量
                    </button>
                    <button 
                      className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                      onClick={() => setSortBy('name')}
                    >
                      <SortAsc size={14} />
                      名称
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 模板列表 - 添加滚动 */}
          <div className="templates-list">
            {loading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>加载中...</p>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  {searchQuery ? '🔍' : '📭'}
                </div>
                <p>{searchQuery ? '未找到匹配的模板' : '暂无模板'}</p>
                <span>
                  {searchQuery 
                    ? '尝试使用其他关键词搜索' 
                    : '完成任务后保存为模板，方便下次快速复用'}
                </span>
              </div>
            ) : (
              filteredTemplates.map(template => {
                const quality = getQualityBadge(template.qualityScore)
                
                return (
                  <div 
                    key={template.id} 
                    className="template-card"
                    onClick={() => handlePreviewTemplate(template, { stopPropagation: () => {} })}
                  >
                    <div className="template-header">
                      <div className="template-title-row">
                        <Star size={18} className="template-icon" />
                        <h4 className="template-name">{template.name}</h4>
                      </div>
                      <div className="template-badges">
                        {template.isNew && (
                          <span className="badge badge-new">
                            <Sparkles size={12} />
                            新
                          </span>
                        )}
                        {template.isPopular && (
                          <span className="badge badge-popular">
                            <Zap size={12} />
                            热门
                          </span>
                        )}
                        <span 
                          className="badge badge-quality"
                          style={{ background: `${quality.color}20`, color: quality.color }}
                        >
                          {quality.icon} {quality.text}
                        </span>
                      </div>
                    </div>

                    <p className="template-desc">{template.description}</p>

                    <div className="template-meta">
                      <span className="meta-item">
                        <TrendingUp size={14} />
                        使用 {template.usage_count || 0} 次
                      </span>
                      <span className="meta-item">
                        <Clock size={14} />
                        {formatTime(template.last_used || template.created_at)}
                      </span>
                    </div>

                    {template.tags && template.tags.length > 0 && (
                      <div className="template-tags">
                        {template.tags.slice(0, 3).map((tag, index) => (
                          <span key={index} className="tag">
                            <Tag size={10} />
                            {tag}
                          </span>
                        ))}
                        {template.tags.length > 3 && (
                          <span className="tag tag-more">+{template.tags.length - 3}</span>
                        )}
                      </div>
                    )}

                    <div className="template-actions">
                      <button
                        className="btn-primary btn-use"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleUseTemplate(template.id)
                        }}
                      >
                        <Zap size={14} />
                        立即使用
                      </button>
                      <button 
                        className="btn-secondary btn-preview"
                        onClick={(e) => handlePreviewTemplate(template, e)}
                      >
                        <Eye size={14} />
                        预览
                      </button>
                      <button 
                        className="btn-icon btn-delete"
                        onClick={(e) => handleDeleteTemplate(template.id, e)}
                        title="删除模板"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* 底部统计信息 */}
      {templates.length > 0 && (
        <div className="library-footer">
          <div className="footer-stats">
            <div className="stat-item">
              <BookOpen size={16} />
              <span>{templates.length} 个模板</span>
            </div>
            <div className="stat-item">
              <TrendingUp size={16} />
              <span>{templates.reduce((sum, t) => sum + (t.usage_count || 0), 0)} 次使用</span>
            </div>
          </div>
        </div>
      )}

      {/* 模板预览弹窗 */}
      {showPreview && selectedTemplate && (
        <TemplatePreview
          template={selectedTemplate}
          onClose={() => {
            setShowPreview(false)
            setSelectedTemplate(null)
          }}
          onUse={() => handleUseTemplate(selectedTemplate.id)}
        />
      )}
    </div>
  )

  if (mode === 'modal') {
    return (
      <div className="template-modal-overlay" onClick={onClose}>
        <div className="template-modal-content" onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    )
  }

  return content
}

// 模板预览组件
function TemplatePreview({ template, onClose, onUse }) {
  const quality = template.qualityScore >= 80 ? '优质' : template.qualityScore >= 60 ? '良好' : '一般'
  
  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-content" onClick={(e) => e.stopPropagation()}>
        <div className="preview-header">
          <h3>{template.name}</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="preview-body">
          <div className="preview-section">
            <h4>📝 描述</h4>
            <p>{template.description}</p>
          </div>
          
          <div className="preview-section">
            <h4>📊 统计信息</h4>
            <div className="preview-stats">
              <div className="stat">
                <span className="stat-label">使用次数</span>
                <span className="stat-value">{template.usage_count || 0}</span>
              </div>
              <div className="stat">
                <span className="stat-label">质量评分</span>
                <span className="stat-value">{template.qualityScore}/100</span>
              </div>
              <div className="stat">
                <span className="stat-label">创建时间</span>
                <span className="stat-value">
                  {new Date(template.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
          
          {template.file_info && template.file_info.length > 0 && (
            <div className="preview-section">
              <h4>📁 需要的文件</h4>
              <ul className="file-list">
                {template.file_info.map((file, index) => (
                  <li key={index}>
                    <FileText size={14} />
                    {file.filename || file.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {template.tags && template.tags.length > 0 && (
            <div className="preview-section">
              <h4>🏷️ 标签</h4>
              <div className="template-tags">
                {template.tags.map((tag, index) => (
                  <span key={index} className="tag">
                    <Tag size={10} />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="preview-footer">
          <button className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={onUse}>
            <Zap size={16} />
            立即使用
          </button>
        </div>
      </div>
    </div>
  )
}

export default TemplateLibrary
