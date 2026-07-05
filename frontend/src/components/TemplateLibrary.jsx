import React, { useState, useEffect, useMemo } from 'react'
import { X, Search, Pin, PinOff, Trash2, Zap, LayoutGrid, FileText } from 'lucide-react'
import './TemplateLibrary.css'

/** 模板库：数据全部来自 /api/templates，沿用现有 tags/quality 推导逻辑；保留 modal/sidebar 两种模式与 Ctrl+T */
function TemplateLibrary({
  mode = 'modal',
  onClose,
  onUseTemplate,
  onToggleMode,
  currentSession,
}) {
  const [templates, setTemplates] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部')
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState('recent')
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
          isPopular: (template.usage_count || 0) >= 5,
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
        method: 'DELETE',
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

  /* 筛选胶囊：分类由模板 tags 动态生成 */
  const categories = useMemo(() => {
    const tagCount = new Map()
    templates.forEach(t => t.tags.forEach(tag => tagCount.set(tag, (tagCount.get(tag) || 0) + 1)))
    const sorted = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag)
    return ['全部', ...sorted.slice(0, 5)]
  }, [templates])

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
    const matchesSearch =
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))

    if (activeCategory === '全部') return matchesSearch
    return matchesSearch && template.tags.includes(activeCategory)
  })

  const iconClassFor = (template) => {
    if (template.fileTypes.includes('excel') || template.fileTypes.includes('csv')) return 'ext-xlsx'
    if (template.fileTypes.includes('word')) return 'ext-docx'
    if (template.fileTypes.includes('pdf')) return 'ext-csv'
    return 'ext-img'
  }

  const content = (
    <div className={`tpl-library ${mode}`}>
      <div className="tpl-topbar">
        {mode === 'modal' && onToggleMode && (
          <button className="tpl-icon-btn" onClick={onToggleMode} title="固定到侧边栏">
            <Pin size={15} />
          </button>
        )}
        {mode === 'sidebar' && onToggleMode && (
          <button className="tpl-icon-btn" onClick={onToggleMode} title="取消固定">
            <PinOff size={15} />
          </button>
        )}
        {mode === 'modal' && onClose && (
          <button className="tpl-icon-btn" onClick={onClose} title="关闭 (Esc)">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="tpl-scroll">
        <div className="tpl-page">
          <p className="uk-kicker tpl-kicker">模板库 · TEMPLATES</p>
          <h1 className="uk-serif tpl-title">把成功的任务，存成一键复用的模板。</h1>
          <p className="tpl-intro">每个模板记住了它需要的文件类型与处理流程。选一个模板，上传对应文件，直接开跑。</p>

          <div className="tpl-toolbar">
            <div className="tpl-search">
              <Search size={13} className="tpl-search-icon" />
              <input
                placeholder="搜索模板…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {categories.map(c => (
              <span
                key={c}
                className={`tpl-filter ${activeCategory === c ? 'on' : ''}`}
                onClick={() => setActiveCategory(c)}
              >
                {c}
              </span>
            ))}
          </div>

          <div className="tpl-sort-row uk-mono">
            <span>排序</span>
            {[
              { id: 'recent', label: '最新' },
              { id: 'usage', label: '最常用' },
              { id: 'quality', label: '质量' },
              { id: 'name', label: '名称' },
            ].map(s => (
              <span
                key={s.id}
                className={`tpl-sort ${sortBy === s.id ? 'on' : ''}`}
                onClick={() => setSortBy(s.id)}
              >
                {s.label}
              </span>
            ))}
          </div>

          {loading ? (
            <div className="tpl-empty">
              <p>加载中…</p>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="tpl-empty">
              <p>{searchQuery ? '未找到匹配的模板' : '暂无模板'}</p>
              <span>
                {searchQuery ? '尝试使用其他关键词搜索' : '完成任务后点「保存为模板」，方便下次快速复用'}
              </span>
            </div>
          ) : (
            <div className="tpl-grid">
              {filteredTemplates.map(template => (
                <div
                  key={template.id}
                  className="tpl-card"
                  onClick={() => {
                    setSelectedTemplate(template)
                    setShowPreview(true)
                  }}
                >
                  <div className="tpl-card-top">
                    <div className={`tpl-card-icon uk-file-tag ${iconClassFor(template)}`}>
                      <LayoutGrid size={16} />
                    </div>
                    <div className="tpl-card-main">
                      <div className="tpl-card-name-row">
                        <span className="tpl-card-name">{template.name}</span>
                        {template.isNew && <span className="tpl-card-new uk-mono">NEW</span>}
                      </div>
                      <div className="tpl-card-desc">{template.description}</div>
                    </div>
                    <button
                      className="tpl-card-del"
                      title="删除模板"
                      onClick={(e) => handleDeleteTemplate(template.id, e)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {template.tags.length > 0 && (
                    <div className="tpl-card-tags">
                      {template.tags.slice(0, 4).map(tag => (
                        <span key={tag} className="tpl-card-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="tpl-card-foot">
                    <span className="uk-mono">已用 {template.usage_count || 0} 次</span>
                    <span className="uk-mono">质量 {template.qualityScore}</span>
                    <span
                      className="tpl-card-use"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleUseTemplate(template.id)
                      }}
                    >
                      使用 →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
      <div className="tpl-modal-overlay" onClick={onClose}>
        <div className="tpl-modal-content" onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    )
  }

  return content
}

/** 模板预览弹窗 */
function TemplatePreview({ template, onClose, onUse }) {
  return (
    <div className="tpl-preview-overlay" onClick={onClose}>
      <div className="tpl-preview" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-preview-head">
          <h3 className="uk-serif">{template.name}</h3>
          <button className="tpl-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="tpl-preview-body">
          <div className="tpl-preview-section">
            <div className="tpl-preview-label">描述</div>
            <p>{template.description}</p>
          </div>

          <div className="tpl-preview-section">
            <div className="tpl-preview-label">统计</div>
            <div className="tpl-preview-stats uk-mono">
              <span>使用 {template.usage_count || 0} 次</span>
              <span>质量 {template.qualityScore}/100</span>
              <span>{template.created_at ? new Date(template.created_at).toLocaleDateString('zh-CN') : ''}</span>
            </div>
          </div>

          {template.file_info && template.file_info.length > 0 && (
            <div className="tpl-preview-section">
              <div className="tpl-preview-label">需要的文件</div>
              <ul className="tpl-preview-files">
                {template.file_info.map((file, index) => (
                  <li key={index}>
                    <FileText size={12} />
                    {file.filename || file.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {template.tags && template.tags.length > 0 && (
            <div className="tpl-preview-section">
              <div className="tpl-preview-label">标签</div>
              <div className="tpl-card-tags">
                {template.tags.map(tag => (
                  <span key={tag} className="tpl-card-tag">{tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="tpl-preview-foot">
          <button className="uk-ghost-btn tpl-preview-cancel" onClick={onClose}>取消</button>
          <button className="uk-gold-btn tpl-preview-use" onClick={onUse}>
            <Zap size={13} />
            立即使用
          </button>
        </div>
      </div>
    </div>
  )
}

export default TemplateLibrary
