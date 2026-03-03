function shouldCompact(totalOps, threshold = 200) { return totalOps > threshold; }
module.exports = { shouldCompact };
