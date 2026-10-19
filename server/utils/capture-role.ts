/** APP角色不获得任何后台管理权限。 */
export const isCaptureRole = (role: unknown) => role === 'production_operator' || role === 'line_leader'
