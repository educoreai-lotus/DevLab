import { getFetch } from '../utils/http.js'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo'

const parseJsonResponse = (raw) => {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    // Remove markdown code fences if present
    const withoutFence = trimmed.startsWith('```')
      ? trimmed.replace(/```json?|\```/gi, '').trim()
      : trimmed
    try {
      return JSON.parse(withoutFence)
    } catch (e) {
      // If parsing fails, return the raw string
      return { description: withoutFence }
    }
  }
  return raw
}

/**
 * Grading-only parser for Chat Completions `message.content`.
 * 1) JSON.parse full string after the same leading-fence strip as parseJsonResponse
 * 2) If that fails, JSON.parse substring from first `{` to last `}` (inclusive)
 * 3) If still fails, same fallback shape as parseJsonResponse: { description }
 * Does not change parseJsonResponse behavior used by generateAssessmentCoding.
 */
function parseGradingResponseString(raw) {
  if (typeof raw !== 'string') {
    return raw
  }
  const trimmed = raw.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/```json?|\```/gi, '').trim()
    : trimmed

  const tryParse = (s) => {
    try {
      return { ok: true, value: JSON.parse(s) }
    } catch {
      return { ok: false }
    }
  }

  let attempt = tryParse(withoutFence)
  if (attempt.ok) {
    return attempt.value
  }

  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const candidate = withoutFence.slice(start, end + 1)
    attempt = tryParse(candidate)
    if (attempt.ok) {
      return attempt.value
    }
  }

  return { description: withoutFence }
}

class OpenAIService {
  async #callOpenAI(prompt, { temperature } = {}) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not configured')
    }

    const fetchFn = await getFetch()

    const response = await fetchFn(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an examiner generating coding assessment questions. Respond with valid JSON format.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: temperature !== undefined ? temperature : 0.7
      })
    })

    const responseBody = await response.json().catch(() => null)

    if (!response.ok) {
      const message =
        responseBody?.error?.message ||
        JSON.stringify(responseBody || {}) ||
        'No response body'
      throw new Error(`OpenAI API responded with status ${response.status}: ${message}`)
    }

    const content = responseBody?.choices?.[0]?.message?.content
    if (!content) {
      throw new Error('OpenAI API returned an empty response')
    }

    return content
  }

  async generateAssessmentCoding(amount, difficulty, humanLanguage, skills, programming_language) {
    if (!amount || amount <= 0) {
      throw new Error('Amount must be a positive number')
    }

    if (!programming_language) {
      throw new Error('Programming language is required')
    }

    const skillsText = Array.isArray(skills) && skills.length > 0
      ? `The question should be based on the following skills: ${skills.join(', ')}.`
      : ''

    const difficultyLevel = difficulty || 'medium'
    const humanLangText = humanLanguage ? (humanLanguage === 'en' ? 'English' : humanLanguage) : 'English'
    const questionPlural = amount > 1 ? 's' : ''
    const mustText = amount > 1 ? 's must' : ' must'
    
    const prompt = 'You are now an examiner generating a coding assessment question.\n\n' +
      `Generate ${amount} coding question${questionPlural} in ${programming_language}.\n\n` +
      (skillsText ? skillsText + '\n\n' : '') +
      `The difficulty level should be: ${difficultyLevel}.\n\n` +
      'Requirements:\n' +
      `- The question${mustText} be clear, well-structured, and without hints.\n` +
      '- Do not reveal the solution.\n' +
      '- Each question should include:\n' +
      '  - A clear description of the problem\n' +
      '  - Test cases with input and expected output\n' +
      '  - Appropriate difficulty level\n\n' +
      `The question should be written in ${humanLangText}.\n\n` +
      'Return the result as a JSON array of questions. Each question should have this structure:\n' +
      '{\n' +
      '  "title": "Question title",\n' +
      '  "description": "Detailed question description",\n' +
      `  "difficulty": "${difficultyLevel}",\n` +
      '  "testCases": [\n' +
      '    {\n' +
      '      "input": "input example",\n' +
      '      "expected_output": "expected output"\n' +
      '    }\n' +
      '  ],\n' +
      `  "language": "${programming_language}"\n` +
      '}\n\n' +
      'Return only the JSON array, no additional text.'

    try {
      const rawResponse = await this.#callOpenAI(prompt)
      const parsed = parseJsonResponse(rawResponse)

      // Handle both array and single object responses
      let questions = Array.isArray(parsed) ? parsed : [parsed]

      // Ensure each question has required fields
      questions = questions.map((q, index) => ({
        title: q.title || `Coding Question ${index + 1}`,
        description: q.description || q.question || '',
        difficulty: q.difficulty || difficulty || 'medium',
        testCases: Array.isArray(q.testCases) && q.testCases.length > 0
          ? q.testCases
          : [
              {
                input: 'sampleInput()',
                expected_output: 'expected output'
              }
            ],
        language: q.language || programming_language,
        skills: Array.isArray(skills) ? skills : []
      }))

      // Limit to requested amount
      return questions.slice(0, amount)
    } catch (error) {
      console.error('OpenAI generateAssessmentCoding error:', error)
      throw new Error(`Failed to generate coding questions: ${error.message}`)
    }
  }

  async gradeAssessmentSolutions(questions, solutions, skills) {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('Questions array is required and must not be empty')
    }

    if (!Array.isArray(solutions) || solutions.length === 0) {
      throw new Error('Solutions array is required and must not be empty')
    }

    if (questions.length !== solutions.length) {
      throw new Error('Questions and solutions arrays must have the same length')
    }

    // Build the grading prompt
    const questionsText = questions.map((q, idx) => {
      const solution = solutions[idx]?.solution || ''
      const testCases = (q.testCases || q.test_cases || []).map((tc, tcIdx) => 
        `  Test Case ${tcIdx + 1}:
    Input: ${JSON.stringify(tc.input)}
    Expected Output: ${JSON.stringify(tc.expected_output || tc.output)}`
      ).join('\n')

      return `Question ${idx + 1}:
  ID: ${q.id || `question_${idx + 1}`}
  Title: ${q.title || 'Untitled Question'}
  Description: ${q.description || q.question || 'No description'}
  Programming Language: ${q.programming_language || q.language || 'unknown'}
  Skills to Assess: ${(q.skills || []).join(', ') || 'N/A'}
  Test Cases:
${testCases || '  No test cases provided'}
  Student Solution:
\`\`\`${q.programming_language || q.language || 'javascript'}
${solution}
\`\`\``
    }).join('\n\n---\n\n')

    const allSkills = Array.isArray(skills) && skills.length > 0
      ? skills.join(', ')
      : Array.from(new Set(questions.flatMap(q => q.skills || []))).join(', ') || 'N/A'

    const prompt = `You are an expert coding assessment evaluator. Your task is to evaluate student solutions for coding assessment questions.

EVALUATION CRITERIA:
For each solution, evaluate using these three dimensions:
1. Correctness (40% weight): Does the solution produce the correct output for all test cases?
2. Skill Application (30% weight): Does the solution demonstrate proper use of the skills the question was designed to assess?
3. Requirement Compliance (30% weight): Does the solution fully meet all requirements described in the question description?

INTERNAL SKILL CONSIDERATION (DO NOT OUTPUT PER-SKILL DETAIL):
The list "Skills Being Assessed" may be long. You must mentally consider every skill in that list when judging the work (as if you assigned each skill a 0–100 mastery score using the three dimensions above, then combined them).
- Weight skills equally unless one skill is clearly dominant for the questions shown.
- Your final single "score" (0–100) must reflect performance across the full skill set, not only a subset.

ASSESSMENT DETAILS:
Total Questions: ${questions.length}
Skills Being Assessed: ${allSkills}

QUESTIONS AND SOLUTIONS:
${questionsText}

OUTPUT (COMPACT JSON ONLY):
Return a single JSON object with this exact structure. Keep it short; do not include per-skill scores or per-skill feedback for the full list.

{
  "score": <number 0-100, overall mastery aligned with the criteria and the full "Skills Being Assessed" list>,
  "summary": "<optional: at most 2 short sentences of overall feedback>",
  "weakest_skills": [
    {
      "skill": "<exact name from Skills Being Assessed>",
      "note": "<optional: one short line; omit or use empty string if none>"
    }
  ]
}

RULES FOR weakest_skills:
- Include at most 3 entries. Use fewer or an empty array [] if there is nothing meaningful to highlight.
- Each "skill" must be copied exactly from "Skills Being Assessed" when you name a weakness.
- Do NOT output a "skills" object keyed by every assessed skill. Do NOT enumerate feedback for all skills.

Return only this JSON object, with no additional text or markdown formatting.`

    try {
      console.log('[DevLab][GRADE][OPENAI][START] Calling OpenAI API for grading')
      console.log('[DevLab][GRADE][OPENAI][PROMPT] Prompt length:', prompt.length, 'characters')
      console.log('[DevLab][GRADE][OPENAI][PROMPT] Prompt preview (first 500 chars):', prompt.substring(0, 500) + '...')
      
      const rawResponse = await this.#callOpenAI(prompt, { temperature: 0 })
      
      console.log('[DevLab][GRADE][OPENAI][RESPONSE] Raw response received from OpenAI')
      console.log('[DevLab][GRADE][OPENAI][RESPONSE] Response type:', typeof rawResponse)
      console.log('[DevLab][GRADE][OPENAI][RESPONSE] Response length:', rawResponse?.length || 0, 'characters')
      console.log('[DevLab][GRADE][OPENAI][RESPONSE] Response preview (first 1000 chars):', rawResponse?.substring(0, 1000) || 'empty')
      
      const parsed = parseGradingResponseString(rawResponse)

      console.log('[DevLab][GRADE][OPENAI][PARSE] Parsed response type:', typeof parsed)
      console.log('[DevLab][GRADE][OPENAI][PARSE] Parsed response structure:', {
        isNumber: typeof parsed === 'number',
        hasScore: typeof parsed?.score === 'number',
        hasOverallScore: typeof parsed?.overallScore === 'number',
        hasSummary: typeof parsed?.summary === 'string',
        hasWeakestSkills: Array.isArray(parsed?.weakest_skills),
        hasLegacySkills: !!(parsed?.skills && typeof parsed.skills === 'object'),
        legacySkillsKeys:
          parsed?.skills && typeof parsed.skills === 'object'
            ? Object.keys(parsed.skills)
            : null
      })

      const GRADING_SCORE_PARSE_ERR =
        'OpenAI grading response could not be parsed into a valid numeric score'

      if (parsed === null || parsed === undefined) {
        console.error(
          '[DevLab][GRADE][OPENAI][ERROR] Grading parse returned null/undefined',
          {
            rawResponsePreview:
              typeof rawResponse === 'string'
                ? rawResponse.substring(0, 2000)
                : rawResponse
          }
        )
        throw new Error(GRADING_SCORE_PARSE_ERR)
      }

      // Support either a raw number or an object with score/overallScore (strict number only; score 0 is valid)
      let rawScore
      if (typeof parsed === 'number') {
        rawScore = parsed
        console.log('[DevLab][GRADE][OPENAI][SCORE] Extracted score from number:', rawScore)
      } else if (typeof parsed.score === 'number') {
        rawScore = parsed.score
        console.log('[DevLab][GRADE][OPENAI][SCORE] Extracted score from parsed.score:', rawScore)
      } else if (typeof parsed.overallScore === 'number') {
        rawScore = parsed.overallScore
        console.log('[DevLab][GRADE][OPENAI][SCORE] Extracted score from parsed.overallScore:', rawScore)
      } else {
        const start =
          typeof rawResponse === 'string' ? rawResponse.indexOf('{') : -1
        const end =
          typeof rawResponse === 'string' ? rawResponse.lastIndexOf('}') : -1
        const extractedBraceSlice =
          start !== -1 && end > start && typeof rawResponse === 'string'
            ? rawResponse.slice(start, end + 1)
            : null
        console.error(
          '[DevLab][GRADE][OPENAI][ERROR] No numeric score or overallScore after grading parse (full-string and first-{ to last-} attempts)',
          {
            rawResponseLength: typeof rawResponse === 'string' ? rawResponse.length : null,
            rawResponsePreview:
              typeof rawResponse === 'string'
                ? rawResponse.substring(0, 2000)
                : rawResponse,
            extractedBraceSlicePreview:
              extractedBraceSlice !== null
                ? extractedBraceSlice.substring(0, 2000)
                : null,
            parsedType: typeof parsed,
            parsedKeys:
              parsed && typeof parsed === 'object' ? Object.keys(parsed) : null,
            parsedSerialized:
              parsed && typeof parsed === 'object'
                ? JSON.stringify(parsed, null, 2)
                : String(parsed)
          }
        )
        throw new Error(GRADING_SCORE_PARSE_ERR)
      }

      const normalizedScore = Math.max(0, Math.min(100, Number(rawScore) || 0))
      console.log('[DevLab][GRADE][OPENAI][SCORE] Normalized score:', normalizedScore, '(raw:', rawScore, ')')

      const normalizeWeakestSkills = (raw) => {
        if (!Array.isArray(raw)) return null
        const out = []
        for (const item of raw) {
          if (out.length >= 3) break
          if (!item || typeof item !== 'object') continue
          const name =
            typeof item.skill === 'string'
              ? item.skill.trim()
              : typeof item.name === 'string'
                ? item.name.trim()
                : ''
          if (!name) continue
          const note =
            typeof item.note === 'string'
              ? item.note.trim()
              : typeof item.feedback === 'string'
                ? item.feedback.trim()
                : ''
          out.push(note ? { skill: name, note } : { skill: name })
        }
        return out.length > 0 ? out : null
      }

      let weakestSkills = null
      let summary = null
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          summary = parsed.summary.trim()
        }
        weakestSkills = normalizeWeakestSkills(parsed.weakest_skills)
      }

      // Legacy: full per-skill object (still accepted if the model returns it)
      const legacySkills =
        parsed &&
        typeof parsed === 'object' &&
        parsed.skills &&
        typeof parsed.skills === 'object'
          ? parsed.skills
          : null

      if (weakestSkills) {
        console.log('[DevLab][GRADE][OPENAI][SKILLS] Weakest skills (compact):', {
          count: weakestSkills.length,
          skills: weakestSkills.map((w) => w.skill)
        })
      } else if (legacySkills) {
        console.log('[DevLab][GRADE][OPENAI][SKILLS] Legacy per-skill object received:', {
          skillsCount: Object.keys(legacySkills).length,
          skillsList: Object.keys(legacySkills)
        })
      } else {
        console.log('[DevLab][GRADE][OPENAI][SKILLS] No weakest_skills or legacy skills in response')
      }

      const result = {
        score: normalizedScore
      }

      if (summary) {
        result.summary = summary
      }
      if (weakestSkills) {
        result.weakest_skills = weakestSkills
      }
      if (legacySkills) {
        result.skills = legacySkills
      }

      console.log('[DevLab][GRADE][OPENAI][SUCCESS] Grading completed successfully:', {
        score: result.score,
        hasSummary: !!result.summary,
        hasWeakestSkills: !!result.weakest_skills,
        hasLegacySkills: !!result.skills
      })

      return result
    } catch (error) {
      console.error('[DevLab][GRADE][OPENAI][ERROR] OpenAI gradeAssessmentSolutions error:', error)
      console.error('[DevLab][GRADE][OPENAI][ERROR] Error message:', error.message)
      console.error('[DevLab][GRADE][OPENAI][ERROR] Stack trace:', error.stack)
      throw new Error(`Failed to grade assessment solutions: ${error.message}`)
    }
  }
}

export const openAIService = new OpenAIService()

