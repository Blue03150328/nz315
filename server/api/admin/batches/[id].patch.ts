import { batchAction } from '../../../utils/production-workflow'
export default defineEventHandler(event => batchAction(event))
