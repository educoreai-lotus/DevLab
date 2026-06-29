export const platformAuthController = {
  async getAuthContext(req, res) {
    const user = req.user

    if (!user?.directoryUserId) {
      return res.status(403).json({
        success: false,
        error: 'Platform user identity not available'
      })
    }

    return res.json({
      authenticated: true,
      directoryUserId: user.directoryUserId,
      userId: user.userId ?? null,
      organizationId: user.organizationId ?? null,
      primaryRole: user.primaryRole ?? null,
      isTrainer: Boolean(user.isTrainer),
      isSystemAdmin: Boolean(user.isSystemAdmin)
    })
  }
}
