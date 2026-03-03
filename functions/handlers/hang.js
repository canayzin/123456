async function hang() {
  await new Promise(() => {});
}
module.exports = { hang };
