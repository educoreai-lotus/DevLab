export const platformAuthController = {
  async getAuthContext(req, res) {
    const user = req.user

    if (!user?.directoryUserId) {
      return res.status(401).json({
        success: false,
        error: 'Platform user identity not available'
      })
    }

    return res.json({
      success: true,
      data: {
        directoryUserId: user.directoryUserId,
        userId: user.userId,
        id: user.id,
        role: user.role ?? null,
        primaryRole: user.primaryRole ?? null,
        isTrainer: Boolean(user.isTrainer),
        isSystemAdmin: Boolean(user.isSystemAdmin),
        authenticated: true
      }
    })
  }
}
