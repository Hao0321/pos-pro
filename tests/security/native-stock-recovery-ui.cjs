// Run the established real renderer/IPC/pinned-HTTPS recovery journey with the
// private cost ledger active. It must preserve cost history through both restores.
process.env.POS_RECOVERY_WITH_COST='1'
require('./native-recovery-ui.cjs')
