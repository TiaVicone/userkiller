import path from 'node:path'
import { extractWordText, extractWordTables } from './extract.js'

export async function summarizeVoteStatisticsFromDocuments(filePaths: string[]) {
  const candidateScores = new Map<string, number>()
  const fileSummaries: Array<{ 
    file: string
    candidates: string[]
    matchedLines: string[]
    tablePreview?: string[][]
    extractedVotes?: Array<{ name: string; level: string }> 
  }> = []

  for (const filePath of filePaths) {
    const extracted = await extractWordText(filePath)
    const tables = await extractWordTables(filePath)
    const lines = extracted.text.split(/\n+/).map(line => line.trim()).filter(Boolean)
    const matchedLines = lines.filter(line => /优秀|合格|基本合格|不合格|得票|票数|投票|评议/.test(line)).slice(0, 20)
    const candidates = new Set<string>()
    const extractedVotes: Array<{ name: string; level: string }> = []

    for (const table of tables) {
      const tableVotes = extractVotesFromTable(table)
      for (const vote of tableVotes) {
        candidates.add(vote.name)
        extractedVotes.push(vote)
        candidateScores.set(vote.name, (candidateScores.get(vote.name) || 0) + scoreFromLevel(vote.level))
      }
    }

    if (!extractedVotes.length) {
      for (const line of matchedLines) {
        const nameMatches = [...line.matchAll(/[\u4e00-\u9fff]{2,4}/g)].map(match => match[0])
        for (const name of nameMatches) {
          if (!isLikelyChineseName(name)) continue
          candidates.add(name)
          candidateScores.set(name, (candidateScores.get(name) || 0) + inferScoreFromLine(line))
        }
      }
    }

    fileSummaries.push({
      file: path.basename(filePath),
      candidates: [...candidates],
      matchedLines,
      tablePreview: tables[0]?.slice(0, 5),
      extractedVotes: extractedVotes.slice(0, 80),
    })
  }

  const ranking = [...candidateScores.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN'))

  return {
    fileCount: filePaths.length,
    candidateCount: ranking.length,
    ranking,
    fileSummaries,
  }
}

function extractVotesFromTable(table: string[][]): Array<{ name: string; level: string }> {
  const votes: Array<{ name: string; level: string }> = []
  const levels = ['优秀', '合格', '基本合格', '不合格']

  for (const row of table) {
    const cells = row.map(cell => cell.trim()).filter(cell => cell !== '')
    if (!cells.length) continue

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]
      if (!isLikelyChineseName(cell)) continue

      const windowCells = cells.slice(index + 1, index + 6)
      const detectedLevel = levels.find(level => 
        windowCells.some(item => item === level || item.includes(`√${level}`) || item.includes(`${level}√`) || item.includes(`(${level})`))
      )
      if (detectedLevel) {
        votes.push({ name: cell, level: detectedLevel })
        continue
      }

      const checkOffset = windowCells.findIndex(item => item.includes('√'))
      if (checkOffset >= 0 && levels[checkOffset]) {
        votes.push({ name: cell, level: levels[checkOffset] })
      }
    }
  }

  return dedupeVotes(votes)
}

function dedupeVotes(votes: Array<{ name: string; level: string }>): Array<{ name: string; level: string }> {
  const seen = new Set<string>()
  return votes.filter(vote => {
    const key = `${vote.name}::${vote.level}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isLikelyChineseName(value: string): boolean {
  if (!/^[\u4e00-\u9fff]{2,4}$/.test(value)) return false
  return !/大学|团员|教育|评议|评分|情况|支部|优秀|合格|基本|不合格|班级|序号|姓名|注释|综合|评价|理想|信念|义务|成绩|作用/.test(value)
}

function scoreFromLevel(level: string): number {
  if (level.includes('优秀')) return 4
  if (level.includes('基本合格')) return 2
  if (level.includes('合格')) return 3
  if (level.includes('不合格')) return 1
  return 0
}

function inferScoreFromLine(line: string): number {
  let score = 0
  if (/优秀/.test(line)) score += 3
  if (/合格/.test(line)) score += 1
  if (/基本合格/.test(line)) score += 0.5
  if (/不合格/.test(line)) score -= 1
  if (/得票|票数|投票/.test(line)) score += 2
  return score || 1
}
