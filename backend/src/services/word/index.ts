// Word module facade - exports all Word-related functionality

// Type exports
export type {
  WordBlock,
  WordDocumentStructure,
  WordPatch,
  WordPatchOp,
  WordPatchApplyResult,
  ExtractedWordField,
  WordTemplateSlot,
  WordTableInspection,
  ParagraphNode,
  TableNode,
  TemplateFillTarget,
} from './types.js'

// Core extraction functions
export {
  extractWordStructure,
  extractWordText,
  extractWordTextWithMarkItDown,
  extractWordTables,
  parseDocumentParagraphs,
  parseDocumentTables,
} from './core/extract.js'

// Core patching functions
export {
  applyWordPatches,
  replaceParagraphTextNode,
  replaceTableCellTextNode,
} from './core/patch.js'

// Core template functions
export {
  matchWordFieldsToTemplate,
  fillWordTemplateFromMapping,
} from './core/template.js'

// Core conversion functions
export {
  detectWordFormat,
  convertLegacyWordToDocx,
} from './core/convert.js'

// Core inspection functions
export {
  inspectWordTables,
  extractWordFieldValues,
  inspectWordTemplateSlots,
} from './core/inspect.js'

// Vote statistics
export { summarizeVoteStatisticsFromDocuments } from './core/vote.js'

// Utility functions
export {
  normalizeWordCell,
  normalizeWordLabel,
  escapeXmlText,
  decodeXmlText,
  looksLikeHeaderCell,
  getParagraphIndexFromBlockId,
  getTableIndexFromBlockId,
  extractTextFromParagraphXml,
  extractTextFromTableCellXml,
  splitMergedLabels,
  extractTemplateLabel,
  normalizeExtractedFieldName,
  isLikelyFieldValue,
  isLikelyFieldValueForLabel,
  splitMarkdownTableCells,
  splitMergedFieldValues,
  extractInlineFieldValue,
  scoreFieldSlotMatch,
} from './core/utils.js'
