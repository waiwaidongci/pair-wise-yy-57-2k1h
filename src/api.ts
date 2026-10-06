import axios from 'axios'
import { devices, routes, seedCases, seedClaims, seedConstructions, seedExecutions } from './mock'

export const stationApi = axios.create({
  baseURL: '/api',
  adapter: async (config) => ({
    data: config.url === '/station'
      ? { devices, routes, cases: seedCases, executions: seedExecutions, constructions: seedConstructions, claims: seedClaims, version: 'v26.10' }
      : {},
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }),
})

export async function fetchStation() {
  const { data } = await stationApi.get('/station')
  return data
}
