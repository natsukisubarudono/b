const WAGER_ROLES = [
    { threshold: 100,  roleId: '1519071586387361802' },
    { threshold: 500,  roleId: '1519071619723821208' },
    { threshold: 1500, roleId: '1519071655861817375' },
];

async function checkAndApplyWagerRoles(client, guild, userId, totalWagered) {
    if (!guild) return;
    try {
        const member = await guild.members.fetch(userId);
        for (const { threshold, roleId } of WAGER_ROLES) {
            if (totalWagered >= threshold && !member.roles.cache.has(roleId)) {
                await member.roles.add(roleId).catch(() => {});
            }
        }
    } catch {
        // Member not in guild or missing permissions — silently skip
    }
}

module.exports = { checkAndApplyWagerRoles };
