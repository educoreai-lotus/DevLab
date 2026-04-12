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

SKILL-LEVEL EVALUATION REQUIREMENTS:
For EACH skill listed in "Skills Being Assessed", you MUST:
1. Assign a numeric score from 0 to 100 based on the learner's demonstrated mastery across all solutions
   - Evaluate the skill using the three dimensions above (Correctness 40%, Skill Application 30%, Requirement Compliance 30%)
   - Consider how well the learner applied this specific skill in their solutions
2. Provide a concise feedback description explaining:
   - The learner's strengths and weaknesses for this skill
   - Mastery level classification: "Excellent", "Good", "Partial", or "Weak"
   - Specific examples from the solutions that demonstrate the skill level

FINAL SCORE CALCULATION:
Compute the final overall score (0-100) as the average of all individual skill scores.
If multiple skills are assessed, weight them equally unless one skill is clearly more critical to the assessment.

ASSESSMENT DETAILS:
Total Questions: ${questions.length}
Skills Being Assessed: ${allSkills}

QUESTIONS AND SOLUTIONS:
${questionsText}

EVALUATION INSTRUCTIONS:
1. Analyze each solution using the three evaluation dimensions (Correctness, Skill Application, Requirement Compliance)
2. For each skill in "Skills Being Assessed", determine:
   - A numeric score (0-100) reflecting mastery across all solutions
   - Clear feedback describing strengths, weaknesses, and mastery level
3. Calculate the final overall score as the average of all skill scores
4. Ensure each skill score reflects how well the learner demonstrated that skill across all questions

Return your evaluation as a JSON object with this exact structure:
{
  "score": <number 0-100, calculated as average of all skill scores>,
  "skills": {
    "<skill_name_1>": {
      "score": <number 0-100>,
      "feedback": "<concise description of mastery level, strengths, and weaknesses>"
    },
    "<skill_name_2>": {
      "score": <number 0-100>,
      "feedback": "<concise description of mastery level, strengths, and weaknesses>"
    }
  }
}

IMPORTANT:
- Include ALL skills from "Skills Being Assessed" in the skills object
- Each skill must have both a numeric score and feedback
- The final "score" must be the average of all skill scores
- Use skill names exactly as they appear in "Skills Being Assessed"

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
        hasSkills: !!parsed?.skills,
        skillsKeys: parsed?.skills ? Object.keys(parsed.skills) : null
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

      // Extract skill-level scores and feedback if present
      const skills =
        parsed &&
        typeof parsed === 'object' &&
        parsed.skills &&
        typeof parsed.skills === 'object'
          ? parsed.skills
          : null
      
      if (skills) {
        console.log('[DevLab][GRADE][OPENAI][SKILLS] Skills breakdown received:', {
          skillsCount: Object.keys(skills).length,
          skillsList: Object.keys(skills),
          sampleSkill: Object.keys(skills)[0] ? {
            skillName: Object.keys(skills)[0],
            score: skills[Object.keys(skills)[0]]?.score,
            feedbackLength: skills[Object.keys(skills)[0]]?.feedback?.length || 0
          } : null
        })
      } else {
        console.log('[DevLab][GRADE][OPENAI][SKILLS] No skills breakdown in response')
      }

      const result = {
        score: normalizedScore
      }

      // Include skills breakdown if available
      if (skills) {
        result.skills = skills
      }

      console.log('[DevLab][GRADE][OPENAI][SUCCESS] Grading completed successfully:', {
        score: result.score,
        hasSkills: !!result.skills
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

