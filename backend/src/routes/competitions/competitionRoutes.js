import express from 'express'
import { authenticatePlatformUser } from '../../middleware/platformAuth.js'
import { competitionController } from '../../controllers/competitionController.js'

const router = express.Router()

const disableAuth =
  process.env.DISABLE_COMPETITION_AUTH === undefined ||
  process.env.DISABLE_COMPETITION_AUTH === '' ||
  process.env.DISABLE_COMPETITION_AUTH === 'true'

const competitionAuth = disableAuth ? (req, _res, next) => next() : authenticatePlatformUser

router.post('/course-completion', competitionController.recordCourseCompletion)
router.post('/create', competitionController.createAICompetition)
router.get('/pending/me', authenticatePlatformUser, competitionController.getPendingAICompetitionsForMe)
router.get('/pending/:learnerId', competitionController.getPendingAICompetitions)
router.post('/start/:competitionId', competitionAuth, competitionController.startAICompetition)
router.post('/:competitionId/answer', competitionAuth, competitionController.recordAICompetitionAnswer)
router.post('/:competitionId/complete', competitionAuth, competitionController.completeAICompetition)

export default router

