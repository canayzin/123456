async function onAuthCreate(user, ctx) {
  if (ctx.log) ctx.log('info', `auth create ${user?.uid || ''}`);
  return { received: true, uid: user.uid || null };
}

module.exports = { onAuthCreate };
