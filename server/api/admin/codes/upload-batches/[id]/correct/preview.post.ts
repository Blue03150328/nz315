import { productionAction } from '../../../../../../utils/production-workflow'
export default defineEventHandler(event => productionAction(event, 'correct', true))
